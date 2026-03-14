/**
 * RobinPath CLI — HTTP Server for app integration
 * Handles: handleStart(), handleStatus(), readStdin()
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
import { color, log, logVerbose, CLI_VERSION, getRobinPathHome } from './utils';
import { nativeModules, ROBINPATH_VERSION, RobinPath, Parser, Printer } from './runtime';

// External dependencies — declared so TypeScript knows their shapes
import { createRobinPath, resolveScriptPath } from './commands-core';
import { formatScript } from './commands-devtools';

// ============================================================================
// Type definitions
// ============================================================================

interface NativeModule {
    name: string;
    functions: unknown;
    moduleMetadata?: {
        methods?: string[];
    };
    functionMetadata?: unknown;
}

interface RobinPathInstance {
    executeScript(script: string): Promise<unknown>;
    registerModule(name: string, functions: unknown): void;
}

interface ModuleListEntry {
    name: string;
    type: string;
    methods: string[];
    functionMetadata: unknown;
}

interface RateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    reset: number;
}

interface JobError {
    code: string;
    message: string;
}

interface Job {
    _jobId?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    output: string[];
    result: unknown;
    error: JobError | null;
    script: string;
    source: string;
    startedAt: string;
    completedAt: string | null;
    duration: number | null;
    memoryUsed: number | null;
    sseClients: ServerResponse[];
}

interface IdempotencyCacheEntry {
    ok: boolean;
    jobId: string;
    status: string;
    source: string;
    output: string[];
    result: unknown;
    error: JobError | null;
    usage: {
        execution_ms: number | null;
        memory_bytes: number | null;
    };
    requestId?: string;
    idempotent?: boolean;
}

interface ResolvedScript {
    script?: string;
    source?: string;
    error?: string;
}

interface ParsedBody {
    script?: string;
    file?: string;
    webhook?: string;
    webhook_secret?: string;
    dry?: boolean;
    [key: string]: unknown;
}

interface LogEntry {
    level: string;
    event: string;
    [key: string]: unknown;
}

/**
 * robinpath start — Start HTTP server for app integration
 *
 * Enterprise HTTP API with:
 * - Session-based auth (gatekeeper)
 * - Job management with async execution
 * - SSE streaming for real-time progress
 * - Webhook callbacks for fire-and-forget
 * - Idempotency keys for safe retries
 * - OpenAPI 3.1 spec at /v1/openapi.json
 * - Prometheus-style metrics at /v1/metrics
 * - Request IDs and structured error codes
 * - Usage tracking per response
 * - Rate limiting headers
 */
export async function handleStart(args: string[]): Promise<void> {
    // Parse flags
    let port: number = 6372;
    let session: string | null = null;
    let host: string = '127.0.0.1';
    let jobTimeout: number = 30000;
    let maxConcurrent: number = 5;
    let corsOrigin: string = '*';
    let logFile: string | null = null;
    let maxBodySize: number = 5_000_000; // 5MB default

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                console.error(JSON.stringify({ ok: false, error: 'Invalid port number' }));
                process.exit(2);
            }
            i++;
        } else if ((args[i] === '-s' || args[i] === '--session') && args[i + 1]) {
            session = args[i + 1];
            i++;
        } else if (args[i] === '--host' && args[i + 1]) {
            host = args[i + 1];
            i++;
        } else if (args[i] === '--timeout' && args[i + 1]) {
            jobTimeout = parseInt(args[i + 1], 10);
            if (isNaN(jobTimeout) || jobTimeout < 0) jobTimeout = 30000;
            i++;
        } else if (args[i] === '--max-concurrent' && args[i + 1]) {
            maxConcurrent = parseInt(args[i + 1], 10);
            if (isNaN(maxConcurrent) || maxConcurrent < 1) maxConcurrent = 5;
            i++;
        } else if (args[i] === '--cors-origin' && args[i + 1]) {
            corsOrigin = args[i + 1];
            i++;
        } else if (args[i] === '--log-file' && args[i + 1]) {
            logFile = resolve(args[i + 1]);
            i++;
        } else if (args[i] === '--max-body' && args[i + 1]) {
            maxBodySize = parseInt(args[i + 1], 10);
            if (isNaN(maxBodySize) || maxBodySize < 1) maxBodySize = 5_000_000;
            i++;
        }
    }

    // Auto-generate session if not provided
    if (!session) {
        session = randomUUID();
    }

    // Create RobinPath instance for the server
    const rp: RobinPathInstance = await createRobinPath();

    // ========================================================================
    // Job management
    // ========================================================================
    const jobs = new Map<string, Job>();     // jobId -> { status, output, result, error, startedAt, completedAt, script, abortController, sseClients }
    const idempotencyCache = new Map<string, IdempotencyCacheEntry>(); // idempotency key -> { jobId, response }

    function generateJobId(): string {
        return 'job_' + randomUUID().replace(/-/g, '').slice(0, 12);
    }

    function generateRequestId(): string {
        return 'req_' + randomUUID().replace(/-/g, '').slice(0, 12);
    }

    function getActiveJobCount(): number {
        let count = 0;
        for (const job of jobs.values()) {
            if (job.status === 'running') count++;
        }
        return count;
    }

    // Collect module info for /v1/modules endpoint
    const moduleList: ModuleListEntry[] = [];
    for (const mod of nativeModules) {
        moduleList.push({ name: mod.name, type: 'native', methods: mod.moduleMetadata?.methods || [], functionMetadata: mod.functionMetadata || null });
    }

    // Server start time for uptime tracking
    const serverStartedAt: string = new Date().toISOString();

    // ========================================================================
    // Rate limiting (simple sliding window per session)
    // ========================================================================
    const RATE_LIMIT: number = 100;           // requests per window
    const RATE_WINDOW_MS: number = 60_000;    // 1 minute
    let rateWindowStart: number = Date.now();
    let rateCount: number = 0;

    function checkRateLimit(): RateLimitResult {
        const now = Date.now();
        if (now - rateWindowStart > RATE_WINDOW_MS) {
            rateWindowStart = now;
            rateCount = 0;
        }
        rateCount++;
        return {
            allowed: rateCount <= RATE_LIMIT,
            limit: RATE_LIMIT,
            remaining: Math.max(0, RATE_LIMIT - rateCount),
            reset: Math.ceil((rateWindowStart + RATE_WINDOW_MS) / 1000),
        };
    }

    // ========================================================================
    // Request metrics counter
    // ========================================================================
    let totalRequests: number = 0;
    let totalErrors: number = 0;

    // ========================================================================
    // Job TTL — auto-cleanup completed jobs after 30 minutes
    // ========================================================================
    const JOB_TTL_MS: number = 30 * 60_000; // 30 minutes
    const jobCleanupInterval = setInterval(() => {
        const cutoff = Date.now() - JOB_TTL_MS;
        for (const [id, job] of jobs) {
            if (job.status !== 'running' && job.completedAt && new Date(job.completedAt).getTime() < cutoff) {
                jobs.delete(id);
            }
        }
    }, 60_000); // check every minute
    jobCleanupInterval.unref(); // don't prevent process exit

    // ========================================================================
    // Structured logging
    // ========================================================================
    function logEntry(entry: LogEntry): void {
        if (!logFile) return;
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        try { appendFileSync(logFile, line); } catch {}
    }

    // Write PID file for process management
    const pidFile: string = join(homedir(), '.robinpath', `server-${port}.pid`);
    try {
        mkdirSync(dirname(pidFile), { recursive: true });
        writeFileSync(pidFile, String(process.pid));
    } catch {}
    // Clean up PID file on exit
    process.on('exit', () => { try { unlinkSync(pidFile); } catch {} });

    // ========================================================================
    // Helpers
    // ========================================================================

    // Body parser helper — supports JSON and plain text
    // Plain text mode: the entire body is treated as a script (for easy copy-paste)
    function parseBody(req: IncomingMessage): Promise<ParsedBody> {
        return new Promise((resolvePromise, reject) => {
            let body = '';
            req.on('data', (chunk: string) => {
                body += chunk;
                if (body.length > maxBodySize) {
                    reject(new Error(`Request body too large (max ${maxBodySize} bytes)`));
                    req.destroy();
                }
            });
            req.on('end', () => {
                if (!body) return resolvePromise({});
                const contentType = (req.headers['content-type'] || '').toLowerCase();
                // Plain text — treat entire body as a script
                if (contentType.startsWith('text/plain')) {
                    return resolvePromise({ script: body });
                }
                // JSON
                try { resolvePromise(JSON.parse(body)); }
                catch { reject(new Error('Invalid JSON body. Tip: use Content-Type: text/plain to send raw script code.')); }
            });
            req.on('error', reject);
        });
    }

    // Send JSON response helper with enterprise headers
    // Creates a shallow copy to avoid mutating the original (important for idempotency cache)
    function json(res: ServerResponse, status: number, data: Record<string, unknown>, requestId?: string): void {
        const out: Record<string, unknown> = { ...data };
        if (requestId) out.requestId = requestId;
        out.timestamp = new Date().toISOString();
        const payload = JSON.stringify(out);
        res.writeHead(status, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
    }

    // Structured error response
    function jsonError(res: ServerResponse, status: number, code: string, message: string, requestId?: string): void {
        json(res, status, { ok: false, error: { code, message } }, requestId);
    }

    // Active job set for concurrent-safe output capture
    // Instead of hijacking global console.log (which breaks with concurrent jobs),
    // we install a single interceptor that routes output to the correct job.
    const activeJobForCapture = new Set<string>(); // jobIds currently capturing
    const origLog = console.log;
    const origErr = console.error;
    let currentCapturingJob: Job | null = null; // the job currently executing (single-threaded JS)

    console.log = (...args: unknown[]) => {
        if (currentCapturingJob) {
            const line = args.join(' ');
            currentCapturingJob.output.push(line);
            broadcastSSE(currentCapturingJob._jobId!, 'output', { line });
        } else {
            origLog(...args);
        }
    };
    console.error = (...args: unknown[]) => {
        if (currentCapturingJob) {
            const line = '[error] ' + args.join(' ');
            currentCapturingJob.output.push(line);
            broadcastSSE(currentCapturingJob._jobId!, 'output', { line, level: 'error' });
        } else {
            origErr(...args);
        }
    };

    // Execute a job (with timeout, output capture, and SSE broadcasting)
    async function executeJob(jobId: string, script: string): Promise<void> {
        const job = jobs.get(jobId)!;
        job._jobId = jobId; // store for output routing
        const startTime = performance.now();

        // Set up timeout
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let timedOut = false;
        if (jobTimeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                job.status = 'failed';
                job.error = { code: 'SCRIPT_TIMEOUT', message: `Script exceeded ${jobTimeout}ms limit` };
                job.completedAt = new Date().toISOString();
                job.duration = Math.round(performance.now() - startTime);
                broadcastSSE(jobId, 'job.failed', { error: job.error, duration: job.duration });
                broadcastSSE(jobId, 'done', null);
            }, jobTimeout);
        }

        try {
            if (timedOut) return;
            // Set current job for output capture (safe because JS is single-threaded per await tick)
            currentCapturingJob = job;
            const result = await rp.executeScript(script);
            currentCapturingJob = null;

            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (timedOut) return;

            job.status = 'completed';
            job.result = result ?? null;
            job.completedAt = new Date().toISOString();
            job.duration = Math.round(performance.now() - startTime);
            job.memoryUsed = process.memoryUsage().heapUsed;
            broadcastSSE(jobId, 'job.completed', { result: job.result, duration: job.duration });
            broadcastSSE(jobId, 'done', null);
        } catch (err: unknown) {
            currentCapturingJob = null;
            if (timeoutHandle) clearTimeout(timeoutHandle);

            if (!timedOut) {
                job.status = 'failed';
                job.error = { code: 'SCRIPT_ERROR', message: (err as Error).message };
                job.completedAt = new Date().toISOString();
                job.duration = Math.round(performance.now() - startTime);
                job.memoryUsed = process.memoryUsage().heapUsed;
                broadcastSSE(jobId, 'job.failed', { error: job.error, duration: job.duration });
                broadcastSSE(jobId, 'done', null);
            }
        }
    }

    // SSE broadcasting
    function broadcastSSE(jobId: string, event: string, data: unknown): void {
        const job = jobs.get(jobId);
        if (!job || !job.sseClients) return;
        for (const client of job.sseClients) {
            try {
                client.write(`event: ${event}\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch {
                // client disconnected
            }
        }
        // Clean up SSE clients on done
        if (event === 'done') {
            for (const client of job.sseClients) {
                try { client.end(); } catch {}
            }
            job.sseClients = [];
        }
    }

    // Webhook delivery helper
    async function deliverWebhook(webhookUrl: string, webhookSecret: string | null, event: string, payload: Record<string, unknown>): Promise<void> {
        try {
            const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (webhookSecret) {
                const sig = createHmac('sha256', webhookSecret).update(body).digest('hex');
                headers['x-robinpath-signature'] = 'sha256=' + sig;
            }
            await fetch(webhookUrl, { method: 'POST', headers, body });
            logEntry({ level: 'info', event: 'webhook.delivered', url: webhookUrl, payload_event: event });
        } catch (err: unknown) {
            logEntry({ level: 'error', event: 'webhook.failed', url: webhookUrl, error: (err as Error).message });
        }
    }

    // Resolve script from body — supports both `script` (inline) and `file` (path) fields
    function resolveScript(body: ParsedBody): ResolvedScript {
        if (body.script && typeof body.script === 'string') {
            return { script: body.script, source: 'inline' };
        }
        if (body.file && typeof body.file === 'string') {
            const filePath = resolveScriptPath(body.file);
            if (!filePath) {
                return { error: `File not found: ${body.file}` };
            }
            return { script: readFileSync(filePath, 'utf-8'), source: filePath };
        }
        return { error: 'Missing "script" (string) or "file" (path) field' };
    }

    // ========================================================================
    // OpenAPI spec (built once at startup, served on every GET /v1/openapi.json)
    // ========================================================================
    const openApiSpec: Record<string, unknown> = {
        openapi: '3.1.0',
        info: { title: 'RobinPath Server API', version: CLI_VERSION, description: 'HTTP API for the RobinPath scripting language runtime. Session token required via x-robinpath-session header.' },
        servers: [{ url: `http://${host}:${port}`, description: 'Local server' }],
        security: [{ sessionAuth: [] }],
        components: {
            securitySchemes: {
                sessionAuth: { type: 'apiKey', in: 'header', name: 'x-robinpath-session', description: 'Session token from robinpath start' },
            },
            schemas: {
                Error: { type: 'object', properties: { ok: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } }, requestId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } } },
                Job: { type: 'object', properties: { jobId: { type: 'string' }, status: { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled'] }, output: { type: 'array', items: { type: 'string' } }, result: {}, error: {}, startedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' }, duration: { type: 'integer' }, source: { type: 'string' }, usage: { type: 'object', properties: { execution_ms: { type: 'integer' }, memory_bytes: { type: 'integer' } } } } },
            },
        },
        paths: {
            '/v1/health': { get: { summary: 'Health check', security: [], responses: { 200: { description: 'Server is healthy' } } } },
            '/v1/execute': { post: { summary: 'Execute a script', description: 'Run inline script or file. Supports sync, SSE streaming (accept: text/event-stream), and webhook modes.', parameters: [{ name: 'dry', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Validate without executing' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { script: { type: 'string', description: 'Inline RobinPath code' }, file: { type: 'string', description: 'Path to .rp file' }, webhook: { type: 'string', format: 'uri', description: 'URL for async result delivery' }, webhook_secret: { type: 'string', description: 'Secret for webhook signature' }, dry: { type: 'boolean', description: 'Validate without executing' } } } } } }, responses: { 200: { description: 'Job result (sync mode)' }, 202: { description: 'Job accepted (webhook mode)' } } } },
            '/v1/execute/file': { post: { summary: 'Execute a file', description: 'Same as /v1/execute but conventionally for file-based execution.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } } } }, responses: { 200: { description: 'Job result' } } } },
            '/v1/check': { post: { summary: 'Syntax check', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } } }, responses: { 200: { description: 'Check result' } } } },
            '/v1/fmt': { post: { summary: 'Format code', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } } }, responses: { 200: { description: 'Formatted code' } } } },
            '/v1/jobs': { get: { summary: 'List jobs', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled'] } }], responses: { 200: { description: 'Paginated job list' } } } },
            '/v1/jobs/{jobId}': { get: { summary: 'Job detail', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Job detail' }, 404: { description: 'Job not found' } } } },
            '/v1/jobs/{jobId}/stream': { get: { summary: 'SSE job stream', description: 'Server-Sent Events stream for real-time job progress.', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'SSE event stream', content: { 'text/event-stream': {} } } } } },
            '/v1/jobs/{jobId}/cancel': { post: { summary: 'Cancel a job', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Job cancelled' }, 409: { description: 'Job not running' } } } },
            '/v1/modules': { get: { summary: 'List loaded modules', responses: { 200: { description: 'Module list' } } } },
            '/v1/info': { get: { summary: 'Server info', responses: { 200: { description: 'Server configuration and status' } } } },
            '/v1/metrics': { get: { summary: 'Prometheus metrics', responses: { 200: { description: 'Plain text metrics', content: { 'text/plain': {} } } } } },
            '/v1/openapi.json': { get: { summary: 'OpenAPI specification', security: [], responses: { 200: { description: 'This document' } } } },
            '/v1/stop': { post: { summary: 'Graceful shutdown', responses: { 200: { description: 'Server stopping' } } } },
        },
    };

    // ========================================================================
    // HTTP server
    // ========================================================================
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url!, `http://${host}:${port}`);
        const path = url.pathname;
        const method = req.method;
        const requestId: string = (req.headers['x-request-id'] as string) || generateRequestId();
        const startTime = performance.now();

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-robinpath-session, x-request-id, x-idempotency-key, Accept');
        res.setHeader('Access-Control-Expose-Headers', 'x-request-id, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-processing-ms');

        // Always include request ID
        res.setHeader('x-request-id', requestId);

        // CORS preflight caching (1 hour — browsers won't re-preflight for 3600s)
        res.setHeader('Access-Control-Max-Age', '3600');

        // Handle preflight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Track total requests
        totalRequests++;

        // ---- No-auth endpoints ----

        // GET /v1/health — no auth required
        if (method === 'GET' && (path === '/v1/health' || path === '/health')) {
            json(res, 200, { ok: true, version: CLI_VERSION }, requestId);
            return;
        }

        // ---- Session validation ----
        const reqSession = req.headers['x-robinpath-session'] as string | undefined;
        if (reqSession !== session) {
            jsonError(res, 403, 'FORBIDDEN', 'Invalid or missing session token', requestId);
            return;
        }

        // ---- Rate limiting ----
        const rate = checkRateLimit();
        res.setHeader('x-ratelimit-limit', rate.limit);
        res.setHeader('x-ratelimit-remaining', rate.remaining);
        res.setHeader('x-ratelimit-reset', rate.reset);
        if (!rate.allowed) {
            res.setHeader('retry-after', Math.ceil((RATE_WINDOW_MS - (Date.now() - rateWindowStart)) / 1000));
            jsonError(res, 429, 'RATE_LIMITED', 'Too many requests', requestId);
            return;
        }

        // Log every request
        logEntry({ level: 'info', event: 'request', method: method!, path, requestId, session: reqSession ? reqSession.slice(0, 4) + '***' : null });

        // Deprecation warning for non-versioned paths
        const isLegacyPath = !path.startsWith('/v1/') && path !== '/health';
        if (isLegacyPath) {
            res.setHeader('x-robinpath-deprecation', 'Use /v1/ prefix. Non-versioned paths will be removed in a future release.');
            logEntry({ level: 'warn', event: 'deprecated_path', path, requestId });
        }

        try {
            // ================================================================
            // POST /v1/execute or /v1/execute/file — run a script (returns job)
            // Accepts: { script: "..." } or { file: "./path.rp" }
            // Also supports webhook: { ..., webhook: "url", webhook_secret: "..." }
            // ================================================================
            if (method === 'POST' && (path === '/v1/execute' || path === '/execute' || path === '/v1/execute/file' || path === '/execute/file')) {
                const body = await parseBody(req);

                // Resolve script from inline code or file path
                const resolved = resolveScript(body);
                if (resolved.error) {
                    jsonError(res, 400, 'INVALID_REQUEST', resolved.error, requestId);
                    return;
                }
                const script = resolved.script!;
                const source = resolved.source!;

                // Dry run mode — parse and validate without executing
                const dryRun = url.searchParams.get('dry') === 'true' || body.dry === true;
                if (dryRun) {
                    try {
                        const parser = new Parser(script);
                        await parser.parse();
                        json(res, 200, { ok: true, dry_run: true, source, message: 'Script is valid' }, requestId);
                    } catch (err: unknown) {
                        const lineMatch = (err as Error).message.match(/line (\d+)/i);
                        const colMatch = (err as Error).message.match(/column (\d+)/i);
                        json(res, 200, {
                            ok: false, dry_run: true, source,
                            error: { code: 'SYNTAX_ERROR', message: (err as Error).message, line: lineMatch ? parseInt(lineMatch[1]) : null, column: colMatch ? parseInt(colMatch[1]) : null },
                        }, requestId);
                    }
                    return;
                }

                // Idempotency check
                const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
                if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
                    const cached = idempotencyCache.get(idempotencyKey)!;
                    cached.requestId = requestId;
                    cached.idempotent = true;
                    json(res, 200, cached as unknown as Record<string, unknown>, requestId);
                    return;
                }

                // Concurrency check
                if (getActiveJobCount() >= maxConcurrent) {
                    res.setHeader('retry-after', '2');
                    jsonError(res, 503, 'MAX_CONCURRENT', `Server is at max capacity (${maxConcurrent} concurrent jobs)`, requestId);
                    return;
                }

                const jobId = generateJobId();
                const now = new Date().toISOString();
                const webhookUrl = body.webhook || null;
                const webhookSecret = body.webhook_secret || null;

                // Determine mode: streaming (SSE) or synchronous
                const wantsStream = req.headers['accept'] === 'text/event-stream';

                jobs.set(jobId, {
                    status: 'running',
                    output: [],
                    result: null,
                    error: null,
                    script,
                    source,
                    startedAt: now,
                    completedAt: null,
                    duration: null,
                    memoryUsed: null,
                    sseClients: [],
                });

                logEntry({ level: 'info', event: 'job.started', jobId, source, requestId, mode: wantsStream ? 'stream' : (webhookUrl ? 'webhook' : 'sync') });

                // Webhook callback after job completes
                function onJobDone(): void {
                    const job = jobs.get(jobId);
                    if (!job) return;
                    logEntry({ level: 'info', event: `job.${job.status}`, jobId, duration: job.duration, requestId });
                    if (webhookUrl) {
                        deliverWebhook(webhookUrl, webhookSecret, `job.${job.status}`, {
                            jobId, status: job.status, output: job.output, result: job.result,
                            error: job.error, duration: job.duration,
                        });
                    }
                }

                if (wantsStream) {
                    // SSE mode — stream progress in real time
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'x-request-id': requestId,
                    });
                    res.write(`event: job.started\ndata: ${JSON.stringify({ jobId, requestId, source })}\n\n`);

                    const job = jobs.get(jobId)!;
                    job.sseClients.push(res);

                    req.on('close', () => {
                        const j = jobs.get(jobId);
                        if (j) j.sseClients = j.sseClients.filter(c => c !== res);
                    });

                    // Fire and forget — SSE events are sent via broadcastSSE
                    executeJob(jobId, script).then(onJobDone);
                } else if (webhookUrl) {
                    // Webhook mode — return jobId immediately, deliver result via webhook
                    json(res, 202, { ok: true, jobId, status: 'running', source, message: `Result will be delivered to ${webhookUrl}` }, requestId);
                    executeJob(jobId, script).then(onJobDone);
                } else {
                    // Synchronous mode — wait for completion, return full result
                    await executeJob(jobId, script);
                    onJobDone();
                    const job = jobs.get(jobId)!;
                    const processingMs = Math.round(performance.now() - startTime);
                    res.setHeader('x-processing-ms', processingMs);

                    const response: IdempotencyCacheEntry = {
                        ok: job.status === 'completed',
                        jobId,
                        status: job.status,
                        source,
                        output: job.output,
                        result: job.result,
                        error: job.error,
                        usage: {
                            execution_ms: job.duration,
                            memory_bytes: job.memoryUsed,
                        },
                    };

                    // Cache idempotency
                    if (idempotencyKey) {
                        idempotencyCache.set(idempotencyKey, { ...response });
                        // Auto-expire after 5 minutes
                        setTimeout(() => idempotencyCache.delete(idempotencyKey), 300_000);
                    }

                    json(res, 200, response as unknown as Record<string, unknown>, requestId);
                }
                return;
            }

            // ================================================================
            // POST /v1/check — syntax check a script (no execution)
            // ================================================================
            if (method === 'POST' && (path === '/v1/check' || path === '/check')) {
                const body = await parseBody(req);
                const script = body.script;
                if (!script || typeof script !== 'string') {
                    jsonError(res, 400, 'INVALID_REQUEST', 'Missing "script" field', requestId);
                    return;
                }
                try {
                    const parser = new Parser(script);
                    await parser.parse();
                    json(res, 200, { ok: true }, requestId);
                } catch (err: unknown) {
                    const lineMatch = (err as Error).message.match(/line (\d+)/i);
                    const colMatch = (err as Error).message.match(/column (\d+)/i);
                    json(res, 200, {
                        ok: false,
                        error: { code: 'SYNTAX_ERROR', message: (err as Error).message, line: lineMatch ? parseInt(lineMatch[1]) : null, column: colMatch ? parseInt(colMatch[1]) : null },
                    }, requestId);
                }
                return;
            }

            // ================================================================
            // POST /v1/fmt — format code
            // ================================================================
            if (method === 'POST' && (path === '/v1/fmt' || path === '/fmt')) {
                const body = await parseBody(req);
                const script = body.script;
                if (!script || typeof script !== 'string') {
                    jsonError(res, 400, 'INVALID_REQUEST', 'Missing "script" field', requestId);
                    return;
                }
                try {
                    const formatted = await formatScript(script);
                    json(res, 200, { ok: true, formatted }, requestId);
                } catch (err: unknown) {
                    json(res, 200, { ok: false, error: { code: 'FORMAT_ERROR', message: (err as Error).message } }, requestId);
                }
                return;
            }

            // ================================================================
            // GET /v1/jobs — list jobs
            // ================================================================
            if (method === 'GET' && (path === '/v1/jobs' || path === '/jobs')) {
                // Pagination: ?limit=20&offset=0&status=running
                const limit = Math.min(parseInt(url.searchParams.get('limit')!) || 50, 200);
                const offset = parseInt(url.searchParams.get('offset')!) || 0;
                const filterStatus = url.searchParams.get('status') || null;

                const allJobs: Array<{
                    jobId: string;
                    status: string;
                    source: string | null;
                    startedAt: string;
                    completedAt: string | null;
                    duration: number | null;
                }> = [];
                for (const [id, job] of jobs) {
                    if (filterStatus && job.status !== filterStatus) continue;
                    allJobs.push({
                        jobId: id,
                        status: job.status,
                        source: job.source || null,
                        startedAt: job.startedAt,
                        completedAt: job.completedAt,
                        duration: job.duration,
                    });
                }
                const total = allJobs.length;
                const page = allJobs.slice(offset, offset + limit);
                json(res, 200, { ok: true, jobs: page, total, limit, offset, has_more: offset + limit < total }, requestId);
                return;
            }

            // ================================================================
            // GET /v1/jobs/:id — job detail
            // ================================================================
            const jobDetailMatch = path.match(/^\/(?:v1\/)?jobs\/([a-zA-Z0-9_]+)$/);
            if (method === 'GET' && jobDetailMatch) {
                const jobId = jobDetailMatch[1];
                const job = jobs.get(jobId);
                if (!job) {
                    jsonError(res, 404, 'JOB_NOT_FOUND', `Job ${jobId} not found`, requestId);
                    return;
                }
                json(res, 200, {
                    ok: true,
                    jobId,
                    status: job.status,
                    output: job.output,
                    result: job.result,
                    error: job.error,
                    startedAt: job.startedAt,
                    completedAt: job.completedAt,
                    duration: job.duration,
                    usage: job.memoryUsed ? { execution_ms: job.duration, memory_bytes: job.memoryUsed } : undefined,
                }, requestId);
                return;
            }

            // ================================================================
            // GET /v1/jobs/:id/stream — SSE stream for a running job
            // ================================================================
            const jobStreamMatch = path.match(/^\/(?:v1\/)?jobs\/([a-zA-Z0-9_]+)\/stream$/);
            if (method === 'GET' && jobStreamMatch) {
                const jobId = jobStreamMatch[1];
                const job = jobs.get(jobId);
                if (!job) {
                    jsonError(res, 404, 'JOB_NOT_FOUND', `Job ${jobId} not found`, requestId);
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'x-request-id': requestId,
                });

                // Send replay of existing output
                for (const line of job.output) {
                    res.write(`event: output\ndata: ${JSON.stringify({ line })}\n\n`);
                }

                // If job already done, send final event and close
                if (job.status === 'completed') {
                    res.write(`event: job.completed\ndata: ${JSON.stringify({ result: job.result, duration: job.duration })}\n\n`);
                    res.write(`event: done\ndata: null\n\n`);
                    res.end();
                    return;
                }
                if (job.status === 'failed') {
                    res.write(`event: job.failed\ndata: ${JSON.stringify({ error: job.error, duration: job.duration })}\n\n`);
                    res.write(`event: done\ndata: null\n\n`);
                    res.end();
                    return;
                }
                if (job.status === 'cancelled') {
                    res.write(`event: job.cancelled\ndata: ${JSON.stringify({ message: 'Job was cancelled' })}\n\n`);
                    res.write(`event: done\ndata: null\n\n`);
                    res.end();
                    return;
                }

                // Still running — subscribe for live updates
                job.sseClients.push(res);
                req.on('close', () => {
                    job.sseClients = job.sseClients.filter(c => c !== res);
                });
                return;
            }

            // ================================================================
            // POST /v1/jobs/:id/cancel — cancel a running job
            // ================================================================
            const jobCancelMatch = path.match(/^\/(?:v1\/)?jobs\/([a-zA-Z0-9_]+)\/cancel$/);
            if (method === 'POST' && jobCancelMatch) {
                const jobId = jobCancelMatch[1];
                const job = jobs.get(jobId);
                if (!job) {
                    jsonError(res, 404, 'JOB_NOT_FOUND', `Job ${jobId} not found`, requestId);
                    return;
                }
                if (job.status !== 'running') {
                    jsonError(res, 409, 'JOB_NOT_RUNNING', `Job ${jobId} is already ${job.status}`, requestId);
                    return;
                }
                job.status = 'cancelled';
                job.completedAt = new Date().toISOString();
                job.error = { code: 'JOB_CANCELLED', message: 'Job was cancelled by client' };
                broadcastSSE(jobId, 'job.cancelled', { message: 'Job was cancelled' });
                broadcastSSE(jobId, 'done', null);
                json(res, 200, { ok: true, jobId, status: 'cancelled' }, requestId);
                return;
            }

            // ================================================================
            // GET /v1/modules — list loaded modules
            // ================================================================
            if (method === 'GET' && (path === '/v1/modules' || path === '/modules')) {
                json(res, 200, { ok: true, modules: moduleList }, requestId);
                return;
            }

            // ================================================================
            // GET /v1/info — server info
            // ================================================================
            if (method === 'GET' && (path === '/v1/info' || path === '/info')) {
                const mem = process.memoryUsage();
                json(res, 200, {
                    ok: true,
                    version: CLI_VERSION,
                    lang_version: ROBINPATH_VERSION,
                    host,
                    port,
                    uptime_seconds: Math.round(process.uptime()),
                    started_at: serverStartedAt,
                    config: {
                        max_concurrent: maxConcurrent,
                        job_timeout_ms: jobTimeout,
                        rate_limit: RATE_LIMIT,
                    },
                    memory: {
                        heap_used: mem.heapUsed,
                        heap_total: mem.heapTotal,
                        rss: mem.rss,
                    },
                    jobs: {
                        total: jobs.size,
                        active: getActiveJobCount(),
                    },
                }, requestId);
                return;
            }

            // ================================================================
            // GET /v1/metrics — prometheus-style plain text metrics
            // ================================================================
            if (method === 'GET' && (path === '/v1/metrics' || path === '/metrics')) {
                let completed = 0, failed = 0, cancelled = 0, running = 0;
                let totalDuration = 0, durationCount = 0;
                for (const job of jobs.values()) {
                    if (job.status === 'completed') { completed++; if (job.duration) { totalDuration += job.duration; durationCount++; } }
                    else if (job.status === 'failed') failed++;
                    else if (job.status === 'cancelled') cancelled++;
                    else if (job.status === 'running') running++;
                }
                const mem = process.memoryUsage();
                const lines = [
                    `robinpath_jobs_total ${jobs.size}`,
                    `robinpath_jobs_active ${running}`,
                    `robinpath_jobs_completed ${completed}`,
                    `robinpath_jobs_failed ${failed}`,
                    `robinpath_jobs_cancelled ${cancelled}`,
                    `robinpath_request_duration_avg_ms ${durationCount ? Math.round(totalDuration / durationCount) : 0}`,
                    `robinpath_uptime_seconds ${Math.round(process.uptime())}`,
                    `robinpath_memory_heap_bytes ${mem.heapUsed}`,
                    `robinpath_memory_rss_bytes ${mem.rss}`,
                    `robinpath_requests_total ${totalRequests}`,
                    `robinpath_requests_errors ${totalErrors}`,
                ];
                const payload = lines.join('\n') + '\n';
                res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(payload) });
                res.end(payload);
                return;
            }

            // ================================================================
            // GET /v1/openapi.json — OpenAPI 3.1 specification (built once at startup)
            // ================================================================
            if (method === 'GET' && (path === '/v1/openapi.json' || path === '/openapi.json')) {
                json(res, 200, openApiSpec, requestId);
                return;
            }

            // ================================================================
            // POST /v1/stop — graceful shutdown
            // ================================================================
            if (method === 'POST' && (path === '/v1/stop' || path === '/stop')) {
                // Wait for running jobs to finish (up to 5 seconds)
                const activeJobs: string[] = [];
                for (const [id, job] of jobs) {
                    if (job.status === 'running') activeJobs.push(id);
                }

                json(res, 200, {
                    ok: true,
                    message: activeJobs.length > 0
                        ? `Server stopping after ${activeJobs.length} active job(s) complete`
                        : 'Server stopping',
                    active_jobs: activeJobs,
                }, requestId);

                // Graceful shutdown: wait for active jobs, max 5 seconds
                const shutdownTimeout = setTimeout(() => {
                    server.close();
                    process.exit(0);
                }, 5000);

                if (activeJobs.length === 0) {
                    clearTimeout(shutdownTimeout);
                    server.close();
                    process.exit(0);
                }

                // Check every 200ms if all jobs done
                const shutdownCheck = setInterval(() => {
                    if (getActiveJobCount() === 0) {
                        clearInterval(shutdownCheck);
                        clearTimeout(shutdownTimeout);
                        server.close();
                        process.exit(0);
                    }
                }, 200);
                return;
            }

            // ================================================================
            // 404 — unknown endpoint
            // ================================================================
            jsonError(res, 404, 'NOT_FOUND', `Unknown endpoint: ${method} ${path}`, requestId);

        } catch (err: unknown) {
            totalErrors++;
            const processingMs = Math.round(performance.now() - startTime);
            logEntry({ level: 'error', event: 'request.error', method: method!, path, requestId, error: (err as Error).message, duration: processingMs });
            // Guard: if headers already sent (e.g. SSE streaming), we can't send JSON error
            if (res.headersSent) {
                try { res.end(); } catch {}
            } else {
                res.setHeader('x-processing-ms', processingMs);
                jsonError(res, 500, 'INTERNAL_ERROR', (err as Error).message, requestId);
            }
        }
    });

    // Check if port is available by attempting to listen
    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.log(JSON.stringify({ ok: false, error: `Port ${port} is already in use` }));
            process.exit(1);
        }
        console.log(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
    });

    server.listen(port, host, () => {
        // Output JSON to stdout so RightPlace can parse session + port
        console.log(JSON.stringify({ ok: true, port, host, session, version: CLI_VERSION }));
        logEntry({ level: 'info', event: 'server.start', port, host, version: CLI_VERSION, pid: process.pid });
    });

    // ========================================================================
    // Graceful signal handling (Ctrl+C, Docker stop, K8s SIGTERM)
    // ========================================================================
    function gracefulShutdown(signal: string): void {
        logEntry({ level: 'info', event: 'server.shutdown', signal, active_jobs: getActiveJobCount() });
        // Stop accepting new connections
        server.close();
        clearInterval(jobCleanupInterval);

        // Wait for active jobs (max 10 seconds)
        const forceExit = setTimeout(() => process.exit(0), 10_000);
        forceExit.unref();

        const check = setInterval(() => {
            if (getActiveJobCount() === 0) {
                clearInterval(check);
                clearTimeout(forceExit);
                process.exit(0);
            }
        }, 200);
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

/**
 * robinpath status [-p port] — Check if a server is running
 */
export async function handleStatus(args: string[]): Promise<void> {
    let port: number = 6372;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            i++;
        }
    }

    // Check PID file first
    const pidFile: string = join(homedir(), '.robinpath', `server-${port}.pid`);
    let pid: string | null = null;
    if (existsSync(pidFile)) {
        pid = readFileSync(pidFile, 'utf-8').trim();
    }

    // Try to reach the health endpoint
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json() as { ok: boolean; version?: string };
        if (data.ok) {
            console.log(JSON.stringify({
                ok: true,
                running: true,
                port,
                pid: pid || null,
                version: data.version,
            }));
        } else {
            console.log(JSON.stringify({ ok: true, running: false, port, reason: 'Unexpected response' }));
        }
    } catch {
        console.log(JSON.stringify({ ok: true, running: false, port, pid: pid || null, reason: 'Server not reachable' }));
    }
}

/**
 * Read all of stdin as a string (for piped input)
 */
export function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk: string) => { data += chunk; });
        process.stdin.on('end', () => { resolve(data); });
    });
}
