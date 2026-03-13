/**
 * RobinPath CLI Entry Point (for standalone binary)
 * Bundled by esbuild, packaged as Node.js SEA.
 */
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readdirSync, statSync, watch, appendFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, extname, join, relative, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir, platform, tmpdir, hostname, userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { RobinPath, ROBINPATH_VERSION, Parser, Printer, LineIndexImpl, formatErrorWithContext } from '@wiredwp/robinpath';
import { nativeModules } from './modules/index.js';

// Injected by esbuild at build time via --define, fallback for dev mode
const CLI_VERSION = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '1.51.0';

// ============================================================================
// Global flags
// ============================================================================
let FLAG_QUIET = false;
let FLAG_VERBOSE = false;

function log(...args) {
    if (!FLAG_QUIET) console.log(...args);
}

function logVerbose(...args) {
    if (FLAG_VERBOSE) console.error('[verbose]', ...args);
}

// ============================================================================
// ANSI colors (only when stderr is a TTY)
// ============================================================================
const isTTY = process.stdout.isTTY || process.stderr.isTTY;
const color = {
    red: (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
    green: (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
    yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
    dim: (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
    bold: (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
    cyan: (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
};

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Get the install directory for robinpath
 */
function getInstallDir() {
    return join(homedir(), '.robinpath', 'bin');
}

/**
 * Get the robinpath home directory
 */
function getRobinPathHome() {
    return join(homedir(), '.robinpath');
}

const MODULES_DIR = join(homedir(), '.robinpath', 'modules');
const MODULES_MANIFEST = join(MODULES_DIR, 'modules.json');
const CACHE_DIR = join(homedir(), '.robinpath', 'cache');

/** Convert Windows path to POSIX for tar commands */
function toTarPath(p) {
    if (process.platform !== 'win32') return p;
    // C:\Users\foo → /c/Users/foo
    return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
}

/**
 * Check for newer versions on GitHub
 */
async function checkForUpdates() {
    try {
        const res = await fetch('https://api.github.com/repos/wiredwp/robinpath-cli/releases/latest');
        const data = await res.json();
        const latest = data.tag_name.replace('v', '');
        if (latest !== CLI_VERSION) {
            console.log(`\n${color.yellow('⚡')} New version available: ${color.green('v' + latest)} (you have v${CLI_VERSION})`);
            console.log(`   Run ${color.cyan('robinpath update')} to upgrade\n`);
        }
    } catch {
        // silently ignore update check failures
    }
}

/**
 * Update: re-run the install script for the current platform
 */
function handleUpdate() {
    const isWindows = platform() === 'win32';
    const env = { ...process.env, ROBINPATH_CURRENT_VERSION: CLI_VERSION };
    try {
        if (isWindows) {
            execSync('powershell -NoProfile -Command "irm https://dev.robinpath.com/install.ps1 | iex"', { stdio: 'inherit', env });
        } else {
            execSync('curl -fsSL https://dev.robinpath.com/install.sh | sh', { stdio: 'inherit', env });
        }
    } catch (err) {
        console.error(color.red('Update failed:') + ` ${err.message}`);
        process.exit(1);
    }
}

/**
 * Write DOCUMENTATION.md to ~/.robinpath/ for AI agents and external tools
 */
function writeDocsFile() {
    const docsPath = join(getRobinPathHome(), 'DOCUMENTATION.md');
    const modulesList = nativeModules.map(m => {
        const fns = Object.keys(m.functions).join(', ');
        const desc = m.moduleMetadata?.description || '';
        return `### \`${m.name}\` — ${desc}\nFunctions: ${fns}`;
    }).join('\n\n');

    const content = `# RobinPath CLI — Documentation
> Version: ${CLI_VERSION} | Language: ${ROBINPATH_VERSION} | Binary: robinpath, rp

## Installation
- macOS/Linux: \`curl -fsSL https://dev.robinpath.com/install.sh | bash\`
- Windows: \`irm https://dev.robinpath.com/install.ps1 | iex\`

## Quick Start
\`\`\`bash
robinpath app.rp              # Run a script
robinpath -e 'log "hello"'    # Inline execution
robinpath                      # Start REPL
robinpath start                # Start HTTP server
\`\`\`

## CLI Commands
| Command | Description |
|---------|-------------|
| \`<file.rp>\` | Run a script (.rp, .robin, auto-resolved) |
| \`-e <code>\` | Execute inline code |
| \`-w, --watch <file>\` | Re-run on file changes |
| \`fmt <file\\|dir>\` | Format code (--write, --check, --diff) |
| \`check <file>\` | Syntax check (--json) |
| \`ast <file>\` | Dump AST (--compact) |
| \`test [dir\\|file]\` | Run *.test.rp tests (--json) |
| \`add <pkg>[@ver]\` | Install module |
| \`remove <pkg>\` | Uninstall module |
| \`upgrade <pkg>\` | Upgrade module |
| \`modules list\` | List installed modules |
| \`modules upgrade\` | Upgrade all modules |
| \`modules init\` | Scaffold new module |
| \`search [query]\` | Search registry (--category, --sort, --page, --limit, --json) |
| \`info\` | System info & paths (--json) |
| \`info <pkg>\` | Module details |
| \`audit\` | Check module health |
| \`init\` | Create project (robinpath.json) |
| \`install\` | Install project dependencies |
| \`doctor\` | Diagnose environment |
| \`env set\\|list\\|remove\` | Manage environment secrets |
| \`cache list\\|clean\` | Manage download cache |
| \`login / logout / whoami\` | Authentication |
| \`publish [dir]\` | Publish module (--public, --private, --org, --dry-run, --patch/--minor/--major) |
| \`pack [dir]\` | Create tarball |
| \`deprecate <pkg>\` | Deprecate module |
| \`sync\` | List published modules |
| \`start\` | Start HTTP server |
| \`status\` | Check server status |
| \`update\` | Update CLI to latest |
| \`install\` | Install to system PATH |
| \`uninstall\` | Remove from system |

## Global Flags
| Flag | Description |
|------|-------------|
| \`-q, --quiet\` | Suppress non-error output |
| \`--verbose\` | Show timing and debug info |
| \`-v, --version\` | Show version |
| \`-h, --help\` | Show help |

## HTTP Server (\`robinpath start\`)

Start an HTTP server exposing the RobinPath engine via REST API. One server handles all requests. Variables persist across requests (conversational execution).

### Server Flags
| Flag | Default | Description |
|------|---------|-------------|
| \`-p, --port\` | 6372 | Port |
| \`-s, --session\` | auto UUID | Session secret (gatekeeper) |
| \`--host\` | 127.0.0.1 | Bind address |
| \`--timeout\` | 30000 | Script timeout (ms) |
| \`--max-concurrent\` | 5 | Max parallel jobs |
| \`--cors-origin\` | * | CORS origin |
| \`--log-file\` | (none) | JSON log file |
| \`--max-body\` | 5000000 | Max body (bytes) |

### Startup
\`\`\`bash
robinpath start -p 6372 -s my-secret
# Output: {"ok":true,"port":6372,"host":"127.0.0.1","session":"...","version":"${CLI_VERSION}"}
\`\`\`

### Authentication
All endpoints (except GET /v1/health) require: \`x-robinpath-session: <token>\`

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /v1/health | No | Health check |
| POST | /v1/execute | Yes | Execute script (JSON: {"code":"..."} or text/plain body) |
| POST | /v1/execute/file | Yes | Execute file ({"file":"./script.rp"}) |
| POST | /v1/check | Yes | Syntax check ({"script":"..."}) |
| POST | /v1/fmt | Yes | Format code ({"script":"..."}) |
| GET | /v1/jobs | Yes | List jobs (?status=running&limit=10) |
| GET | /v1/jobs/:id | Yes | Job details |
| GET | /v1/jobs/:id/stream | Yes | SSE stream for job |
| POST | /v1/jobs/:id/cancel | Yes | Cancel job |
| GET | /v1/modules | Yes | List loaded modules |
| GET | /v1/info | Yes | Server runtime info |
| GET | /v1/metrics | Yes | Prometheus metrics |
| GET | /v1/openapi.json | Yes | OpenAPI 3.1 spec |
| POST | /v1/stop | Yes | Graceful shutdown |

### Execute Response
\`\`\`json
{"ok":true,"jobId":"...","status":"completed","output":"...","duration":12}
\`\`\`

### SSE Streaming
Add \`Accept: text/event-stream\` header. Events: started, output, completed, job.failed, job.cancelled, done.

### Webhooks
Add \`webhook\` (URL) and \`webhook_secret\` to request body. Returns 202 immediately. Signature: \`X-Webhook-Signature: sha256=<hmac-hex>\`

### Optional Headers
| Header | Description |
|--------|-------------|
| \`x-request-id\` | Client request ID (auto UUID if missing) |
| \`x-idempotency-key\` | Prevent duplicate execution (5-min TTL) |
| \`Accept: text/event-stream\` | SSE streaming |
| \`Content-Type: text/plain\` | Raw code body (no JSON) |

### Response Headers
\`x-processing-ms\`, \`x-request-id\`, \`x-rate-limit-limit\`, \`x-rate-limit-remaining\`, \`x-rate-limit-reset\`

### Features
Session gatekeeper, API versioning (/v1/), SSE streaming, webhook callbacks (HMAC-SHA256), idempotency keys, rate limiting, job queue with cancel, structured JSON logging, Prometheus metrics, OpenAPI spec, graceful shutdown, persistent runtime state, plain text body support, PID file management.

## SDK (@robinpath/sdk)

For JavaScript/TypeScript apps. Direct in-process execution, no HTTP server.

\`\`\`bash
npm install @robinpath/sdk
\`\`\`

\`\`\`javascript
import { createRuntime } from '@robinpath/sdk';

const rp = createRuntime();                              // full access
const rp = createRuntime({ timeout: 5000 });             // with timeout
const rp = createRuntime({ permissions: 'none' });       // sandboxed
const rp = createRuntime({ modules: ['math', 'string'] }); // whitelist

const result = await rp.run('log math.add 1 2');
// { ok, output, value, logs, variables, error, stats }

const result = await rp.run('log $name', { name: 'Robin' }); // context

const stream = rp.stream(code);
stream.on('log', (log) => console.log(log.message));
const result = await stream.result;
\`\`\`

## Integration (non-JS languages)

For Rust, Python, Go, PHP, Ruby, C#, Java — use \`robinpath start\` HTTP server:

1. Spawn: \`robinpath start -p <port> [-s <secret>]\`
2. Parse startup JSON from stdout to get session token
3. Send HTTP requests with \`x-robinpath-session\` header
4. Stop: \`POST /v1/stop\` or send SIGTERM

### Rust Example
\`\`\`rust
let child = Command::new("robinpath").args(["start", "-p", "6372"]).stdout(Stdio::piped()).spawn()?;
// Read first line → parse JSON → get session
// reqwest::Client POST /v1/execute with x-robinpath-session header
\`\`\`

### Python Example
\`\`\`python
proc = subprocess.Popen(["robinpath", "start", "-p", "6372"], stdout=subprocess.PIPE)
startup = json.loads(proc.stdout.readline())
session = startup["session"]
requests.post("http://127.0.0.1:6372/v1/execute",
    headers={"x-robinpath-session": session}, json={"code": "log 1"})
\`\`\`

## Language Syntax
\`\`\`
set $x = 1                          # Variable assignment
$x = 1                              # Short form
log "hello"                         # Print output
set $r = math.add 1 2               # Module function call
set $s = "hello " + $name           # String concatenation
if $x > 5                           # If block
  log "big"
endif
for $i in array.create 1 2 3        # For loop
  log $i
endfor
def greet $name                     # Function definition
  log "Hello " + $name
enddef
on "myEvent" $data                  # Event handler
  log $data
endon
# This is a comment                 # Comments
\`\`\`

File extensions: .rp, .robin (both recognized, auto-resolved)

## File Structure
| Path | Purpose |
|------|---------|
| ~/.robinpath/ | Home directory |
| ~/.robinpath/bin/ | Binary installation |
| ~/.robinpath/modules/ | Installed modules |
| ~/.robinpath/modules/modules.json | Module manifest |
| ~/.robinpath/cache/ | Download cache |
| ~/.robinpath/auth.json | Auth credentials |
| ~/.robinpath/history | REPL history |
| ~/.robinpath/env | Environment secrets |
| ~/.robinpath/server-<port>.pid | Server PID file |
| robinpath.json | Project config |
| robinpath-lock.json | Lock file |

## Native Modules

${modulesList}

---
Generated by RobinPath v${CLI_VERSION}
`;
    mkdirSync(getRobinPathHome(), { recursive: true });
    writeFileSync(docsPath, content, 'utf-8');
}

/**
 * Install: copy this exe to ~/.robinpath/bin and add to PATH
 */
function handleInstall() {
    const installDir = getInstallDir();
    const isWindows = platform() === 'win32';
    const exeName = isWindows ? 'robinpath.exe' : 'robinpath';
    const rpName = isWindows ? 'rp.exe' : 'rp';
    const dest = join(installDir, exeName);
    const rpDest = join(installDir, rpName);
    const src = process.execPath;

    // Already installed in the right place?
    if (resolve(src) === resolve(dest)) {
        log(`robinpath v${CLI_VERSION} is already installed.`);
        return;
    }

    // Create directory
    mkdirSync(installDir, { recursive: true });

    // Copy binary
    copyFileSync(src, dest);

    // Copy alias binary (rp)
    copyFileSync(src, rpDest);

    // Write documentation file
    try { writeDocsFile(); } catch { /* ignore docs write failure */ }

    // Make executable on Unix
    if (!isWindows) {
        try {
            chmodSync(dest, 0o755);
            chmodSync(rpDest, 0o755);
        } catch {
            // ignore chmod failures
        }
    }

    // Add to PATH
    if (isWindows) {
        try {
            const checkPath = execSync(
                `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`,
                { encoding: 'utf-8' }
            ).trim();

            if (!checkPath.includes(installDir)) {
                execSync(
                    `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${installDir};' + [Environment]::GetEnvironmentVariable('Path','User'),'User')"`,
                    { encoding: 'utf-8' }
                );
            }
        } catch {
            log(`Could not update PATH automatically.`);
            log(`Add this to your PATH manually: ${installDir}`);
        }
    } else {
        // Unix: suggest adding to shell profile
        const shellProfile = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
        const exportLine = `export PATH="${installDir}:$PATH"`;
        log(`Add to ${shellProfile}:`);
        log(`  ${exportLine}`);
    }

    log('');
    log(`Installed robinpath v${CLI_VERSION}`);
    log(`Location: ${dest}`);
    log(`Alias:    ${rpDest} (use "rp" as shorthand)`);
    log('');
    log('Restart your terminal, then run:');
    log('  robinpath --version');
}

/**
 * Uninstall: remove ~/.robinpath and clean PATH
 */
function handleUninstall() {
    const installDir = getInstallDir();
    const robinpathHome = getRobinPathHome();
    const isWindows = platform() === 'win32';

    // Remove the directory
    if (existsSync(robinpathHome)) {
        rmSync(robinpathHome, { recursive: true, force: true });
        log(`Removed ${robinpathHome}`);
    } else {
        log('Nothing to remove.');
    }

    // Clean PATH
    if (isWindows) {
        try {
            execSync(
                `powershell -NoProfile -Command "$p = [Environment]::GetEnvironmentVariable('Path','User'); $clean = ($p -split ';' | Where-Object { $_ -notlike '*\\.robinpath\\bin*' }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$clean,'User')"`,
                { encoding: 'utf-8' }
            );
            log('Removed from PATH');
        } catch {
            log(`Could not update PATH automatically.`);
            log(`Remove "${installDir}" from your PATH manually.`);
        }
    } else {
        log(`Remove the robinpath PATH line from your shell profile.`);
    }

    log('');
    log('RobinPath uninstalled. Restart your terminal.');
}

/**
 * Resolve a script file path, auto-adding .rp or .robin extension if needed
 */
function resolveScriptPath(fileArg) {
    const filePath = resolve(fileArg);
    if (existsSync(filePath)) return filePath;

    if (!extname(filePath)) {
        const rpPath = filePath + '.rp';
        if (existsSync(rpPath)) return rpPath;

        const robinPath = filePath + '.robin';
        if (existsSync(robinPath)) return robinPath;
    }

    return null;
}

/**
 * Display a rich error with context
 */
function displayError(error, script) {
    // Check for pre-formatted error message
    if (error.__formattedMessage) {
        console.error(color.red('Error:') + ' ' + error.__formattedMessage);
        return;
    }

    // Try to use formatErrorWithContext for rich error display
    if (script) {
        try {
            const formatted = formatErrorWithContext({ message: error.message, code: script });
            if (formatted && formatted !== error.message) {
                console.error(color.red('Error:') + ' ' + formatted);
                return;
            }
        } catch {
            // Fall through to simple error
        }
    }

    console.error(color.red('Error:') + ' ' + error.message);
}

/**
 * Execute a script and exit with proper code
 */
async function runScript(script, filePath) {
    const rp = await createRobinPath();
    const startTime = FLAG_VERBOSE ? performance.now() : 0;

    try {
        await rp.executeScript(script);
        if (FLAG_VERBOSE) {
            const elapsed = (performance.now() - startTime).toFixed(1);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            logVerbose(`Executed in ${elapsed}ms, heap: ${mem}MB`);
        }
    } catch (error) {
        displayError(error, script);
        process.exit(1);
    }
}

/**
 * HTTP server mode — robinpath start [-p port] [-s session] [--host host] [--timeout ms] [--max-concurrent n] [--cors-origin origin]
 *
 * Enterprise-grade local application server with:
 * - Session-based authentication (x-robinpath-session header)
 * - API versioning (/v1/...)
 * - Job management with cancellation
 * - SSE streaming for real-time progress
 * - Idempotency keys for safe retries
 * - Request IDs and structured error codes
 * - Usage tracking per response
 * - Rate limiting headers
 */
async function handleStart(args) {
    // Parse flags
    let port = 6372;
    let session = null;
    let host = '127.0.0.1';
    let jobTimeout = 30000;
    let maxConcurrent = 5;
    let corsOrigin = '*';
    let logFile = null;
    let maxBodySize = 5_000_000; // 5MB default

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
    const rp = await createRobinPath();

    // ========================================================================
    // Job management
    // ========================================================================
    const jobs = new Map();     // jobId -> { status, output, result, error, startedAt, completedAt, script, abortController, sseClients }
    const idempotencyCache = new Map(); // idempotency key -> { jobId, response }

    function generateJobId() {
        return 'job_' + randomUUID().replace(/-/g, '').slice(0, 12);
    }

    function generateRequestId() {
        return 'req_' + randomUUID().replace(/-/g, '').slice(0, 12);
    }

    function getActiveJobCount() {
        let count = 0;
        for (const job of jobs.values()) {
            if (job.status === 'running') count++;
        }
        return count;
    }

    // Collect module info for /v1/modules endpoint
    const moduleList = [];
    for (const mod of nativeModules) {
        moduleList.push({ name: mod.name, type: 'native', methods: mod.moduleMetadata?.methods || [], functionMetadata: mod.functionMetadata || null });
    }

    // Server start time for uptime tracking
    const serverStartedAt = new Date().toISOString();

    // ========================================================================
    // Rate limiting (simple sliding window per session)
    // ========================================================================
    const RATE_LIMIT = 100;           // requests per window
    const RATE_WINDOW_MS = 60_000;    // 1 minute
    let rateWindowStart = Date.now();
    let rateCount = 0;

    function checkRateLimit() {
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
    let totalRequests = 0;
    let totalErrors = 0;

    // ========================================================================
    // Job TTL — auto-cleanup completed jobs after 30 minutes
    // ========================================================================
    const JOB_TTL_MS = 30 * 60_000; // 30 minutes
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
    function logEntry(entry) {
        if (!logFile) return;
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        try { appendFileSync(logFile, line); } catch {}
    }

    // Write PID file for process management
    const pidFile = join(homedir(), '.robinpath', `server-${port}.pid`);
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
    function parseBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
                if (body.length > maxBodySize) {
                    reject(new Error(`Request body too large (max ${maxBodySize} bytes)`));
                    req.destroy();
                }
            });
            req.on('end', () => {
                if (!body) return resolve({});
                const contentType = (req.headers['content-type'] || '').toLowerCase();
                // Plain text — treat entire body as a script
                if (contentType.startsWith('text/plain')) {
                    return resolve({ script: body });
                }
                // JSON
                try { resolve(JSON.parse(body)); }
                catch { reject(new Error('Invalid JSON body. Tip: use Content-Type: text/plain to send raw script code.')); }
            });
            req.on('error', reject);
        });
    }

    // Send JSON response helper with enterprise headers
    // Creates a shallow copy to avoid mutating the original (important for idempotency cache)
    function json(res, status, data, requestId) {
        const out = { ...data };
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
    function jsonError(res, status, code, message, requestId) {
        json(res, status, { ok: false, error: { code, message } }, requestId);
    }

    // Active job set for concurrent-safe output capture
    // Instead of hijacking global console.log (which breaks with concurrent jobs),
    // we install a single interceptor that routes output to the correct job.
    const activeJobForCapture = new Set(); // jobIds currently capturing
    const origLog = console.log;
    const origErr = console.error;
    let currentCapturingJob = null; // the job currently executing (single-threaded JS)

    console.log = (...args) => {
        if (currentCapturingJob) {
            const line = args.join(' ');
            currentCapturingJob.output.push(line);
            broadcastSSE(currentCapturingJob._jobId, 'output', { line });
        } else {
            origLog(...args);
        }
    };
    console.error = (...args) => {
        if (currentCapturingJob) {
            const line = '[error] ' + args.join(' ');
            currentCapturingJob.output.push(line);
            broadcastSSE(currentCapturingJob._jobId, 'output', { line, level: 'error' });
        } else {
            origErr(...args);
        }
    };

    // Execute a job (with timeout, output capture, and SSE broadcasting)
    async function executeJob(jobId, script) {
        const job = jobs.get(jobId);
        job._jobId = jobId; // store for output routing
        const startTime = performance.now();

        // Set up timeout
        let timeoutHandle = null;
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
        } catch (err) {
            currentCapturingJob = null;
            if (timeoutHandle) clearTimeout(timeoutHandle);

            if (!timedOut) {
                job.status = 'failed';
                job.error = { code: 'SCRIPT_ERROR', message: err.message };
                job.completedAt = new Date().toISOString();
                job.duration = Math.round(performance.now() - startTime);
                job.memoryUsed = process.memoryUsage().heapUsed;
                broadcastSSE(jobId, 'job.failed', { error: job.error, duration: job.duration });
                broadcastSSE(jobId, 'done', null);
            }
        }
    }

    // SSE broadcasting
    function broadcastSSE(jobId, event, data) {
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
    async function deliverWebhook(webhookUrl, webhookSecret, event, payload) {
        try {
            const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });
            const headers = { 'Content-Type': 'application/json' };
            if (webhookSecret) {
                const sig = createHmac('sha256', webhookSecret).update(body).digest('hex');
                headers['x-robinpath-signature'] = 'sha256=' + sig;
            }
            await fetch(webhookUrl, { method: 'POST', headers, body });
            logEntry({ level: 'info', event: 'webhook.delivered', url: webhookUrl, payload_event: event });
        } catch (err) {
            logEntry({ level: 'error', event: 'webhook.failed', url: webhookUrl, error: err.message });
        }
    }

    // Resolve script from body — supports both `script` (inline) and `file` (path) fields
    function resolveScript(body) {
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
    const openApiSpec = {
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
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, `http://${host}:${port}`);
        const path = url.pathname;
        const method = req.method;
        const requestId = req.headers['x-request-id'] || generateRequestId();
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
        const reqSession = req.headers['x-robinpath-session'];
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
        logEntry({ level: 'info', event: 'request', method, path, requestId, session: reqSession ? reqSession.slice(0, 4) + '***' : null });

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
                const script = resolved.script;
                const source = resolved.source;

                // Dry run mode — parse and validate without executing
                const dryRun = url.searchParams.get('dry') === 'true' || body.dry === true;
                if (dryRun) {
                    try {
                        const parser = new Parser(script);
                        await parser.parse();
                        json(res, 200, { ok: true, dry_run: true, source, message: 'Script is valid' }, requestId);
                    } catch (err) {
                        const lineMatch = err.message.match(/line (\d+)/i);
                        const colMatch = err.message.match(/column (\d+)/i);
                        json(res, 200, {
                            ok: false, dry_run: true, source,
                            error: { code: 'SYNTAX_ERROR', message: err.message, line: lineMatch ? parseInt(lineMatch[1]) : null, column: colMatch ? parseInt(colMatch[1]) : null },
                        }, requestId);
                    }
                    return;
                }

                // Idempotency check
                const idempotencyKey = req.headers['x-idempotency-key'];
                if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
                    const cached = idempotencyCache.get(idempotencyKey);
                    cached.requestId = requestId;
                    cached.idempotent = true;
                    json(res, 200, cached, requestId);
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
                function onJobDone() {
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

                    const job = jobs.get(jobId);
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
                    const job = jobs.get(jobId);
                    const processingMs = Math.round(performance.now() - startTime);
                    res.setHeader('x-processing-ms', processingMs);

                    const response = {
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

                    json(res, 200, response, requestId);
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
                } catch (err) {
                    const lineMatch = err.message.match(/line (\d+)/i);
                    const colMatch = err.message.match(/column (\d+)/i);
                    json(res, 200, {
                        ok: false,
                        error: { code: 'SYNTAX_ERROR', message: err.message, line: lineMatch ? parseInt(lineMatch[1]) : null, column: colMatch ? parseInt(colMatch[1]) : null },
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
                } catch (err) {
                    json(res, 200, { ok: false, error: { code: 'FORMAT_ERROR', message: err.message } }, requestId);
                }
                return;
            }

            // ================================================================
            // GET /v1/jobs — list jobs
            // ================================================================
            if (method === 'GET' && (path === '/v1/jobs' || path === '/jobs')) {
                // Pagination: ?limit=20&offset=0&status=running
                const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
                const offset = parseInt(url.searchParams.get('offset')) || 0;
                const filterStatus = url.searchParams.get('status') || null;

                const allJobs = [];
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
                const activeJobs = [];
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

        } catch (err) {
            totalErrors++;
            const processingMs = Math.round(performance.now() - startTime);
            logEntry({ level: 'error', event: 'request.error', method, path, requestId, error: err.message, duration: processingMs });
            // Guard: if headers already sent (e.g. SSE streaming), we can't send JSON error
            if (res.headersSent) {
                try { res.end(); } catch {}
            } else {
                res.setHeader('x-processing-ms', processingMs);
                jsonError(res, 500, 'INTERNAL_ERROR', err.message, requestId);
            }
        }
    });

    // Check if port is available by attempting to listen
    server.on('error', (err) => {
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
    function gracefulShutdown(signal) {
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
async function handleStatus(args) {
    let port = 6372;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            i++;
        }
    }

    // Check PID file first
    const pidFile = join(homedir(), '.robinpath', `server-${port}.pid`);
    let pid = null;
    if (existsSync(pidFile)) {
        pid = readFileSync(pidFile, 'utf-8').trim();
    }

    // Try to reach the health endpoint
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json();
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
function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => { resolve(data); });
    });
}

// ============================================================================
// Cloud / Auth utilities
// ============================================================================

const CLOUD_URL = process.env.ROBINPATH_CLOUD_URL || 'https://dev.robinpath.com';
const PLATFORM_URL = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';

function getAuthPath() {
    return join(homedir(), '.robinpath', 'auth.json');
}

function readAuth() {
    try {
        const authPath = getAuthPath();
        if (!existsSync(authPath)) return null;
        const data = JSON.parse(readFileSync(authPath, 'utf-8'));
        if (!data.token) return null;
        return data;
    } catch {
        return null;
    }
}

function writeAuth(data) {
    const authPath = getAuthPath();
    const dir = dirname(authPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf-8');
    // Restrict permissions on Unix
    if (platform() !== 'win32') {
        try { chmodSync(authPath, 0o600); } catch { /* ignore */ }
    }
}

function removeAuth() {
    const authPath = getAuthPath();
    if (existsSync(authPath)) {
        unlinkSync(authPath);
    }
}

function getAuthToken() {
    const auth = readAuth();
    if (!auth) return null;
    // Check expiry
    if (auth.expiresAt && Date.now() >= auth.expiresAt * 1000) {
        return null;
    }
    return auth.token;
}

function requireAuth() {
    const token = getAuthToken();
    if (!token) {
        console.error(color.red('Error:') + ' Not logged in. Run ' + color.cyan('robinpath login') + ' to sign in.');
        process.exit(1);
    }
    return token;
}

async function platformFetch(path, opts = {}) {
    const token = requireAuth();
    const headers = { Authorization: `Bearer ${token}`, ...opts.headers };
    const url = `${PLATFORM_URL}${path}`;
    const res = await fetch(url, { ...opts, headers });
    return res;
}

// ============================================================================
// Module management utilities
// ============================================================================

function readModulesManifest() {
    try {
        if (!existsSync(MODULES_MANIFEST)) return {};
        return JSON.parse(readFileSync(MODULES_MANIFEST, 'utf-8'));
    } catch {
        return {};
    }
}

function writeModulesManifest(manifest) {
    if (!existsSync(MODULES_DIR)) {
        mkdirSync(MODULES_DIR, { recursive: true });
    }
    writeFileSync(MODULES_MANIFEST, JSON.stringify(manifest, null, 2), 'utf-8');
}

function getModulePath(packageName) {
    // @robinpath/slack → ~/.robinpath/modules/@robinpath/slack
    return join(MODULES_DIR, ...packageName.split('/'));
}

function parsePackageSpec(spec) {
    if (!spec) return null;
    // Handle @scope/name@version or @scope/name or name@version or name
    let fullName, version = null;

    if (spec.startsWith('@')) {
        // Scoped: @scope/name@version
        const lastAt = spec.lastIndexOf('@');
        if (lastAt > 0 && spec.indexOf('/') < lastAt) {
            fullName = spec.slice(0, lastAt);
            version = spec.slice(lastAt + 1);
        } else {
            fullName = spec;
        }
    } else {
        // Unscoped: name@version
        const atIdx = spec.indexOf('@');
        if (atIdx > 0) {
            fullName = spec.slice(0, atIdx);
            version = spec.slice(atIdx + 1);
        } else {
            fullName = spec;
        }
    }

    // Parse scope and name
    let scope, name;
    if (fullName.startsWith('@') && fullName.includes('/')) {
        const parts = fullName.slice(1).split('/');
        scope = parts[0];
        name = parts.slice(1).join('/');
    } else {
        scope = null;
        name = fullName;
    }

    return { scope, name, fullName, version };
}

/**
 * Load all installed modules from ~/.robinpath/modules/ into a RobinPath instance
 */
async function loadInstalledModules(rp) {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);
    if (entries.length === 0) return;

    for (const [packageName, info] of entries) {
        try {
            const modDir = getModulePath(packageName);
            // Read package.json to find entry point
            let entryPoint = 'dist/index.js';
            const pkgJsonPath = join(modDir, 'package.json');
            if (existsSync(pkgJsonPath)) {
                try {
                    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
                    if (pkg.main) entryPoint = pkg.main;
                } catch { /* use default */ }
            }

            const modulePath = join(modDir, entryPoint);
            if (!existsSync(modulePath)) {
                if (FLAG_VERBOSE) logVerbose(`Module ${packageName}: entry not found at ${entryPoint}, skipping`);
                continue;
            }

            const mod = await import(pathToFileURL(modulePath).href);
            const adapter = mod.default;

            if (!adapter || !adapter.name || !adapter.functions) {
                if (FLAG_VERBOSE) logVerbose(`Module ${packageName}: invalid ModuleAdapter, skipping`);
                continue;
            }

            // Register module using public API
            rp.registerModule(adapter.name, adapter.functions);
            if (adapter.functionMetadata) {
                rp.registerModuleMeta(adapter.name, adapter.functionMetadata);
            }
            if (adapter.moduleMetadata) {
                rp.registerModuleInfo(adapter.name, adapter.moduleMetadata);
            }

            // If global, also register functions without module prefix
            if (adapter.global === true) {
                for (const [funcName, handler] of Object.entries(adapter.functions)) {
                    rp.registerBuiltin(funcName, handler);
                }
            }

            if (FLAG_VERBOSE) logVerbose(`Loaded module: ${packageName}@${info.version}`);
        } catch (err) {
            // Never fatal — warn and continue
            console.error(color.yellow('Warning:') + ` Failed to load module ${packageName}: ${err.message}`);
        }
    }
}

/**
 * Create a RobinPath instance with all installed modules loaded
 */
async function createRobinPath(opts) {
    const rp = new RobinPath(opts);

    // Register native modules (bundled in binary, always available)
    for (const mod of nativeModules) {
        rp.registerModule(mod.name, mod.functions);
        if (mod.functionMetadata) {
            rp.registerModuleMeta(mod.name, mod.functionMetadata);
        }
        if (mod.moduleMetadata) {
            rp.registerModuleInfo(mod.name, mod.moduleMetadata);
        }
    }

    // Load user-installed external modules (can override natives)
    await loadInstalledModules(rp);
    return rp;
}

function openBrowser(url) {
    const plat = platform();
    try {
        if (plat === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (plat === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        log(color.yellow('Could not open browser automatically.'));
        log(`Open this URL manually: ${url}`);
    }
}

/**
 * Decode a JWT payload (no verification — just base64url decode the claims).
 */
function decodeJWTPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    } catch {
        return null;
    }
}

// ============================================================================
// Cloud commands
// ============================================================================

/**
 * robinpath login — Sign in via browser OAuth
 */
async function handleLogin() {
    // Check if already logged in
    const existing = readAuth();
    if (existing && existing.expiresAt && Date.now() < existing.expiresAt * 1000) {
        log(`Already logged in as ${color.cyan(existing.email)}`);
        log(`Token expires ${new Date(existing.expiresAt * 1000).toLocaleDateString()}`);
        log(`Run ${color.cyan('robinpath logout')} to sign out first.`);
        return;
    }

    return new Promise((resolveLogin) => {
        const server = createServer((req, res) => {
            const url = new URL(req.url, `http://localhost`);
            if (url.pathname !== '/callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const token = url.searchParams.get('token');
            const email = url.searchParams.get('email');
            const name = url.searchParams.get('name');

            if (!token) {
                res.writeHead(400);
                res.end('Missing token');
                return;
            }

            // Decode JWT to get expiry
            const claims = decodeJWTPayload(token);
            const expiresAt = claims?.exp || (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

            // Save auth
            writeAuth({ token, email: email || '', name: name || '', expiresAt });

            // Respond with success page
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head><title>RobinPath CLI</title></head>
<body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center">
<h1 style="font-size:24px;color:#22c55e">Signed in!</h1>
<p style="color:#888">You can close this tab and return to your terminal.</p>
</div>
</body>
</html>`);

            // Close server and resolve
            server.close();
            clearTimeout(timeout);
            log(color.green('Logged in') + ` as ${color.cyan(email || 'unknown')}`);
            resolveLogin();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const callbackUrl = `http://localhost:${port}/callback`;

            // Generate a verification code the user can match in the browser
            const code = 'ROBIN-' + Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
            const deviceName = require('os').hostname();
            const deviceOS = process.platform;

            const loginUrl = `${CLOUD_URL}/api/auth/cli?callback=${encodeURIComponent(callbackUrl)}&code=${encodeURIComponent(code)}&device=${encodeURIComponent(deviceName)}&os=${encodeURIComponent(deviceOS)}`;

            log('Opening browser to sign in...');
            log('');
            log(`  Verification code: ${color.cyan(code)}`);
            log(`  Device: ${color.dim(deviceName)} (${color.dim(deviceOS)})`);
            log('');
            log(color.dim('Confirm this code matches in your browser.'));
            log('');
            log(color.dim(`If the browser doesn't open, visit:`));
            log(color.cyan(loginUrl));
            log('');

            openBrowser(loginUrl);
        });

        // Timeout after 5 minutes
        const timeout = setTimeout(() => {
            server.close();
            console.error(color.red('Error:') + ' Login timed out (5 minutes). Please try again.');
            process.exit(1);
        }, 5 * 60 * 1000);
    });
}

/**
 * robinpath logout — Remove stored credentials
 */
function handleLogout() {
    const auth = readAuth();
    if (auth) {
        removeAuth();
        log('Logged out.');
    } else {
        log('Not logged in.');
    }
}

/**
 * robinpath whoami — Show current user and account info
 */
async function handleWhoami() {
    const auth = readAuth();
    if (!auth) {
        log('Not logged in. Run ' + color.cyan('robinpath login') + ' to sign in.');
        return;
    }

    // Check if token is expired
    if (auth.expiresAt && Date.now() >= auth.expiresAt * 1000) {
        log(color.yellow('Token expired.') + ' Run ' + color.cyan('robinpath login') + ' to refresh.');
        return;
    }

    log(color.bold('Local credentials:'));
    log(`  Email:   ${auth.email || color.dim('(none)')}`);
    log(`  Name:    ${auth.name || color.dim('(none)')}`);

    if (auth.expiresAt) {
        const msLeft = auth.expiresAt * 1000 - Date.now();
        const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const expiryDate = new Date(auth.expiresAt * 1000).toLocaleDateString();
        const remaining = daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h remaining` : `${hoursLeft}h remaining`;
        log(`  Expires: ${expiryDate} (${remaining})`);
    } else {
        log(`  Expires: ${color.dim('(unknown)')}`);
    }

    // Try fetching server profile
    try {
        const res = await platformFetch('/v1/me');
        if (res.ok) {
            const body = await res.json();
            const user = body.data || body;
            log('');
            log(color.bold('Server profile:'));
            if (user.username) log(`  Username: ${user.username}`);
            if (user.tier) log(`  Tier:     ${user.tier}`);
            if (user.role) log(`  Role:     ${user.role}`);
        } else if (res.status === 401) {
            log('');
            log(color.yellow('Token rejected by server.') + ' Run ' + color.cyan('robinpath login') + ' to refresh.');
        }
    } catch (err) {
        log('');
        log(color.dim(`Could not reach server: ${err.message}`));
    }
}

/**
 * robinpath publish [dir] — Publish a module to the registry
 */
async function handlePublish(args) {
    const token = requireAuth();
    const isDryRun = args.includes('--dry-run');
    const targetArg = args.find(a => !a.startsWith('-') && !a.startsWith('--org')) || '.';
    const targetDir = resolve(targetArg);

    // Read package.json
    const pkgPath = join(targetDir, 'package.json');
    if (!existsSync(pkgPath)) {
        console.error(color.red('Error:') + ` No package.json found in ${targetDir}`);
        process.exit(2);
    }

    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch (err) {
        console.error(color.red('Error:') + ` Invalid package.json: ${err.message}`);
        process.exit(2);
    }

    if (!pkg.name) {
        console.error(color.red('Error:') + ' package.json is missing "name" field');
        process.exit(2);
    }
    if (!pkg.version) {
        console.error(color.red('Error:') + ' package.json is missing "version" field');
        process.exit(2);
    }

    // Auto version bump
    if (args.includes('--patch') || args.includes('--minor') || args.includes('--major')) {
        const [major, minor, patch] = pkg.version.split('.').map(Number);
        if (args.includes('--major')) pkg.version = `${major + 1}.0.0`;
        else if (args.includes('--minor')) pkg.version = `${major}.${minor + 1}.0`;
        else pkg.version = `${major}.${minor}.${patch + 1}`;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        log(`Bumped version to ${color.cyan(pkg.version)}`);
    }

    // Determine visibility
    let visibility = 'public';
    if (args.includes('--private')) {
        visibility = 'private';
    } else if (args.includes('--public')) {
        visibility = 'public';
    } else {
        const orgIdx = args.indexOf('--org');
        if (orgIdx !== -1 && args[orgIdx + 1]) {
            visibility = `org:${args[orgIdx + 1]}`;
        }
    }

    // Parse scope and name
    let scope, name;
    if (pkg.name.startsWith('@') && pkg.name.includes('/')) {
        const parts = pkg.name.slice(1).split('/');
        scope = parts[0];
        name = parts.slice(1).join('/');
    } else {
        // Use user's email prefix as scope fallback
        const auth = readAuth();
        const emailPrefix = auth?.email?.split('@')[0] || 'unknown';
        scope = emailPrefix;
        name = pkg.name;
    }

    // Create tarball
    const tmpFile = join(tmpdir(), `robinpath-publish-${Date.now()}.tar.gz`);
    const parentDir = dirname(targetDir);
    const dirName = basename(targetDir);

    log(`Packing @${scope}/${name}@${pkg.version} (${visibility})...`);

    try {
        execSync(
            `tar czf "${toTarPath(tmpFile)}" --exclude=node_modules --exclude=.git --exclude="*.tar.gz" -C "${toTarPath(parentDir)}" "${dirName}"`,
            { stdio: 'pipe' }
        );
    } catch (err) {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        console.error(color.red('Error:') + ` Failed to create tarball: ${err.message}`);
        process.exit(1);
    }

    // Read tarball and check size
    const tarball = readFileSync(tmpFile);
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (tarball.length > maxSize) {
        unlinkSync(tmpFile);
        console.error(color.red('Error:') + ` Package is too large (${(tarball.length / 1024 / 1024).toFixed(1)}MB). Max size is 5MB.`);
        process.exit(1);
    }

    log(color.dim(`Package size: ${(tarball.length / 1024).toFixed(1)}KB`));

    // Dry run — stop here
    if (isDryRun) {
        unlinkSync(tmpFile);
        log('');
        log(color.yellow('Dry run') + ` — would publish @${scope}/${name}@${pkg.version} as ${visibility}`);
        return;
    }

    // Upload
    try {
        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/gzip',
            'X-Package-Version': pkg.version,
            'X-Package-Visibility': visibility,
        };
        if (pkg.description) headers['X-Package-Description'] = pkg.description;
        if (pkg.keywords?.length) headers['X-Package-Keywords'] = pkg.keywords.join(',');
        if (pkg.license) headers['X-Package-License'] = pkg.license;

        const res = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, {
            method: 'PUT',
            headers,
            body: tarball,
        });

        if (res.ok) {
            log(color.green('Published') + ` @${scope}/${name}@${pkg.version} (${visibility})`);
        } else {
            const body = await res.json().catch(() => ({}));
            const msg = body?.error?.message || `HTTP ${res.status}`;
            console.error(color.red('Error:') + ` Failed to publish: ${msg}`);
            process.exit(1);
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to publish: ${err.message}`);
        process.exit(1);
    } finally {
        // Clean up temp file
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

/**
 * robinpath sync — List your published modules
 */
async function handleSync() {
    requireAuth();

    // Get username from /v1/me
    let username;
    try {
        const meRes = await platformFetch('/v1/me');
        if (!meRes.ok) {
            console.error(color.red('Error:') + ' Could not fetch account info.');
            process.exit(1);
        }
        const meBody = await meRes.json();
        const user = meBody.data || meBody;
        username = user.username || user.email?.split('@')[0] || 'unknown';
    } catch (err) {
        console.error(color.red('Error:') + ` Could not reach server: ${err.message}`);
        process.exit(1);
    }

    log(`Fetching modules for ${color.cyan(username)}...`);
    log('');

    try {
        const res = await platformFetch(`/v1/registry/search?q=${encodeURIComponent('@' + username + '/')}`);
        if (!res.ok) {
            console.error(color.red('Error:') + ` Failed to search registry (HTTP ${res.status}).`);
            process.exit(1);
        }

        const body = await res.json();
        const modules = body.data || body.modules || [];

        if (modules.length === 0) {
            log('No published modules found.');
            log(`Run ${color.cyan('robinpath publish')} to publish your first module.`);
            return;
        }

        // Print table header
        log(color.bold('  Name'.padEnd(40) + 'Version'.padEnd(12) + 'Downloads'.padEnd(12) + 'Visibility'));
        log(color.dim('  ' + '─'.repeat(72)));

        for (const mod of modules) {
            const name = (mod.scope ? `@${mod.scope}/${mod.name}` : mod.name) || mod.id || '?';
            const version = mod.version || mod.latestVersion || '-';
            const downloads = String(mod.downloads ?? mod.downloadCount ?? '-');
            const visibility = mod.visibility || (mod.isPublic === false ? 'private' : 'public');
            log(`  ${name.padEnd(38)}${version.padEnd(12)}${downloads.padEnd(12)}${visibility}`);
        }

        log('');
        log(color.dim(`${modules.length} module${modules.length !== 1 ? 's' : ''}`));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to list modules: ${err.message}`);
        process.exit(1);
    }
}

// ============================================================================
// Snippet commands
// ============================================================================

const SNIPPET_CATEGORIES = ['forms', 'notifications', 'crm', 'e-commerce', 'data-processing', 'auth', 'ai', 'webhooks', 'utilities', 'other'];
const SNIPPET_SORTS = ['popular', 'stars', 'newest', 'updated'];

function parseSnippetFlags(args) {
    const flags = { json: args.includes('--json'), force: args.includes('--force'), codeOnly: args.includes('--code-only') || args.includes('--code') };
    for (const a of args) {
        if (a.startsWith('--page='))        flags.page = a.split('=')[1];
        if (a.startsWith('--limit='))       flags.limit = a.split('=')[1];
        if (a.startsWith('--name='))        flags.name = a.split('=')[1];
        if (a.startsWith('--description=')) flags.description = a.split('=')[1];
        if (a.startsWith('--visibility='))  flags.visibility = a.split('=')[1];
        if (a.startsWith('--category='))    flags.category = a.split('=')[1];
        if (a.startsWith('--tags='))        flags.tags = a.split('=')[1];
        if (a.startsWith('--status='))      flags.status = a.split('=')[1];
        if (a.startsWith('--license='))     flags.license = a.split('=')[1];
        if (a.startsWith('--version='))     flags.version = a.split('=')[1];
        if (a.startsWith('--sort='))        flags.sort = a.split('=')[1];
        if (a.startsWith('--code='))        flags.code = a.split('=')[1];
        if (a.startsWith('--changelog='))   flags.changelog = a.split('=')[1];
        if (a.startsWith('--format='))      flags.format = a.split('=')[1];
        if (a.startsWith('--readme='))      flags.readme = a.split('=')[1];
    }
    flags.positional = args.filter(a => a === '-' || !a.startsWith('-'));
    return flags;
}

/**
 * Fetch a snippet — tries authenticated endpoint first (own + public),
 * falls back to public endpoint if not logged in.
 */
async function fetchSnippet(id) {
    const token = getAuthToken();
    if (token) {
        const res = await fetch(`${PLATFORM_URL}/v1/snippets/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) return res;
    }
    // Fallback: try public endpoint (no auth)
    return fetch(`${PLATFORM_URL}/public/snippets/${encodeURIComponent(id)}`);
}

/**
 * Resolve a partial snippet ID to a full ID.
 * If the input is already a full ULID (26 chars), returns it as-is.
 * Otherwise, fetches the user's snippets and matches by prefix.
 * Falls back to the input if no auth or no match (let the API return 404).
 */
async function resolveSnippetId(partialId) {
    if (!partialId) return partialId;
    // Full ULID — skip resolution
    if (partialId.length >= 26) return partialId;

    const token = getAuthToken();
    if (!token) return partialId; // Can't resolve without auth

    try {
        // Fetch user's snippets to match prefix
        const res = await fetch(`${PLATFORM_URL}/v1/snippets?limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return partialId;

        const body = await res.json();
        const snippets = body.data || [];
        const upper = partialId.toUpperCase();
        const matches = snippets.filter(s => s.id && s.id.toUpperCase().startsWith(upper));

        if (matches.length === 1) return matches[0].id;
        if (matches.length > 1) {
            console.error(color.yellow('Warning:') + ` Ambiguous ID '${partialId}' matches ${matches.length} snippets:`);
            for (const m of matches.slice(0, 5)) {
                console.error(`  ${color.cyan(m.id)}  ${m.name || 'untitled'}`);
            }
            console.error('Please use a longer prefix.');
            process.exit(2);
        }
        // No match in own snippets — return as-is, let the API try (might be a public snippet)
        return partialId;
    } catch {
        return partialId;
    }
}

async function handleSnippet(args) {
    const sub = args[0];
    const subArgs = args.slice(1);

    if (!sub || sub === 'list')                             return snippetList(subArgs);
    if (sub === 'create' || sub === 'new')                  return snippetCreate(subArgs);
    if (sub === 'init')                                     return snippetInit(subArgs);
    if (sub === 'get' || sub === 'view' || sub === 'show')  return snippetGet(subArgs);
    if (sub === 'update' || sub === 'edit')                 return snippetUpdate(subArgs);
    if (sub === 'delete' || sub === 'rm')                   return snippetDelete(subArgs);
    if (sub === 'explore' || sub === 'browse')              return snippetExplore(subArgs);
    if (sub === 'search')                                   return snippetExplore(subArgs);
    if (sub === 'star')                                     return snippetStar(subArgs);
    if (sub === 'unstar')                                   return snippetUnstar(subArgs);
    if (sub === 'fork')                                     return snippetFork(subArgs);
    if (sub === 'publish')                                  return snippetPublish(subArgs);
    if (sub === 'unpublish')                                return snippetUnpublish(subArgs);
    if (sub === 'copy' || sub === 'cp')                      return snippetCopy(subArgs);
    if (sub === 'run' || sub === 'exec')                    return snippetRun(subArgs);
    if (sub === 'pull' || sub === 'download')               return snippetPull(subArgs);
    if (sub === 'push')                                     return snippetPush(subArgs);
    if (sub === 'version')                                  return snippetVersion(subArgs);
    if (sub === 'export')                                   return snippetExport(subArgs);
    if (sub === 'import')                                   return snippetImport(subArgs);
    if (sub === 'diff')                                     return snippetDiff(subArgs);
    if (sub === 'trending')                                 return snippetExplore(['--sort=popular', ...subArgs]);

    console.error(color.red('Error:') + ` Unknown snippet subcommand: ${sub}`);
    console.error('Available: list, create, get, update, delete, explore, search, star, unstar, fork, publish, unpublish, copy, run, pull, push, version, diff, export, import, trending');
    process.exit(2);
}

// ── snippet list ──

async function snippetList(args) {
    const flags = parseSnippetFlags(args);
    const query = flags.positional.join(' ');

    const params = new URLSearchParams();
    if (flags.page) params.set('page', flags.page);
    if (flags.limit) params.set('limit', flags.limit);
    if (flags.visibility) params.set('visibility', flags.visibility);
    if (flags.status) params.set('status', flags.status);
    if (flags.category) params.set('category', flags.category);
    if (query) params.set('q', query);

    try {
        const res = await platformFetch(`/v1/snippets?${params}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to list snippets (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        const body = await res.json();
        const snippets = body.data || [];
        const pagination = body.pagination || null;

        if (flags.json) {
            console.log(JSON.stringify({ snippets, pagination }, null, 2));
            return;
        }

        // Active filters summary
        const filters = [];
        if (flags.visibility) filters.push(`visibility=${flags.visibility}`);
        if (flags.status) filters.push(`status=${flags.status}`);
        if (flags.category) filters.push(`category=${flags.category}`);
        if (query) filters.push(`search="${query}"`);
        if (filters.length) log(color.dim('  Filters: ' + filters.join(', ')) + '\n');

        if (snippets.length === 0) {
            log('No snippets found.');
            if (filters.length) {
                log(`Try removing some filters, or run ${color.cyan('robinpath snippet list')} to see all.`);
            } else {
                log(`Run ${color.cyan('robinpath snippet create <file>')} to create your first snippet.`);
            }
            return;
        }

        for (const s of snippets) {
            const vis = s.visibility === 'public' ? color.green('● public') : color.dim('○ private');
            const status = s.status || 'draft';
            const updated = formatTimeAgo(s.updatedAt);
            const cat = s.category ? color.dim(` [${s.category}]`) : '';

            log(color.bold('  ' + (s.name || 'Untitled')) + cat);
            log(`    ${vis}  ${color.dim('|')}  ${status}  ${color.dim('|')}  ${color.dim(updated)}  ${color.dim('|')}  ★ ${formatCompactNumber(s.starCount)}`);
            if (s.description) log(`    ${color.dim(s.description.slice(0, 80))}`);
            log(`    ${color.dim('ID:')} ${color.cyan(s.id)}`);
            log('');
        }

        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`));
        }

        log('');
        log(color.dim('  Filter: --visibility=public|private  --status=draft|published|archived  --category=<cat>'));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to list snippets: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet create ──

async function snippetCreate(args) {
    const flags = parseSnippetFlags(args);
    const fileArg = flags.positional[0];

    if (!fileArg) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet create <file|-> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --name=<name>            Snippet name (defaults to filename)');
        console.error('    --description=<desc>     Description');
        console.error('    --visibility=<v>         public or private (default: private)');
        console.error('    --category=<cat>         Category (' + SNIPPET_CATEGORIES.join(', ') + ')');
        console.error('    --tags=<t1,t2>           Comma-separated tags');
        console.error('    --status=<s>             draft, published, or archived (default: draft)');
        console.error('    --license=<lic>          License (MIT, Apache-2.0, etc.)');
        console.error('    --version=<ver>          Version string');
        console.error('    --readme=<file>          Readme file path');
        console.error('    --json                   Machine-readable JSON output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet create app.rp');
        console.error('    robinpath snippet create app.rp --name="My Tool" --visibility=public');
        console.error('    robinpath snippet create - < script.rp --name="Piped"');
        process.exit(2);
    }

    let code;
    let defaultName;

    if (fileArg === '-') {
        code = await readStdin();
        defaultName = 'untitled';
    } else {
        const filePath = resolve(fileArg);
        if (!existsSync(filePath)) {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
            process.exit(1);
        }
        code = readFileSync(filePath, 'utf-8');
        defaultName = basename(filePath, extname(filePath));
    }

    if (!code || !code.trim()) {
        console.error(color.red('Error:') + ' Code cannot be empty.');
        process.exit(1);
    }

    const payload = {
        name: flags.name || defaultName,
        code,
        language: 'robinpath',
    };
    if (flags.description) payload.description = flags.description;
    if (flags.visibility)  payload.visibility = flags.visibility;
    if (flags.category)    payload.category = flags.category;
    if (flags.tags)        payload.tags = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (flags.status)      payload.status = flags.status;
    if (flags.license)     payload.license = flags.license;
    if (flags.version)     payload.version = flags.version;
    if (flags.readme) {
        const readmePath = resolve(flags.readme);
        if (existsSync(readmePath)) {
            payload.readme = readFileSync(readmePath, 'utf-8');
        }
    }

    try {
        const res = await platformFetch('/v1/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to create snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        const body = await res.json();
        const id = body.id || body.data?.id;

        if (flags.json) {
            console.log(JSON.stringify({ id, name: payload.name, visibility: payload.visibility || 'private' }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet created: ' + color.cyan(id));
        log('  Name: ' + payload.name);
        log('  Visibility: ' + (payload.visibility || 'private'));
        log('');
        log('  View:    ' + color.cyan(`robinpath snippet get ${id}`));
        log('  Run:     ' + color.cyan(`robinpath snippet run ${id}`));
        if (payload.visibility !== 'public') {
            log('  Publish: ' + color.cyan(`robinpath snippet publish ${id}`));
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to create snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet init (interactive wizard) ──

async function snippetInit(args) {
    requireAuth();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise(resolve => {
        const suffix = def ? color.dim(` (${def})`) : '';
        rl.question(`  ${q}${suffix}: `, answer => resolve(answer.trim() || def || ''));
    });

    log(color.bold('Create a new snippet') + '\n');

    const name = await ask('Name', '');
    if (!name) {
        console.error(color.red('Error:') + ' Name is required.');
        rl.close();
        process.exit(2);
    }

    const description = await ask('Description', '');

    log('');
    log(color.dim('  Visibility: 1) private  2) public'));
    const visChoice = await ask('Choose', '1');
    const visibility = visChoice === '2' ? 'public' : 'private';

    log('');
    log(color.dim('  Categories: ' + SNIPPET_CATEGORIES.join(', ')));
    const category = await ask('Category', '');

    const tagsRaw = await ask('Tags (comma-separated)', '');
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    log('');
    log(color.dim('  Status: 1) published  2) draft'));
    const statusChoice = await ask('Choose', '1');
    const status = statusChoice === '2' ? 'draft' : 'published';

    const license = await ask('License', 'MIT');
    const version = await ask('Version', '1.0.0');

    log('');
    log(color.dim('  Code source: 1) file  2) type inline'));
    const codeChoice = await ask('Choose', '1');

    let code = '';
    if (codeChoice === '2') {
        log(color.dim('  Type your code (end with an empty line):'));
        const codeLines = [];
        while (true) {
            const line = await ask('', '');
            if (!line && codeLines.length > 0) break;
            if (line) codeLines.push(line);
        }
        code = codeLines.join('\n');
    } else {
        const filePath = await ask('File path', '');
        if (!filePath || !existsSync(resolve(filePath))) {
            console.error(color.red('Error:') + ' File not found.');
            rl.close();
            process.exit(1);
        }
        code = readFileSync(resolve(filePath), 'utf-8');
    }

    rl.close();

    if (!code.trim()) {
        console.error(color.red('Error:') + ' Code cannot be empty.');
        process.exit(1);
    }

    log('');
    log(color.dim('Creating snippet...'));

    const payload = { name, code, language: 'robinpath', visibility, status, license, version };
    if (description) payload.description = description;
    if (category) payload.category = category;
    if (tags.length) payload.tags = tags;

    try {
        const res = await platformFetch('/v1/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to create snippet: ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        const body = await res.json();
        const id = body.id || body.data?.id;

        log('');
        log(color.green('✓') + ' Snippet created: ' + color.cyan(id));
        log('  Name:       ' + name);
        log('  Visibility: ' + (visibility === 'public' ? color.green(visibility) : color.dim(visibility)));
        log('  Status:     ' + status);
        log('');
        log('  View: ' + color.cyan(`robinpath snippet get ${id}`));
        log('  Run:  ' + color.cyan(`robinpath snippet run ${id}`));
        if (visibility === 'public') {
            log('  CDN:  ' + color.cyan(`https://cdn.robinpath.com/s/${id}`));
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to create snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet get ──

async function snippetGet(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet get <id> [--json]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = await res.json();
        const s = body.data || body;

        if (flags.json) {
            console.log(JSON.stringify(s, null, 2));
            return;
        }

        // --code-only: just output raw code (pipeable)
        if (flags.codeOnly) {
            console.log(s.code || '');
            return;
        }

        // Pretty print
        log(color.bold(s.name || 'Untitled'));
        if (s.description) log(color.dim(s.description));
        log('');
        log('  ID:         ' + (s.id || id));
        log('  Visibility: ' + (s.visibility === 'public' ? color.green('public') : color.dim('private')));
        log('  Status:     ' + (s.status || 'draft'));
        log('  Language:   ' + (s.language || 'robinpath'));
        if (s.category)  log('  Category:   ' + s.category);
        if (s.version)   log('  Version:    ' + s.version);
        if (s.license)   log('  License:    ' + s.license);
        if (s.tags) {
            const tags = typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags;
            if (tags && tags.length) log('  Tags:       ' + tags.join(', '));
        }
        if (s.starCount != null) log('  Stars:      ' + formatCompactNumber(s.starCount));
        if (s.viewCount != null) log('  Views:      ' + formatCompactNumber(s.viewCount));
        if (s.forkCount != null) log('  Forks:      ' + formatCompactNumber(s.forkCount));
        if (s.isStarred != null) log('  Starred:    ' + (s.isStarred ? color.yellow('★ yes') : '☆ no'));
        if (s.isOwner != null)   log('  Owner:      ' + (s.isOwner ? 'yes' : 'no'));
        if (s.author)            log('  Author:     ' + (s.author.name || s.author.username || '-'));
        if (s.forkedFrom)        log('  Forked from: ' + s.forkedFrom);
        if (s.createdAt) log('  Created:    ' + formatTimeAgo(s.createdAt));
        if (s.updatedAt) log('  Updated:    ' + formatTimeAgo(s.updatedAt));
        log('');
        log(color.bold('Code:'));
        log(color.dim('─'.repeat(60)));
        log(s.code || '');
        log(color.dim('─'.repeat(60)));

        // Actionable hints
        const sid = s.id || id;
        log('');
        log(color.dim('  Actions:'));
        log(color.dim(`    robinpath snippet run  ${sid}`) + color.dim('     Execute this snippet'));
        log(color.dim(`    robinpath snippet copy ${sid}`) + color.dim('    Copy code to clipboard'));
        log(color.dim(`    robinpath snippet pull ${sid}`) + color.dim('    Save to local file'));
        if (s.isOwner) {
            log(color.dim(`    robinpath snippet push <file> ${sid}`) + color.dim('  Update code from file'));
        } else {
            log(color.dim(`    robinpath snippet fork ${sid}`) + color.dim('    Fork to your account'));
            log(color.dim(`    robinpath snippet star ${sid}`) + color.dim('    Star this snippet'));
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to fetch snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet update ──

async function snippetUpdate(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet update <id> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --name=<name>            Update name');
        console.error('    --description=<desc>     Update description');
        console.error('    --code=<file>            Update code from file');
        console.error('    --visibility=<v>         public or private');
        console.error('    --category=<cat>         Category');
        console.error('    --tags=<t1,t2>           Comma-separated tags');
        console.error('    --status=<s>             draft, published, or archived');
        console.error('    --license=<lic>          License');
        console.error('    --version=<ver>          Version string');
        console.error('    --changelog=<text>       Changelog text');
        console.error('    --readme=<file>          Readme from file');
        console.error('    --json                   Machine-readable output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet update abc123 --name="New Name"');
        console.error('    robinpath snippet update abc123 --visibility=public --status=published');
        console.error('    robinpath snippet update abc123 --code=updated.rp');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const payload = {};
    if (flags.name)        payload.name = flags.name;
    if (flags.description) payload.description = flags.description;
    if (flags.visibility)  payload.visibility = flags.visibility;
    if (flags.category)    payload.category = flags.category;
    if (flags.status)      payload.status = flags.status;
    if (flags.license)     payload.license = flags.license;
    if (flags.version)     payload.version = flags.version;
    if (flags.changelog)   payload.changelog = flags.changelog;
    if (flags.tags)        payload.tags = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (flags.code) {
        const codePath = resolve(flags.code);
        if (!existsSync(codePath)) {
            console.error(color.red('Error:') + ` Code file not found: ${flags.code}`);
            process.exit(1);
        }
        payload.code = readFileSync(codePath, 'utf-8');
    }
    if (flags.readme) {
        const readmePath = resolve(flags.readme);
        if (existsSync(readmePath)) {
            payload.readme = readFileSync(readmePath, 'utf-8');
        }
    }

    if (Object.keys(payload).length === 0) {
        console.error(color.red('Error:') + ' No fields to update. Provide at least one --flag.');
        process.exit(2);
    }

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to update snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ updated: true, id, fields: Object.keys(payload) }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet updated: ' + color.cyan(id));
        log('  Updated fields: ' + Object.keys(payload).join(', '));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to update snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet delete ──

async function snippetDelete(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet delete <id> [--force]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    if (!flags.force) {
        console.error(color.yellow('Warning:') + ` This will permanently delete snippet '${id}'.`);
        console.error('Run again with ' + color.cyan('--force') + ' to confirm.');
        process.exit(0);
    }

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found.`);
            } else {
                const body = await res.json().catch(() => ({}));
                console.error(color.red('Error:') + ` Failed to delete snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            }
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ deleted: true, id }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet deleted: ' + id);
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to delete snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet explore / search / trending ──

async function snippetExplore(args) {
    const flags = parseSnippetFlags(args);
    const query = flags.positional.join(' ');

    if (flags.sort && !SNIPPET_SORTS.includes(flags.sort)) {
        console.error(color.red('Error:') + ` Invalid sort: ${flags.sort}`);
        console.error('  Valid sorts: ' + SNIPPET_SORTS.join(', '));
        process.exit(2);
    }

    if (flags.category && !SNIPPET_CATEGORIES.includes(flags.category)) {
        console.error(color.red('Error:') + ` Invalid category: ${flags.category}`);
        console.error('  Valid categories: ' + SNIPPET_CATEGORIES.join(', '));
        process.exit(2);
    }

    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (flags.category) params.set('category', flags.category);
    if (flags.sort) params.set('sort', flags.sort);
    if (flags.tags) params.set('tags', flags.tags);
    if (flags.page) params.set('page', flags.page);
    if (flags.limit) params.set('limit', flags.limit);

    const searchLabel = query ? `"${query}"` : (flags.category ? `category: ${flags.category}` : 'public snippets');
    log(`Searching ${searchLabel}...\n`);

    try {
        // Public endpoint — no auth required
        const res = await fetch(`${PLATFORM_URL}/public/snippets?${params}`);
        if (!res.ok) {
            console.error(color.red('Error:') + ` Failed to search snippets (HTTP ${res.status})`);
            process.exit(1);
        }

        const body = await res.json();
        const snippets = body.data || [];
        const pagination = body.pagination || null;

        if (flags.json) {
            console.log(JSON.stringify({ snippets, pagination }, null, 2));
            return;
        }

        if (snippets.length === 0) {
            log('No public snippets found.');
            return;
        }

        for (const s of snippets) {
            const name = s.name || 'untitled';
            const author = s.author?.username || s.author?.name || '-';
            const cat = s.category || '-';
            const stars = formatCompactNumber(s.starCount);
            const views = formatCompactNumber(s.viewCount);
            const updated = formatTimeAgo(s.updatedAt);
            const badges = [];
            if (s.featured) badges.push(color.yellow('★'));
            if (s.verified) badges.push(color.green('✓'));
            const badgeStr = badges.length ? ' ' + badges.join(' ') : '';

            log(color.bold('  ' + name) + badgeStr);
            log(`    ${color.dim('by')} ${author}  ${color.dim('|')} ${cat}  ${color.dim('|')} ★ ${stars}  ${color.dim('|')} ${color.dim(updated)}`);
            if (s.description) log(`    ${color.dim(s.description.slice(0, 80))}`);
            // Code preview — first 2 non-empty lines
            if (s.code) {
                const previewLines = s.code.split('\n').filter(l => l.trim()).slice(0, 2);
                if (previewLines.length) {
                    log(color.dim('    ┌ ') + color.dim(previewLines[0].trim().slice(0, 70)));
                    if (previewLines[1]) log(color.dim('    │ ') + color.dim(previewLines[1].trim().slice(0, 70)));
                    const totalLines = s.code.split('\n').filter(l => l.trim()).length;
                    if (totalLines > 2) log(color.dim(`    └ ... ${totalLines - 2} more line${totalLines - 2 !== 1 ? 's' : ''}`));
                    else log(color.dim('    └'));
                }
            }
            log(`    ${color.dim('ID:')} ${color.cyan(s.id)}`);
            log('');
        }

        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`));
        }

        log('');
        log(color.dim('  Quick actions:'));
        log(color.dim('    robinpath snippet get  <id>     View full code'));
        log(color.dim('    robinpath snippet run  <id>     Execute it'));
        log(color.dim('    robinpath snippet pull <id>     Save to local file'));
        log(color.dim('    robinpath snippet copy <id>     Copy code to clipboard'));
        log(color.dim('    robinpath snippet fork <id>     Fork to your account'));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to search snippets: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet star ──

async function snippetStar(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet star <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/star`, {
            method: 'POST',
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to star snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ starred: true, id }, null, 2));
            return;
        }

        log(color.yellow('★') + ' Starred snippet: ' + color.cyan(id));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to star snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet unstar ──

async function snippetUnstar(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet unstar <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/star`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to unstar snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ starred: false, id }, null, 2));
            return;
        }

        log('☆ Unstarred snippet: ' + color.cyan(id));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to unstar snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet fork ──

async function snippetFork(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet fork <id> [--json]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/fork`, {
            method: 'POST',
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to fork snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        const body = await res.json();
        const newId = body.id || body.data?.id;

        if (flags.json) {
            console.log(JSON.stringify({ id: newId, forkedFrom: id }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet forked!');
        log('  New ID:      ' + color.cyan(newId));
        log('  Forked from: ' + id);
        log('');
        log('  View: ' + color.cyan(`robinpath snippet get ${newId}`));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to fork snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet publish ──

async function snippetPublish(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet publish <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', visibility: 'public' }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to publish snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ published: true, id, visibility: 'public', status: 'published' }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet published: ' + color.cyan(id));
        log('  Visibility: ' + color.green('public'));
        log('  Status:     published');
        log('  CDN:        ' + color.cyan(`https://cdn.robinpath.com/s/${id}`));
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to publish snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet unpublish ──

async function snippetUnpublish(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet unpublish <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft', visibility: 'private' }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to unpublish snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ published: false, id, visibility: 'private', status: 'draft' }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet unpublished: ' + color.cyan(id));
        log('  Visibility: ' + color.dim('private'));
        log('  Status:     draft');
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to unpublish snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet copy ──

async function snippetCopy(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet copy <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = await res.json();
        const s = body.data || body;
        const code = s.code || '';

        if (!code.trim()) {
            console.error(color.red('Error:') + ' Snippet has no code to copy.');
            process.exit(1);
        }

        // Cross-platform clipboard copy
        const isWin = platform() === 'win32';
        const isMac = platform() === 'darwin';
        let clipCmd;
        if (isWin) clipCmd = 'clip';
        else if (isMac) clipCmd = 'pbcopy';
        else clipCmd = 'xclip -selection clipboard';

        try {
            const { execSync: exec } = await import('node:child_process');
            exec(clipCmd, { input: code, stdio: ['pipe', 'ignore', 'ignore'] });

            if (flags.json) {
                console.log(JSON.stringify({ copied: true, id, name: s.name, bytes: Buffer.byteLength(code) }, null, 2));
                return;
            }

            log(color.green('✓') + ' Code copied to clipboard!');
            log('  Snippet: ' + (s.name || id));
            log('  Size:    ' + Buffer.byteLength(code) + ' bytes');
            log('');
            log(color.dim('  Paste it anywhere, or run it:'));
            log(color.dim(`    robinpath snippet run ${s.id || id}`));
        } catch (clipErr) {
            // Clipboard not available — print code to stdout as fallback
            console.error(color.yellow('Warning:') + ' Could not access clipboard. Printing code to stdout:\n');
            console.log(code);
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to copy snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet run ──

// ── snippet cache helpers ──

const SNIPPET_CACHE_DIR = join(homedir(), '.robinpath', 'cache', 'snippets');
const SNIPPET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getSnippetCachePath(id) {
    return join(SNIPPET_CACHE_DIR, `${id}.json`);
}

function readSnippetCache(id) {
    try {
        const cachePath = getSnippetCachePath(id);
        if (!existsSync(cachePath)) return null;
        const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (Date.now() - raw._cachedAt > SNIPPET_CACHE_TTL) return null; // expired
        return raw;
    } catch {
        return null;
    }
}

function writeSnippetCache(id, data) {
    try {
        if (!existsSync(SNIPPET_CACHE_DIR)) {
            mkdirSync(SNIPPET_CACHE_DIR, { recursive: true });
        }
        writeFileSync(getSnippetCachePath(id), JSON.stringify({ ...data, _cachedAt: Date.now() }), 'utf-8');
    } catch {
        // ignore cache write failures
    }
}

async function snippetRun(args) {
    const flags = parseSnippetFlags(args);
    const noCache = args.includes('--no-cache');
    let id = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet run <id> [--no-cache]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        // Try cache first
        let s = null;
        if (!noCache) {
            s = readSnippetCache(id);
            if (s) logVerbose(`Using cached snippet (${id})`);
        }

        if (!s) {
            const res = await fetchSnippet(id);
            if (!res.ok) {
                // If network fails, try stale cache as fallback
                const stale = readSnippetCache(id);
                if (stale) {
                    log(color.yellow('Warning:') + ' Network unavailable, using cached version.');
                    s = stale;
                } else {
                    if (res.status === 404) {
                        console.error(color.red('Error:') + ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`);
                    } else {
                        console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
                    }
                    process.exit(1);
                }
            } else {
                const body = await res.json();
                s = body.data || body;
                writeSnippetCache(id, s);
            }
        }

        const code = s.code;
        if (!code || !code.trim()) {
            console.error(color.red('Error:') + ' Snippet has no code to execute.');
            process.exit(1);
        }

        log(color.dim(`Running snippet: ${s.name || id}`));
        log(color.dim('─'.repeat(40)));

        await runScript(code);
    } catch (err) {
        if (err.code === 'ERR_SCRIPT') throw err;
        console.error(color.red('Error:') + ` Failed to run snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet pull ──

async function snippetPull(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];
    const outputFile = flags.positional[1];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet pull <id> [output-file]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = await res.json();
        const s = body.data || body;
        const code = s.code || '';

        // Determine output filename
        const sanitizedName = (s.name || 'snippet').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
        const fileName = outputFile || `${sanitizedName}.rp`;
        const filePath = resolve(fileName);

        writeFileSync(filePath, code, 'utf-8');

        if (flags.json) {
            console.log(JSON.stringify({ id, name: s.name, file: filePath, bytes: Buffer.byteLength(code) }, null, 2));
            return;
        }

        log(color.green('✓') + ' Snippet pulled to: ' + color.cyan(fileName));
        log('  Snippet: ' + (s.name || id));
        log('  Size:    ' + Buffer.byteLength(code) + ' bytes');
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to pull snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet push ──

async function snippetPush(args) {
    const flags = parseSnippetFlags(args);
    const fileArg = flags.positional[0];
    let id = flags.positional[1];

    if (!fileArg || !id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet push <file> <id>');
        console.error('');
        console.error('  Uploads a local file as the snippet\'s code.');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet push app.rp abc123');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const filePath = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    const code = readFileSync(filePath, 'utf-8');
    if (!code.trim()) {
        console.error(color.red('Error:') + ' File is empty.');
        process.exit(1);
    }

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to push code (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ pushed: true, id, file: fileArg, bytes: Buffer.byteLength(code) }, null, 2));
            return;
        }

        log(color.green('✓') + ' Code pushed to snippet: ' + color.cyan(id));
        log('  File: ' + fileArg);
        log('  Size: ' + Buffer.byteLength(code) + ' bytes');
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to push code: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet version ──

async function snippetVersion(args) {
    const flags = parseSnippetFlags(args);
    let id = flags.positional[0];
    const ver = flags.positional[1] || flags.version;

    if (!id || !ver) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet version <id> <version> [--changelog=<text>]');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet version abc123 1.2.0');
        console.error('    robinpath snippet version abc123 2.0.0 --changelog="Breaking changes"');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const payload = { version: ver };
    if (flags.changelog) payload.changelog = flags.changelog;

    try {
        const res = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to set version (HTTP ${res.status}): ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ id, version: ver, changelog: flags.changelog || null }, null, 2));
            return;
        }

        log(color.green('✓') + ' Version set: ' + color.cyan(ver) + ' for snippet ' + id);
        if (flags.changelog) log('  Changelog: ' + flags.changelog);
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to set version: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet diff ──

async function snippetDiff(args) {
    const flags = parseSnippetFlags(args);
    const fileArg = flags.positional[0];
    let id = flags.positional[1];

    if (!fileArg || !id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet diff <file> <id>');
        console.error('');
        console.error('  Compare a local file with a remote snippet\'s code.');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet diff app.rp abc123');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const filePath = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    const localCode = readFileSync(filePath, 'utf-8');

    try {
        const res = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found.`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = await res.json();
        const s = body.data || body;
        const remoteCode = s.code || '';

        if (localCode === remoteCode) {
            log(color.green('✓') + ' No differences — local file matches remote snippet.');
            return;
        }

        // Simple line-by-line diff
        const localLines = localCode.split('\n');
        const remoteLines = remoteCode.split('\n');
        const maxLines = Math.max(localLines.length, remoteLines.length);

        log(color.bold(`Diff: ${fileArg} (local) vs ${s.name || id} (remote)`));
        log(color.dim('─'.repeat(60)));

        let additions = 0, deletions = 0, unchanged = 0;

        for (let i = 0; i < maxLines; i++) {
            const local = localLines[i];
            const remote = remoteLines[i];
            const lineNum = String(i + 1).padStart(4);

            if (local === remote) {
                // Only show context around changes (3 lines)
                unchanged++;
            } else if (local !== undefined && remote !== undefined) {
                // Changed line
                log(color.red(`${lineNum} - ${remote}`));
                log(color.green(`${lineNum} + ${local}`));
                deletions++;
                additions++;
            } else if (local === undefined) {
                // Line only in remote
                log(color.red(`${lineNum} - ${remote}`));
                deletions++;
            } else {
                // Line only in local
                log(color.green(`${lineNum} + ${local}`));
                additions++;
            }
        }

        log(color.dim('─'.repeat(60)));
        log(`${color.green(`+${additions}`)} additions, ${color.red(`-${deletions}`)} deletions, ${unchanged} unchanged`);

        if (additions > 0 || deletions > 0) {
            log('');
            log(color.dim(`  Push local changes: robinpath snippet push ${fileArg} ${id}`));
            log(color.dim(`  Pull remote version: robinpath snippet pull ${id} ${fileArg}`));
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to diff snippet: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet export ──

async function snippetExport(args) {
    const flags = parseSnippetFlags(args);

    log('Exporting all snippets...\n');

    try {
        const allSnippets = [];
        let page = 1;
        const limit = 50;

        while (true) {
            const params = new URLSearchParams({ page: String(page), limit: String(limit) });
            const res = await platformFetch(`/v1/snippets?${params}`);
            if (!res.ok) {
                console.error(color.red('Error:') + ` Failed to fetch snippets (HTTP ${res.status})`);
                process.exit(1);
            }

            const body = await res.json();
            const snippets = body.data || [];
            allSnippets.push(...snippets);

            const pagination = body.pagination;
            if (!pagination || page >= pagination.pages) break;
            page++;
        }

        if (allSnippets.length === 0) {
            log('No snippets to export.');
            return;
        }

        const exportData = {
            exportedAt: new Date().toISOString(),
            count: allSnippets.length,
            snippets: allSnippets.map(s => ({
                name: s.name,
                description: s.description,
                code: s.code,
                language: s.language,
                tags: s.tags,
                visibility: s.visibility,
                category: s.category,
                status: s.status,
                readme: s.readme,
                version: s.version,
                license: s.license,
            })),
        };

        if (flags.json || !flags.format || flags.format === 'json') {
            const outputFile = flags.positional[0] || 'snippets-export.json';
            const filePath = resolve(outputFile);
            writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
            log(color.green('✓') + ` Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? 's' : ''} to: ${color.cyan(outputFile)}`);
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to export snippets: ${err.message}`);
        process.exit(1);
    }
}

// ── snippet import ──

async function snippetImport(args) {
    const flags = parseSnippetFlags(args);
    const fileArg = flags.positional[0];

    if (!fileArg) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet import <file.json> [--json]');
        process.exit(2);
    }

    const filePath = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    let importData;
    try {
        importData = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        console.error(color.red('Error:') + ' Invalid JSON file.');
        process.exit(1);
    }

    const snippets = importData.snippets || importData;
    if (!Array.isArray(snippets)) {
        console.error(color.red('Error:') + ' Expected JSON with a "snippets" array.');
        process.exit(1);
    }

    log(`Importing ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}...\n`);

    let created = 0, failed = 0;
    const results = [];

    for (const s of snippets) {
        if (!s.name || !s.code) {
            failed++;
            results.push({ name: s.name || '(unnamed)', status: 'skipped', reason: 'missing name or code' });
            continue;
        }

        try {
            const payload = {
                name: s.name,
                code: s.code,
                language: s.language || 'robinpath',
            };
            if (s.description) payload.description = s.description;
            if (s.visibility)  payload.visibility = s.visibility;
            if (s.category)    payload.category = s.category;
            if (s.tags)        payload.tags = typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags;
            if (s.status)      payload.status = s.status;
            if (s.license)     payload.license = s.license;
            if (s.version)     payload.version = s.version;
            if (s.readme)      payload.readme = s.readme;

            const res = await platformFetch('/v1/snippets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const body = await res.json();
                created++;
                results.push({ name: s.name, status: 'created', id: body.id || body.data?.id });
                log(color.green('  ✓') + ' ' + s.name);
            } else {
                failed++;
                results.push({ name: s.name, status: 'failed', httpStatus: res.status });
                log(color.red('  ✗') + ' ' + s.name + color.dim(` (HTTP ${res.status})`));
            }
        } catch (err) {
            failed++;
            results.push({ name: s.name, status: 'failed', error: err.message });
            log(color.red('  ✗') + ' ' + s.name + color.dim(` (${err.message})`));
        }
    }

    log('');
    if (flags.json) {
        console.log(JSON.stringify({ created, failed, total: snippets.length, results }, null, 2));
        return;
    }

    log(color.green(`✓ Imported: ${created}`) + (failed > 0 ? color.red(` | Failed: ${failed}`) : '') + ` | Total: ${snippets.length}`);
}

// ============================================================================
// Module management commands
// ============================================================================

/**
 * robinpath add <pkg>[@version] — Install a module from the registry
 */
async function handleAdd(args) {
    const spec = args.find(a => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath add <module>[@version]');
        console.error('  Example: robinpath add @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.name) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { scope, name, fullName, version } = parsed;
    if (!scope) {
        console.error(color.red('Error:') + ' Module must be scoped (e.g. @robinpath/slack)');
        process.exit(2);
    }

    const token = requireAuth();

    // Check if already installed
    const manifest = readModulesManifest();
    if (manifest[fullName] && !args.includes('--force')) {
        const current = manifest[fullName].version;
        if (version && version === current) {
            log(`${fullName}@${current} is already installed.`);
            return;
        }
        if (!version) {
            log(color.dim(`Reinstalling ${fullName} (currently ${current})...`));
        }
    }

    // Resolve version if not specified
    let resolvedVersion = version;
    if (!resolvedVersion) {
        try {
            const infoRes = await platformFetch(`/v1/registry/${scope}/${name}`);
            if (!infoRes.ok) {
                console.error(color.red('Error:') + ` Module not found: ${fullName}`);
                process.exit(1);
            }
            const info = await infoRes.json();
            resolvedVersion = info.data?.latestVersion || info.data?.version;
            if (!resolvedVersion) {
                console.error(color.red('Error:') + ` No versions available for ${fullName}`);
                process.exit(1);
            }
        } catch (err) {
            console.error(color.red('Error:') + ` Could not reach registry: ${err.message}`);
            process.exit(1);
        }
    }

    log(`Installing ${fullName}@${resolvedVersion}...`);

    // Download tarball from registry
    let tarballBuffer;
    try {
        const res = await platformFetch(`/v1/registry/${scope}/${name}/${resolvedVersion}/tarball`);

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Module or version not found: ${fullName}@${resolvedVersion}`);
            } else if (res.status === 401 || res.status === 403) {
                console.error(color.red('Error:') + ' Access denied. You may not have permission to install this module.');
            } else {
                const body = await res.json().catch(() => ({}));
                console.error(color.red('Error:') + ` Failed to download: ${body?.error?.message || 'HTTP ' + res.status}`);
            }
            process.exit(1);
        }

        tarballBuffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        console.error(color.red('Error:') + ` Could not reach registry: ${err.message}`);
        process.exit(1);
    }

    // Compute integrity hash
    const integrity = 'sha256-' + createHash('sha256').update(tarballBuffer).digest('hex');

    // Cache tarball
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cacheFile = join(CACHE_DIR, `${scope}-${name}-${resolvedVersion}.tar.gz`);
    writeFileSync(cacheFile, tarballBuffer);

    // Extract to modules dir
    const modDir = getModulePath(fullName);
    if (existsSync(modDir)) {
        rmSync(modDir, { recursive: true, force: true });
    }
    mkdirSync(modDir, { recursive: true });

    // Write tarball to temp, extract
    const tmpFile = join(tmpdir(), `robinpath-add-${Date.now()}.tar.gz`);
    writeFileSync(tmpFile, tarballBuffer);

    try {
        execSync(`tar xzf "${toTarPath(tmpFile)}" --strip-components=1 -C "${toTarPath(modDir)}"`, { stdio: 'pipe' });
    } catch (err) {
        // Clean up on failure
        rmSync(modDir, { recursive: true, force: true });
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        console.error(color.red('Error:') + ` Failed to extract module: ${err.message}`);
        process.exit(1);
    }

    try { unlinkSync(tmpFile); } catch { /* ignore */ }

    // Build if dist/ is missing but src/ exists (module published without build)
    const distDir = join(modDir, 'dist');
    const srcDir = join(modDir, 'src');
    if (!existsSync(distDir) && existsSync(srcDir) && existsSync(join(srcDir, 'index.ts'))) {
        log(color.dim('  Compiling module...'));
        mkdirSync(distDir, { recursive: true });
        // Strip TypeScript types using Node 22's built-in --experimental-strip-types
        // Each .ts file → .js file with types removed
        const tsFiles = readdirSync(srcDir).filter(f => f.endsWith('.ts'));
        for (const file of tsFiles) {
            const srcFile = join(srcDir, file);
            const outFile = join(distDir, file.replace('.ts', '.js'));
            try {
                // Use node's module.stripTypeScriptTypes (Node 22.6+)
                const stripScript = `
                    const fs = require('fs');
                    const { stripTypeScriptTypes } = require('module');
                    const src = fs.readFileSync(${JSON.stringify(srcFile)}, 'utf-8');
                    const js = stripTypeScriptTypes(src, { mode: 'transform', sourceMap: false });
                    fs.writeFileSync(${JSON.stringify(outFile)}, js);
                `;
                execSync(`node -e "${stripScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
            } catch {
                // Fallback: copy as-is (may fail to load)
                copyFileSync(srcFile, outFile);
            }
        }
    }

    // Read extracted package.json for version info
    let installedVersion = resolvedVersion;
    const pkgJsonPath = join(modDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            installedVersion = pkg.version || installedVersion;
        } catch { /* ignore */ }
    }

    // Check for module dependencies
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            const depends = pkg.robinpath?.depends || [];
            for (const dep of depends) {
                if (!manifest[dep]) {
                    log(color.dim(`  Installing dependency: ${dep}`));
                    await handleAdd([dep]);
                }
            }
        } catch { /* ignore dependency errors */ }
    }

    // Update manifest
    const updatedManifest = readModulesManifest();
    updatedManifest[fullName] = {
        version: installedVersion,
        integrity,
        installedAt: new Date().toISOString(),
    };
    writeModulesManifest(updatedManifest);

    // Update robinpath.json if it exists in cwd
    const projectFile = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8'));
            if (!config.modules) config.modules = {};
            config.modules[fullName] = `^${installedVersion}`;
            writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        } catch { /* ignore project file errors */ }
    }

    log(color.green('Installed') + ` ${fullName}@${installedVersion}`);
}

/**
 * robinpath remove <pkg> — Uninstall a module
 */
async function handleRemove(args) {
    const spec = args.find(a => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath remove <module>');
        console.error('  Example: robinpath remove @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.fullName) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { fullName } = parsed;
    const manifest = readModulesManifest();

    if (!manifest[fullName]) {
        console.error(color.red('Error:') + ` Module not installed: ${fullName}`);
        process.exit(1);
    }

    // Remove module directory
    const modDir = getModulePath(fullName);
    if (existsSync(modDir)) {
        rmSync(modDir, { recursive: true, force: true });
    }

    // Clean up empty parent scope directory
    const scopeDir = dirname(modDir);
    try {
        const remaining = readdirSync(scopeDir);
        if (remaining.length === 0) {
            rmSync(scopeDir, { recursive: true, force: true });
        }
    } catch { /* ignore */ }

    // Update manifest
    delete manifest[fullName];
    writeModulesManifest(manifest);

    // Update robinpath.json if it exists in cwd
    const projectFile = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8'));
            if (config.modules && config.modules[fullName]) {
                delete config.modules[fullName];
                writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            }
        } catch { /* ignore project file errors */ }
    }

    log(color.green('Removed') + ` ${fullName}`);
}

/**
 * robinpath upgrade <pkg> — Upgrade a single module to the latest version
 */
async function handleUpgrade(args) {
    const spec = args.find(a => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath upgrade <module>');
        console.error('  Example: robinpath upgrade @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.fullName || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { fullName, scope, name } = parsed;
    const manifest = readModulesManifest();

    if (!manifest[fullName]) {
        console.error(color.red('Error:') + ` Module not installed: ${fullName}. Use ${color.cyan('robinpath add ' + fullName)} first.`);
        process.exit(1);
    }

    const currentVersion = manifest[fullName].version;
    log(`Checking for updates to ${fullName}@${currentVersion}...`);

    // Check latest version from registry
    try {
        const token = requireAuth();
        const res = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            console.error(color.red('Error:') + ` Could not check registry (HTTP ${res.status})`);
            process.exit(1);
        }

        const body = await res.json();
        const data = body.data || body;
        const latestVersion = data.latestVersion || data.version;

        if (latestVersion === currentVersion) {
            log(color.green('Already up to date') + ` ${fullName}@${currentVersion}`);
            return;
        }

        log(`Upgrading ${fullName}: ${currentVersion} → ${latestVersion}`);
        await handleAdd([fullName, '--force']);
    } catch (err) {
        console.error(color.red('Error:') + ` Upgrade failed: ${err.message}`);
        process.exit(1);
    }
}

/**
 * robinpath modules list — List installed modules
 */
async function handleModulesList() {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed.');
        log(`Run ${color.cyan('robinpath add <module>')} to install your first module.`);
        return;
    }

    log(color.bold('  Name'.padEnd(40) + 'Version'.padEnd(14) + 'Installed'));
    log(color.dim('  ' + '─'.repeat(62)));

    for (const [name, info] of entries) {
        const date = info.installedAt ? info.installedAt.split('T')[0] : '-';
        log(`  ${name.padEnd(38)}${(info.version || '-').padEnd(14)}${date}`);
    }

    log('');
    log(color.dim(`${entries.length} module${entries.length !== 1 ? 's' : ''} installed`));
}

/**
 * robinpath modules upgrade — Upgrade all installed modules
 */
async function handleModulesUpgradeAll() {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed.');
        return;
    }

    log(`Checking ${entries.length} module${entries.length !== 1 ? 's' : ''} for updates...\n`);

    let upgraded = 0;
    let upToDate = 0;
    let failed = 0;

    for (const [fullName, info] of entries) {
        const parsed = parsePackageSpec(fullName);
        if (!parsed || !parsed.scope) {
            failed++;
            continue;
        }

        try {
            const token = getAuthToken();
            if (!token) {
                console.error(color.red('Error:') + ' Not logged in. Run ' + color.cyan('robinpath login'));
                process.exit(1);
            }

            const res = await fetch(`${PLATFORM_URL}/v1/registry/${parsed.scope}/${parsed.name}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) {
                log(color.yellow('Skip') + `  ${fullName} (registry error)`);
                failed++;
                continue;
            }

            const body = await res.json();
            const data = body.data || body;
            const latestVersion = data.latestVersion || data.version;

            if (latestVersion === info.version) {
                log(color.green('  ✓') + `  ${fullName}@${info.version} (up to date)`);
                upToDate++;
            } else {
                log(color.cyan('  ↑') + `  ${fullName}: ${info.version} → ${latestVersion}`);
                await handleAdd([fullName, '--force']);
                upgraded++;
            }
        } catch (err) {
            log(color.yellow('Skip') + `  ${fullName} (${err.message})`);
            failed++;
        }
    }

    log('');
    const parts = [];
    if (upgraded > 0) parts.push(color.green(`${upgraded} upgraded`));
    if (upToDate > 0) parts.push(`${upToDate} up to date`);
    if (failed > 0) parts.push(color.yellow(`${failed} failed`));
    log(parts.join(', '));
}

/**
 * robinpath modules init — Scaffold a new RobinPath module
 */
async function handleModulesInit() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise(resolve => {
        const prompt = def ? `${q} (${def}): ` : `${q}: `;
        rl.question(prompt, answer => resolve(answer.trim() || def || ''));
    });

    log('');
    log(color.bold('  Create a new RobinPath module'));
    log(color.dim('  ' + '─'.repeat(35)));
    log('');

    const rawName = await ask('  Module name');
    if (!rawName) {
        console.error(color.red('Error:') + ' Module name is required');
        rl.close();
        process.exit(2);
    }

    // Slugify: "My First Module" → "my-first-module"
    const moduleName = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    if (!moduleName) {
        console.error(color.red('Error:') + ' Invalid module name');
        rl.close();
        process.exit(2);
    }

    if (moduleName !== rawName) {
        log(color.dim(`  → ${moduleName}`));
    }

    const defaultDisplay = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const displayName = await ask('  Display name', defaultDisplay);
    const description = await ask('  Description', `${displayName} integration for RobinPath`);

    log('');
    log(color.dim('  Categories: api, messaging, crm, ai, database, storage, analytics, dev-tools, utilities'));
    const category = await ask('  Category', 'utilities');

    // Auto-fill author from auth
    const auth = readAuth();
    const defaultAuthor = auth?.email || '';
    const author = await ask('  Author', defaultAuthor);
    const license = await ask('  License', 'MIT');

    const defaultScope = auth?.email?.split('@')[0] || 'robinpath';
    const scope = await ask('  Scope', defaultScope);

    rl.close();

    const fullName = `@${scope}/${moduleName}`;
    const pascalName = moduleName.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
    const targetDir = resolve(moduleName);

    log('');
    log(`Creating ${color.cyan(fullName)}...`);

    if (existsSync(targetDir)) {
        console.error(color.red('Error:') + ` Directory already exists: ${moduleName}/`);
        process.exit(1);
    }

    // Create directories
    mkdirSync(join(targetDir, 'src'), { recursive: true });
    mkdirSync(join(targetDir, 'tests'), { recursive: true });

    // package.json
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
        name: fullName,
        version: '0.1.0',
        description,
        author,
        license,
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
        files: ['dist'],
        scripts: { build: 'tsc', test: `robinpath test tests/` },
        robinpath: { category, displayName },
        peerDependencies: { '@wiredwp/robinpath': '>=1.30.0' },
        devDependencies: { '@wiredwp/robinpath': '^0.30.1', typescript: '^5.6.0' },
    }, null, 2) + '\n', 'utf-8');

    // src/index.ts
    writeFileSync(join(targetDir, 'src', 'index.ts'), `import type { ModuleAdapter } from "@wiredwp/robinpath";
import {
  ${pascalName}Functions,
  ${pascalName}FunctionMetadata,
  ${pascalName}ModuleMetadata,
} from "./${moduleName}.js";

const ${pascalName}Module: ModuleAdapter = {
  name: "${moduleName}",
  functions: ${pascalName}Functions,
  functionMetadata: ${pascalName}FunctionMetadata,
  moduleMetadata: ${pascalName}ModuleMetadata,
  global: false,
};

export default ${pascalName}Module;
export { ${pascalName}Module };
`, 'utf-8');

    // src/<name>.ts
    writeFileSync(join(targetDir, 'src', `${moduleName}.ts`), `import type {
  BuiltinHandler,
  FunctionMetadata,
  ModuleMetadata,
} from "@wiredwp/robinpath";

// ─── Functions ─────────────────────────────────────────

const hello: BuiltinHandler = (args) => {
  const name = String(args[0] ?? "world");
  return \`Hello from ${moduleName}: \${name}\`;
};

const configure: BuiltinHandler = (args) => {
  const apiKey = String(args[0] ?? "");
  if (!apiKey) throw new Error("API key is required");
  return { configured: true };
};

// ─── Exports ───────────────────────────────────────────

export const ${pascalName}Functions: Record<string, BuiltinHandler> = {
  hello,
  configure,
};

export const ${pascalName}FunctionMetadata: Record<string, FunctionMetadata> = {
  hello: {
    description: "Say hello",
    parameters: [
      {
        name: "name",
        dataType: "string",
        description: "Name to greet",
        formInputType: "text",
        required: false,
        defaultValue: "world",
      },
    ],
    returnType: "string",
    returnDescription: "Greeting message",
    example: '${moduleName}.hello "Alice"',
  },
  configure: {
    description: "Configure API credentials",
    parameters: [
      {
        name: "apiKey",
        dataType: "string",
        description: "Your API key",
        formInputType: "password",
        required: true,
      },
    ],
    returnType: "object",
    returnDescription: "{ configured: true }",
    example: '${moduleName}.configure "your-api-key"',
  },
};

export const ${pascalName}ModuleMetadata: ModuleMetadata = {
  description: "${description}",
  methods: ["hello", "configure"],
  author: "${author}",
  category: "${category}",
};
`, 'utf-8');

    // tsconfig.json
    writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            moduleResolution: 'node16',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
        },
        include: ['src'],
    }, null, 2) + '\n', 'utf-8');

    // tests/<name>.test.rp
    writeFileSync(join(targetDir, 'tests', `${moduleName}.test.rp`), `# ${displayName} module tests
# Run: robinpath test tests/

@desc "hello returns greeting"
do
  ${moduleName}.hello "Alice" into $result
  test.assertContains $result "Alice"
enddo

@desc "hello defaults to world"
do
  ${moduleName}.hello into $result
  test.assertContains $result "world"
enddo
`, 'utf-8');

    // README.md
    writeFileSync(join(targetDir, 'README.md'), `# ${fullName}

${description}

## Install

\`\`\`bash
robinpath add ${fullName}
\`\`\`

## Usage

\`\`\`robinpath
# Configure credentials
${moduleName}.configure "your-api-key"

# Say hello
${moduleName}.hello "Alice"
log $
\`\`\`

## Functions

| Function | Description |
|----------|-------------|
| \`configure\` | Configure API credentials |
| \`hello\` | Say hello |

## Development

\`\`\`bash
npm install
npm run build
robinpath test tests/
\`\`\`

## License

${license}
`, 'utf-8');

    // .gitignore
    writeFileSync(join(targetDir, '.gitignore'), `node_modules/
dist/
*.tgz
`, 'utf-8');

    log('');
    log(color.green('Generated:'));
    log(`  ${moduleName}/`);
    log(`  ├── package.json`);
    log(`  ├── src/`);
    log(`  │   ├── index.ts`);
    log(`  │   └── ${moduleName}.ts`);
    log(`  ├── tests/`);
    log(`  │   └── ${moduleName}.test.rp`);
    log(`  ├── tsconfig.json`);
    log(`  ├── README.md`);
    log(`  └── .gitignore`);
    log('');
    log(color.bold('Next steps:'));
    log(`  1. cd ${moduleName}`);
    log(`  2. Edit src/${moduleName}.ts — add your functions`);
    log(`  3. npm install && npm run build`);
    log(`  4. robinpath publish`);
    log('');
}

/**
 * robinpath pack — Create tarball locally without publishing
 */
async function handlePack(args) {
    const targetArg = args.find(a => !a.startsWith('-')) || '.';
    const targetDir = resolve(targetArg);

    const pkgPath = join(targetDir, 'package.json');
    if (!existsSync(pkgPath)) {
        console.error(color.red('Error:') + ` No package.json found in ${targetDir}`);
        process.exit(2);
    }

    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch (err) {
        console.error(color.red('Error:') + ` Invalid package.json: ${err.message}`);
        process.exit(2);
    }

    if (!pkg.name || !pkg.version) {
        console.error(color.red('Error:') + ' package.json must have "name" and "version" fields');
        process.exit(2);
    }

    const safeName = pkg.name.replace(/^@/, '').replace(/\//g, '-');
    const outputFile = `${safeName}-${pkg.version}.tar.gz`;
    const outputPath = resolve(outputFile);
    const parentDir = dirname(targetDir);
    const dirName = basename(targetDir);

    log(`Packing ${pkg.name}@${pkg.version}...`);

    try {
        execSync(
            `tar czf "${toTarPath(outputPath)}" --exclude=node_modules --exclude=.git --exclude=dist --exclude="*.tar.gz" -C "${toTarPath(parentDir)}" "${dirName}"`,
            { stdio: 'pipe' }
        );
    } catch (err) {
        // tar may exit 1 with "file changed as we read it" — check if tarball was created
        if (!existsSync(outputPath)) {
            console.error(color.red('Error:') + ` Failed to create tarball: ${err.message}`);
            process.exit(1);
        }
    }

    const size = statSync(outputPath).size;
    log(color.green('Created') + ` ${outputFile} (${(size / 1024).toFixed(1)}KB)`);
}

/**
 * Format a number with K/M suffixes for compact display
 */
function formatCompactNumber(n) {
    if (n == null) return '-';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

/**
 * Format a relative time string (e.g. "3 days ago")
 */
function formatTimeAgo(dateStr) {
    if (!dateStr) return '-';
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

const VALID_CATEGORIES = ['utilities', 'devops', 'productivity', 'web', 'sales', 'marketing', 'data', 'communication', 'ai'];
const VALID_SORTS = ['downloads', 'stars', 'updated', 'created', 'name'];

/**
 * robinpath search [query] — Search the module registry
 */
async function handleSearch(args) {
    const query = args.filter(a => !a.startsWith('-')).join(' ');
    const category = args.find(a => a.startsWith('--category='))?.split('=')[1];
    const sort = args.find(a => a.startsWith('--sort='))?.split('=')[1];
    const page = args.find(a => a.startsWith('--page='))?.split('=')[1];
    const limit = args.find(a => a.startsWith('--limit='))?.split('=')[1];
    const jsonOutput = args.includes('--json');

    if (!query && !category) {
        console.error(color.red('Error:') + ' Usage: robinpath search <query> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --category=<cat>   Filter by category (' + VALID_CATEGORIES.join(', ') + ')');
        console.error('    --sort=<key>       Sort by: ' + VALID_SORTS.join(', ') + ' (default: downloads)');
        console.error('    --page=<n>         Page number (default: 1)');
        console.error('    --limit=<n>        Results per page (default: 20)');
        console.error('    --json             Machine-readable JSON output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath search slack');
        console.error('    robinpath search --category=ai');
        console.error('    robinpath search crm --category=sales --sort=stars');
        process.exit(2);
    }

    if (category && !VALID_CATEGORIES.includes(category)) {
        console.error(color.red('Error:') + ` Invalid category: ${category}`);
        console.error('  Valid categories: ' + VALID_CATEGORIES.join(', '));
        process.exit(2);
    }

    if (sort && !VALID_SORTS.includes(sort)) {
        console.error(color.red('Error:') + ` Invalid sort: ${sort}`);
        console.error('  Valid sorts: ' + VALID_SORTS.join(', '));
        process.exit(2);
    }

    const token = getAuthToken();

    const searchLabel = query ? `"${query}"` : `category: ${category}`;
    log(`Searching for ${searchLabel}...\n`);

    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (category) params.set('category', category);
        if (sort) params.set('sort', sort);
        if (page) params.set('page', page);
        if (limit) params.set('limit', limit);

        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(`${PLATFORM_URL}/v1/registry/search?${params}`, { headers });
        if (!res.ok) {
            console.error(color.red('Error:') + ` Search failed (HTTP ${res.status})`);
            process.exit(1);
        }

        const body = await res.json();
        const modules = body.data || body.modules || [];
        const pagination = body.pagination || null;

        if (jsonOutput) {
            console.log(JSON.stringify({ modules, pagination }, null, 2));
            return;
        }

        if (modules.length === 0) {
            log('No modules found.');
            return;
        }

        // Rich table output
        const nameW = 30;
        const verW = 10;
        const dlW = 10;
        const starW = 7;
        const updW = 10;
        log(color.bold('  ' + 'Name'.padEnd(nameW) + 'Version'.padEnd(verW) + 'Downloads'.padEnd(dlW) + 'Stars'.padEnd(starW) + 'Updated'.padEnd(updW) + 'Description'));
        log(color.dim('  ' + '─'.repeat(nameW + verW + dlW + starW + updW + 25)));

        for (const mod of modules) {
            const modName = (mod.scope ? `@${mod.scope}/${mod.name}` : mod.name) || mod.id || '?';
            const ver = mod.version || mod.latestVersion || '-';
            const dl = formatCompactNumber(mod.downloadsTotal ?? mod.downloadsWeekly ?? mod.downloads ?? mod.downloadCount);
            const stars = formatCompactNumber(mod.stars);
            const updated = formatTimeAgo(mod.updatedAt);
            const desc = (mod.description || '').slice(0, 25);
            const badges = [];
            if (mod.isOfficial) badges.push(color.cyan('●'));
            if (mod.isVerified) badges.push(color.green('✓'));
            const badgeStr = badges.length ? ' ' + badges.join('') : '';

            log(`  ${(modName + badgeStr).padEnd(nameW + (badgeStr.length - badges.length))}${ver.padEnd(verW)}${dl.padEnd(dlW)}${('★ ' + stars).padEnd(starW)}${color.dim(updated.padEnd(updW))}${color.dim(desc)}`);
        }

        log('');
        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${modules.length} result${modules.length !== 1 ? 's' : ''}`));
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Search failed: ${err.message}`);
        process.exit(1);
    }
}

/**
 * robinpath info <pkg> — Show module details
 */
async function handleInfo(args) {
    const spec = args.find(a => !a.startsWith('-'));
    const jsonOutput = args.includes('--json');
    if (!spec) {
        // Collect native module info
        const modulesInfo = {};
        for (const mod of nativeModules) {
            modulesInfo[mod.name] = {
                functions: Object.keys(mod.functions),
                description: mod.moduleMetadata?.description || null,
                function_metadata: mod.functionMetadata || null,
            };
        }

        // Collect installed (external) module info from manifest
        const installedModulesInfo = {};
        const manifest = readModulesManifest();
        for (const [packageName, mInfo] of Object.entries(manifest)) {
            const entry = {
                version: mInfo.version,
                installed_at: mInfo.installedAt || null,
                path: getModulePath(packageName),
            };
            // Try to read module's package.json for description & functions
            try {
                const pkgPath = join(getModulePath(packageName), 'package.json');
                if (existsSync(pkgPath)) {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    if (pkg.description) entry.description = pkg.description;
                    if (pkg.keywords) entry.keywords = pkg.keywords;
                }
            } catch { /* ignore */ }
            installedModulesInfo[packageName] = entry;
        }

        // No args — show system/environment info for external tools and AI agents
        const info = {
            ok: true,
            version: CLI_VERSION,
            lang_version: ROBINPATH_VERSION,
            platform: platform(),
            arch: process.arch,
            node_version: process.version,
            executable: process.execPath,
            pid: process.pid,
            paths: {
                home: getRobinPathHome(),
                bin: getInstallDir(),
                modules: MODULES_DIR,
                modules_manifest: MODULES_MANIFEST,
                cache: CACHE_DIR,
                auth: getAuthPath(),
                history: join(homedir(), '.robinpath', 'history'),
                env: join(homedir(), '.robinpath', 'env'),
                docs: join(getRobinPathHome(), 'DOCUMENTATION.md'),
            },
            native_modules: modulesInfo,
            installed_modules: installedModulesInfo,
            docs: {
                overview: 'RobinPath is a scripting language for automation and data processing. It can be used as a CLI tool, an embedded SDK for JavaScript apps, or an HTTP server for integration with any programming language.',
                install: {
                    unix: 'curl -fsSL https://dev.robinpath.com/install.sh | bash',
                    windows: 'irm https://dev.robinpath.com/install.ps1 | iex',
                },
                cli_commands: {
                    run_file: 'robinpath <file.rp>',
                    run_inline: 'robinpath -e \'log "hello"\'',
                    run_stdin: 'echo \'log 1\' | robinpath',
                    fmt: 'robinpath fmt <file|dir> [--write] [--check] [--diff]',
                    check: 'robinpath check <file> [--json]',
                    ast: 'robinpath ast <file> [--compact]',
                    test: 'robinpath test [dir|file] [--json]',
                    add_module: 'robinpath add <@scope/name>[@version]',
                    remove_module: 'robinpath remove <@scope/name>',
                    upgrade_module: 'robinpath upgrade <@scope/name>',
                    list_modules: 'robinpath modules list',
                    upgrade_all: 'robinpath modules upgrade',
                    scaffold_module: 'robinpath modules init',
                    search: 'robinpath search [query] [--category=<cat>] [--sort=<key>] [--page=<n>] [--limit=<n>] [--json]',
                    info_system: 'robinpath info [--json]',
                    info_module: 'robinpath info <@scope/name>',
                    audit: 'robinpath audit',
                    init_project: 'robinpath init [--force]',
                    install_deps: 'robinpath install',
                    doctor: 'robinpath doctor',
                    env_set: 'robinpath env set <KEY> <value>',
                    env_list: 'robinpath env list',
                    env_remove: 'robinpath env remove <KEY>',
                    cache_list: 'robinpath cache list',
                    cache_clean: 'robinpath cache clean',
                    install_system: 'robinpath install',
                    uninstall: 'robinpath uninstall',
                    update: 'robinpath update',
                    login: 'robinpath login',
                    logout: 'robinpath logout',
                    whoami: 'robinpath whoami',
                    publish: 'robinpath publish [dir] [--public|--private] [--org <name>] [--patch|--minor|--major] [--dry-run]',
                    pack: 'robinpath pack [dir]',
                    deprecate: 'robinpath deprecate <@scope/name> "reason"',
                    sync: 'robinpath sync',
                    start_server: 'robinpath start [-p port] [-s session] [--host addr] [--timeout ms] [--max-concurrent n] [--cors-origin origin] [--log-file path] [--max-body bytes]',
                    server_status: 'robinpath status [-p port]',
                    watch: 'robinpath --watch <file.rp>',
                    repl: 'robinpath (no arguments)',
                },
                global_flags: {
                    '-q, --quiet': 'Suppress non-error output',
                    '--verbose': 'Show timing and debug info',
                    '-v, --version': 'Show version',
                    '-h, --help': 'Show help',
                    '-w, --watch': 'Re-run on file changes',
                },
                http_server: {
                    description: 'Start an HTTP server that exposes the RobinPath engine via REST API. One server handles all requests. Variables persist across requests (conversational execution). Designed for integration with any language (Rust, Python, Go, PHP, Ruby, C#, Java, etc.).',
                    start: 'robinpath start -p <port> -s <session-secret>',
                    startup_output: `{"ok":true,"port":6372,"host":"127.0.0.1","session":"<uuid>","version":"${CLI_VERSION}"}`,
                    auth_header: 'x-robinpath-session: <session-token> (required on all endpoints except /v1/health)',
                    defaults: {
                        port: 6372,
                        host: '127.0.0.1',
                        timeout_ms: 30000,
                        max_concurrent: 5,
                        max_body_bytes: 5000000,
                        cors_origin: '*',
                    },
                    endpoints: {
                        'GET /v1/health': { auth: false, description: 'Health check', response: '{"ok":true,"version":"...","uptime_ms":...}' },
                        'POST /v1/execute': { auth: true, description: 'Execute script', body: '{"code":"log 1"} or Content-Type: text/plain with raw code', response: '{"ok":true,"jobId":"...","status":"completed","output":"1\\n","duration":12}', notes: 'Add Accept: text/event-stream for SSE streaming. Add webhook/webhook_secret for fire-and-forget callback.' },
                        'POST /v1/execute/file': { auth: true, description: 'Execute script file', body: '{"file":"./script.rp"}', response: 'Same as /v1/execute' },
                        'POST /v1/check': { auth: true, description: 'Syntax check without executing', body: '{"script":"log 1"}', response: '{"ok":true,"message":"No syntax errors"}' },
                        'POST /v1/fmt': { auth: true, description: 'Format code', body: '{"script":"set $x as 1"}', response: '{"ok":true,"formatted":"$x = 1\\n"}' },
                        'GET /v1/jobs': { auth: true, description: 'List jobs', query: '?status=running&limit=10', response: '{"ok":true,"jobs":[...]}' },
                        'GET /v1/jobs/:id': { auth: true, description: 'Get job details', response: 'Single job object with output' },
                        'GET /v1/jobs/:id/stream': { auth: true, description: 'SSE stream for job progress', notes: 'Returns event: started, output, completed, job.failed, done' },
                        'POST /v1/jobs/:id/cancel': { auth: true, description: 'Cancel running job', response: '{"ok":true,"jobId":"...","status":"cancelled"}' },
                        'GET /v1/modules': { auth: true, description: 'List all loaded modules and functions' },
                        'GET /v1/info': { auth: true, description: 'Server runtime info (uptime, memory, config, job counts)' },
                        'GET /v1/metrics': { auth: true, description: 'Prometheus-style metrics (text/plain)' },
                        'GET /v1/openapi.json': { auth: true, description: 'OpenAPI 3.1 specification' },
                        'POST /v1/stop': { auth: true, description: 'Graceful shutdown (waits for active jobs)', response: '{"ok":true,"message":"Server stopping","active_jobs":[]}' },
                    },
                    optional_headers: {
                        'x-request-id': 'Client request ID (auto-generated UUID if missing)',
                        'x-idempotency-key': 'Prevent duplicate execution on retry (5-min TTL)',
                        'Accept: text/event-stream': 'Request SSE streaming on /v1/execute and /v1/jobs/:id/stream',
                        'Content-Type: text/plain': 'Send raw code in body without JSON wrapping',
                    },
                    response_headers: {
                        'x-processing-ms': 'Processing time in milliseconds',
                        'x-request-id': 'Echo of request ID',
                        'x-rate-limit-limit': 'Rate limit quota',
                        'x-rate-limit-remaining': 'Requests remaining',
                        'x-rate-limit-reset': 'When limit resets',
                    },
                    sse_events: ['started', 'output', 'completed', 'job.failed', 'job.cancelled', 'done'],
                    webhook: {
                        description: 'Add webhook URL to /v1/execute for fire-and-forget execution. Returns 202 immediately.',
                        body_fields: 'webhook (URL), webhook_secret (for HMAC-SHA256 signature)',
                        signature_header: 'X-Webhook-Signature: sha256=<hmac-hex>',
                    },
                    features: ['Session gatekeeper', 'API versioning (/v1/)', 'SSE streaming', 'Webhook callbacks with HMAC-SHA256', 'Idempotency keys', 'Rate limiting', 'Job queue with cancel', 'Structured JSON logging', 'Prometheus metrics', 'OpenAPI spec', 'Graceful shutdown', 'Persistent runtime state', 'Plain text body support', 'PID file management'],
                },
                sdk: {
                    description: 'For JavaScript/TypeScript apps (React, Next.js, Vue, Angular, Express, Node.js). Direct in-process execution, no HTTP server needed.',
                    install: 'npm install @robinpath/sdk',
                    usage: [
                        'import { createRuntime } from "@robinpath/sdk";',
                        'const rp = createRuntime();',
                        'const result = await rp.run("log math.add 1 2");',
                        '// result: { ok, output, value, logs, variables, error, stats }',
                    ].join('\n'),
                    options: {
                        timeout: 'Max execution time in ms (0 = no limit)',
                        permissions: '"all" | "none" | { fs, net, child, env, crypto } — restrict what scripts can access',
                        modules: 'Whitelist of allowed module names (undefined = all)',
                        customBuiltins: 'Record<string, handler> — add custom functions',
                        customModules: '[{ name, functions }] — add custom modules',
                    },
                    context: 'await rp.run("log $name", { name: "Robin" }) — pass variables into scripts',
                    streaming: 'rp.stream(code).on("log", handler).on("done", handler)',
                    state: 'Variables persist across run() calls on the same runtime instance',
                    engine_access: 'rp.engine — access underlying RobinPath instance for advanced use',
                },
                integration: {
                    description: 'For non-JS languages (Rust, Python, Go, PHP, Ruby, C#, Java), use robinpath start HTTP server.',
                    pattern: [
                        '1. Spawn: robinpath start -p <port> [-s <secret>]',
                        '2. Parse startup JSON from stdout to get session token',
                        '3. Send HTTP requests with x-robinpath-session header',
                        '4. Stop: POST /v1/stop or send SIGTERM',
                    ],
                    rust_example: 'let child = Command::new("robinpath").args(["start","-p","6372"]).stdout(Stdio::piped()).spawn()?;\n// Read first line for session, then use reqwest to POST /v1/execute',
                    python_example: 'proc = subprocess.Popen(["robinpath","start","-p","6372"], stdout=subprocess.PIPE)\nstartup = json.loads(proc.stdout.readline())\nsession = startup["session"]\nrequests.post(f"http://127.0.0.1:6372/v1/execute", headers={"x-robinpath-session": session}, json={"code": "log 1"})',
                    js_note: 'For JavaScript apps, prefer @robinpath/sdk (direct, no server needed) over HTTP.',
                },
                language_syntax: {
                    variables: 'set $x = 1  OR  $x = 1',
                    log: 'log "hello"  OR  log $x',
                    module_call: 'set $r = math.add 1 2  OR  math.add 1 2',
                    string_concat: 'set $s = "hello " + $name',
                    if_block: 'if $x > 5\n  log "big"\nendif',
                    for_loop: 'for $i in array.create 1 2 3\n  log $i\nendfor',
                    function_def: 'def greet $name\n  log "Hello " + $name\nenddef',
                    events: 'on "myEvent" $data\n  log $data\nendon',
                    comments: '# This is a comment',
                    file_extensions: '.rp, .robin (both recognized)',
                },
                file_structure: {
                    '~/.robinpath/': 'Home directory',
                    '~/.robinpath/bin/': 'Binary installation',
                    '~/.robinpath/modules/': 'Installed modules',
                    '~/.robinpath/modules/modules.json': 'Module manifest',
                    '~/.robinpath/cache/': 'Download cache',
                    '~/.robinpath/auth.json': 'Auth credentials',
                    '~/.robinpath/history': 'REPL history',
                    '~/.robinpath/env': 'Environment secrets',
                    '~/.robinpath/server-<port>.pid': 'Server PID file',
                    'robinpath.json': 'Project config',
                    'robinpath-lock.json': 'Lock file',
                },
            },
        };
        if (jsonOutput || !isTTY) {
            console.log(JSON.stringify(info, null, 2));
        } else {
            console.log(`RobinPath v${CLI_VERSION} (lang v${ROBINPATH_VERSION})`);
            console.log('');
            console.log(`  Platform:     ${info.platform} (${info.arch})`);
            console.log(`  Node:         ${info.node_version}`);
            console.log(`  Executable:   ${info.executable}`);
            console.log('');
            console.log('Paths:');
            console.log(`  Home:         ${info.paths.home}`);
            console.log(`  Binary:       ${info.paths.bin}`);
            console.log(`  Modules:      ${info.paths.modules}`);
            console.log(`  Manifest:     ${info.paths.modules_manifest}`);
            console.log(`  Cache:        ${info.paths.cache}`);
            console.log(`  Auth:         ${info.paths.auth}`);
            console.log(`  History:      ${info.paths.history}`);
            console.log(`  Env:          ${info.paths.env}`);
            console.log(`  Docs:         ${info.paths.docs}`);
            console.log('');
            console.log(`Native Modules (${Object.keys(modulesInfo).length}): ${Object.keys(modulesInfo).join(', ')}`);
            console.log('');
            const installedNames = Object.keys(installedModulesInfo);
            if (installedNames.length > 0) {
                console.log(`Installed Modules (${installedNames.length}): ${installedNames.join(', ')}`);
            } else {
                console.log('Installed Modules: (none)');
            }
            console.log('');
            console.log(color.dim('Use --json for machine-readable output (includes full docs for AI agents)'));
        }
        return;
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { scope, name, fullName } = parsed;
    const token = getAuthToken();

    try {
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        // Fetch module info and versions in parallel
        const [res, versionsRes] = await Promise.all([
            fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, { headers }),
            fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}/versions`, { headers }).catch(() => null),
        ]);

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Module not found: ${fullName}`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch info (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = await res.json();
        const data = body.data || body;

        if (jsonOutput) {
            let versionsData = null;
            if (versionsRes?.ok) {
                const vBody = await versionsRes.json();
                versionsData = vBody.data || vBody;
            }
            console.log(JSON.stringify({ module: data, versions: versionsData }, null, 2));
            return;
        }

        // Header
        log('');
        const badges = [];
        if (data.isOfficial) badges.push(color.cyan(' official'));
        if (data.isVerified) badges.push(color.green(' verified'));
        log(`  ${color.bold(fullName)} ${color.cyan('v' + (data.latestVersion || data.version || '-'))}${badges.join('')}`);
        if (data.description) log(`  ${data.description}`);
        log('');

        // Metadata
        if (data.author || data.publisher?.name) log(`  Author:       ${data.author || data.publisher?.name || '-'}`);
        if (data.license) log(`  License:      ${data.license}`);
        if (data.category) log(`  Category:     ${data.category}`);
        const visibility = data.visibility || (data.isPublic === false ? 'private' : 'public');
        log(`  Visibility:   ${visibility}`);
        log('');

        // Stats
        const dlWeekly = data.downloadsWeekly ?? data.downloads ?? data.downloadCount;
        const dlTotal = data.downloadsTotal;
        const stars = data.stars;
        if (dlWeekly !== undefined || dlTotal !== undefined || stars !== undefined) {
            const parts = [];
            if (dlTotal !== undefined) parts.push(`${formatCompactNumber(dlTotal)} total downloads`);
            if (dlWeekly !== undefined) parts.push(`${formatCompactNumber(dlWeekly)} weekly`);
            if (stars !== undefined) parts.push(`★ ${formatCompactNumber(stars)}`);
            log(`  Stats:        ${parts.join('  │  ')}`);
        }

        if (data.createdAt) log(`  Created:      ${formatTimeAgo(data.createdAt)}`);
        if (data.updatedAt) log(`  Updated:      ${formatTimeAgo(data.updatedAt)}`);

        let parsedKeywords = data.keywords;
        if (typeof parsedKeywords === 'string') {
            try { parsedKeywords = JSON.parse(parsedKeywords); } catch { parsedKeywords = null; }
        }
        if (parsedKeywords?.length) log(`  Keywords:     ${parsedKeywords.join(', ')}`);
        log('');

        // Version history
        if (versionsRes?.ok) {
            const vBody = await versionsRes.json();
            const vData = vBody.data || vBody;
            const versions = vData.versions || vData;
            const distTags = vData.distTags || vData.dist_tags || [];

            if (Array.isArray(versions) && versions.length > 0) {
                const tagMap = {};
                if (Array.isArray(distTags)) {
                    for (const dt of distTags) {
                        tagMap[dt.version] = tagMap[dt.version] || [];
                        tagMap[dt.version].push(dt.tag);
                    }
                }

                log(color.bold('  Versions'));
                log(color.dim('  ' + '─'.repeat(55)));
                const shown = versions.slice(0, 10);
                for (const v of shown) {
                    const tags = tagMap[v.version];
                    const tagStr = tags ? ` ${color.cyan(tags.join(', '))}` : '';
                    const size = v.tarballSize ? ` (${(v.tarballSize / 1024).toFixed(1)}KB)` : '';
                    const deprecated = v.deprecated ? color.red(' DEPRECATED') : '';
                    const published = formatTimeAgo(v.createdAt);
                    log(`  ${('v' + v.version).padEnd(14)}${color.dim(published.padEnd(12))}${color.dim(size)}${tagStr}${deprecated}`);
                }
                if (versions.length > 10) {
                    log(color.dim(`  ... and ${versions.length - 10} more version${versions.length - 10 !== 1 ? 's' : ''}`));
                }
                log('');
            }
        }

        // Install status
        const manifest = readModulesManifest();
        if (manifest[fullName]) {
            log(`  ${color.green('Installed')} v${manifest[fullName].version}`);
        } else {
            log(`  ${color.cyan('robinpath add ' + fullName)}`);
        }
        log('');
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to fetch info: ${err.message}`);
        process.exit(1);
    }
}

// ============================================================================
// Project & Environment commands
// ============================================================================

/**
 * robinpath init — Create a robinpath.json project config
 */
async function handleInit(args) {
    const projectFile = resolve('robinpath.json');
    if (existsSync(projectFile) && !args.includes('--force')) {
        console.error(color.red('Error:') + ' robinpath.json already exists. Use --force to overwrite.');
        process.exit(1);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise(resolve => {
        const prompt = def ? `${q} (${def}): ` : `${q}: `;
        rl.question(prompt, answer => resolve(answer.trim() || def || ''));
    });

    log('');
    log(color.bold('  Create a new RobinPath project'));
    log(color.dim('  ' + '─'.repeat(35)));
    log('');

    const dirName = basename(process.cwd());
    const projectName = await ask('  Project name', dirName);
    const description = await ask('  Description', '');
    const auth = readAuth();
    const author = await ask('  Author', auth?.email || '');
    const mainFile = await ask('  Entry file', 'main.rp');

    rl.close();

    const config = {
        name: projectName,
        version: '1.0.0',
        description,
        author,
        main: mainFile,
        modules: {},
        env: {},
    };

    writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    // Create main.rp if it doesn't exist
    const mainPath = resolve(mainFile);
    if (!existsSync(mainPath)) {
        writeFileSync(mainPath, `# ${projectName}
# Run: robinpath ${mainFile}

log "Hello from RobinPath!"
`, 'utf-8');
    }

    // Create .env if it doesn't exist
    if (!existsSync(resolve('.env'))) {
        writeFileSync(resolve('.env'), `# Add your secrets here
# SLACK_TOKEN=xoxb-...
# OPENAI_KEY=sk-...
`, 'utf-8');
    }

    // Create .gitignore if it doesn't exist
    if (!existsSync(resolve('.gitignore'))) {
        writeFileSync(resolve('.gitignore'), `.env
.robinpath/
node_modules/
`, 'utf-8');
    }

    log('');
    log(color.green('Created project:'));
    log(`  robinpath.json`);
    if (!existsSync(mainPath)) log(`  ${mainFile}`);
    log(`  .env`);
    log(`  .gitignore`);
    log('');
    log(`Run: ${color.cyan('robinpath ' + mainFile)}`);
    log('');
}

/**
 * robinpath install — Install all modules from robinpath.json
 */
async function handleProjectInstall() {
    const projectFile = resolve('robinpath.json');
    if (!existsSync(projectFile)) {
        // Fall back to system install if no robinpath.json
        handleInstall();
        return;
    }

    let config;
    try {
        config = JSON.parse(readFileSync(projectFile, 'utf-8'));
    } catch (err) {
        console.error(color.red('Error:') + ` Invalid robinpath.json: ${err.message}`);
        process.exit(2);
    }

    const modules = config.modules || {};
    const entries = Object.entries(modules);

    if (entries.length === 0) {
        log('No modules specified in robinpath.json.');
        log(`Use ${color.cyan('robinpath add <module>')} to add modules.`);
        return;
    }

    log(`Installing ${entries.length} module${entries.length !== 1 ? 's' : ''} from robinpath.json...\n`);

    const manifest = readModulesManifest();
    let installed = 0;
    let skipped = 0;
    let failed = 0;

    for (const [name, versionSpec] of entries) {
        // Check if already installed with matching version
        if (manifest[name]) {
            const current = manifest[name].version;
            // Simple check: if version spec starts with ^ or ~, accept if installed
            if (versionSpec.startsWith('^') || versionSpec.startsWith('~')) {
                log(color.green('  ✓') + `  ${name}@${current} (already installed)`);
                skipped++;
                continue;
            }
            if (current === versionSpec) {
                log(color.green('  ✓') + `  ${name}@${current} (already installed)`);
                skipped++;
                continue;
            }
        }

        try {
            // Extract exact version from spec (strip ^ or ~)
            const version = versionSpec.replace(/^[\^~]/, '');
            await handleAdd([`${name}@${version}`]);
            installed++;
        } catch (err) {
            log(color.red('  ✗') + `  ${name}: ${err.message}`);
            failed++;
        }
    }

    // Generate lock file
    const lockFile = resolve('robinpath-lock.json');
    const updatedManifest = readModulesManifest();
    const lockData = {};
    for (const [name] of entries) {
        if (updatedManifest[name]) {
            lockData[name] = {
                version: updatedManifest[name].version,
                integrity: updatedManifest[name].integrity,
            };
        }
    }
    writeFileSync(lockFile, JSON.stringify(lockData, null, 2) + '\n', 'utf-8');

    log('');
    const parts = [];
    if (installed > 0) parts.push(color.green(`${installed} installed`));
    if (skipped > 0) parts.push(`${skipped} already installed`);
    if (failed > 0) parts.push(color.red(`${failed} failed`));
    log(parts.join(', '));
    log(color.dim('Lock file written: robinpath-lock.json'));
}

/**
 * robinpath doctor — Diagnose environment
 */
async function handleDoctor() {
    log('');
    log(color.bold('  RobinPath Doctor'));
    log(color.dim('  ' + '─'.repeat(35)));
    log('');

    let issues = 0;

    // CLI version
    log(color.green('  ✓') + ` CLI version ${CLI_VERSION} (lang ${ROBINPATH_VERSION})`);

    // Install location
    const installDir = getInstallDir();
    const isWindows = platform() === 'win32';
    const binaryName = isWindows ? 'robinpath.exe' : 'robinpath';
    if (existsSync(join(installDir, binaryName))) {
        log(color.green('  ✓') + ` Installed: ${installDir}`);
    } else {
        log(color.yellow('  !') + ` Not installed to PATH. Run ${color.cyan('robinpath install')}`);
        issues++;
    }

    // Auth
    const auth = readAuth();
    const token = getAuthToken();
    if (token) {
        log(color.green('  ✓') + ` Logged in as ${auth.email || auth.name || 'unknown'}`);
        if (auth.expiresAt) {
            const remaining = Math.floor((auth.expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
            if (remaining < 7) {
                log(color.yellow('  !') + ` Session expires in ${remaining} day${remaining !== 1 ? 's' : ''}`);
                issues++;
            }
        }
    } else {
        log(color.yellow('  !') + ` Not logged in. Run ${color.cyan('robinpath login')}`);
        issues++;
    }

    // Modules directory
    const manifest = readModulesManifest();
    const moduleCount = Object.keys(manifest).length;
    if (moduleCount > 0) {
        log(color.green('  ✓') + ` ${moduleCount} module${moduleCount !== 1 ? 's' : ''} installed`);

        // Check each module is valid
        for (const [name, info] of Object.entries(manifest)) {
            const modDir = getModulePath(name);
            const pkgPath = join(modDir, 'package.json');
            if (!existsSync(modDir)) {
                log(color.red('  ✗') + `   ${name}: directory missing`);
                issues++;
            } else if (!existsSync(pkgPath)) {
                log(color.red('  ✗') + `   ${name}: package.json missing`);
                issues++;
            } else {
                // Check entry point exists
                let entryPoint = 'dist/index.js';
                try {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    if (pkg.main) entryPoint = pkg.main;
                } catch { /* use default */ }
                if (!existsSync(join(modDir, entryPoint))) {
                    log(color.red('  ✗') + `   ${name}: entry point ${entryPoint} missing`);
                    issues++;
                }
            }
        }
    } else {
        log(color.dim('  -') + ` No modules installed`);
    }

    // Project config
    const projectFile = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8'));
            log(color.green('  ✓') + ` Project: ${config.name || 'unnamed'} v${config.version || '?'}`);

            // Check if project modules are all installed
            const projectModules = Object.keys(config.modules || {});
            for (const mod of projectModules) {
                if (!manifest[mod]) {
                    log(color.red('  ✗') + `   Missing module: ${mod} (run ${color.cyan('robinpath install')})`);
                    issues++;
                }
            }
        } catch {
            log(color.red('  ✗') + ' Invalid robinpath.json');
            issues++;
        }
    }

    // Cache
    if (existsSync(CACHE_DIR)) {
        try {
            const cacheFiles = readdirSync(CACHE_DIR);
            const cacheSize = cacheFiles.reduce((total, f) => {
                try { return total + statSync(join(CACHE_DIR, f)).size; } catch { return total; }
            }, 0);
            log(color.dim('  -') + ` Cache: ${cacheFiles.length} files (${(cacheSize / 1024).toFixed(0)}KB)`);
        } catch { /* ignore */ }
    }

    log('');
    if (issues === 0) {
        log(color.green('  No issues found.'));
    } else {
        log(color.yellow(`  ${issues} issue${issues !== 1 ? 's' : ''} found.`));
    }
    log('');
}

/**
 * robinpath env set|list|remove — Manage environment secrets
 */
async function handleEnv(args) {
    const envPath = join(getRobinPathHome(), 'env');
    const sub = args[0];

    function readEnvFile() {
        try {
            if (!existsSync(envPath)) return {};
            const lines = readFileSync(envPath, 'utf-8').split('\n');
            const env = {};
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
                }
            }
            return env;
        } catch {
            return {};
        }
    }

    function writeEnvFile(env) {
        const dir = getRobinPathHome();
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
        writeFileSync(envPath, content, 'utf-8');
        if (platform() !== 'win32') {
            try { chmodSync(envPath, 0o600); } catch { /* ignore */ }
        }
    }

    if (sub === 'set') {
        const key = args[1];
        const value = args.slice(2).join(' ');
        if (!key) {
            console.error(color.red('Error:') + ' Usage: robinpath env set <KEY> <value>');
            process.exit(2);
        }
        const env = readEnvFile();
        env[key] = value;
        writeEnvFile(env);
        log(color.green('Set') + ` ${key}`);
    } else if (sub === 'list') {
        const env = readEnvFile();
        const entries = Object.entries(env);
        if (entries.length === 0) {
            log('No environment variables set.');
            log(`Use ${color.cyan('robinpath env set <KEY> <value>')} to add one.`);
            return;
        }
        log('');
        log(color.bold('  Environment variables:'));
        log(color.dim('  ' + '─'.repeat(40)));
        for (const [key, value] of entries) {
            const masked = value.length > 4 ? value.slice(0, 2) + '•'.repeat(Math.min(value.length - 4, 20)) + value.slice(-2) : '••••';
            log(`  ${key.padEnd(25)} ${color.dim(masked)}`);
        }
        log('');
        log(color.dim(`${entries.length} variable${entries.length !== 1 ? 's' : ''}`));
        log('');
    } else if (sub === 'remove' || sub === 'delete') {
        const key = args[1];
        if (!key) {
            console.error(color.red('Error:') + ' Usage: robinpath env remove <KEY>');
            process.exit(2);
        }
        const env = readEnvFile();
        if (!env[key]) {
            console.error(color.red('Error:') + ` Variable not found: ${key}`);
            process.exit(1);
        }
        delete env[key];
        writeEnvFile(env);
        log(color.green('Removed') + ` ${key}`);
    } else {
        console.error(color.red('Error:') + ' Usage: robinpath env <set|list|remove>');
        console.error('  robinpath env set SLACK_TOKEN xoxb-...');
        console.error('  robinpath env list');
        console.error('  robinpath env remove SLACK_TOKEN');
        process.exit(2);
    }
}

/**
 * robinpath cache clean|list — Manage download cache
 */
async function handleCache(args) {
    const sub = args[0];

    if (sub === 'list') {
        if (!existsSync(CACHE_DIR)) {
            log('Cache is empty.');
            return;
        }
        try {
            const files = readdirSync(CACHE_DIR);
            if (files.length === 0) {
                log('Cache is empty.');
                return;
            }
            log('');
            log(color.bold('  Cached packages:'));
            log(color.dim('  ' + '─'.repeat(50)));
            let totalSize = 0;
            for (const file of files) {
                const size = statSync(join(CACHE_DIR, file)).size;
                totalSize += size;
                log(`  ${file.padEnd(45)} ${color.dim((size / 1024).toFixed(1) + 'KB')}`);
            }
            log('');
            log(color.dim(`${files.length} file${files.length !== 1 ? 's' : ''}, ${(totalSize / 1024).toFixed(0)}KB total`));
            log('');
        } catch (err) {
            console.error(color.red('Error:') + ` Failed to list cache: ${err.message}`);
            process.exit(1);
        }
    } else if (sub === 'clean') {
        if (!existsSync(CACHE_DIR)) {
            log('Cache is already empty.');
            return;
        }
        try {
            const files = readdirSync(CACHE_DIR);
            let totalSize = 0;
            for (const file of files) {
                totalSize += statSync(join(CACHE_DIR, file)).size;
            }
            rmSync(CACHE_DIR, { recursive: true, force: true });
            log(color.green('Cleared') + ` ${files.length} cached file${files.length !== 1 ? 's' : ''} (${(totalSize / 1024).toFixed(0)}KB freed)`);
        } catch (err) {
            console.error(color.red('Error:') + ` Failed to clean cache: ${err.message}`);
            process.exit(1);
        }
    } else {
        console.error(color.red('Error:') + ' Usage: robinpath cache <list|clean>');
        process.exit(2);
    }
}

/**
 * robinpath audit — Check installed modules for issues
 */
async function handleAudit() {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed. Nothing to audit.');
        return;
    }

    log(`Auditing ${entries.length} module${entries.length !== 1 ? 's' : ''}...\n`);

    let warnings = 0;
    let ok = 0;
    const token = getAuthToken();

    for (const [fullName, info] of entries) {
        const parsed = parsePackageSpec(fullName);
        if (!parsed || !parsed.scope) {
            log(color.yellow('  !') + `  ${fullName}: invalid package name`);
            warnings++;
            continue;
        }

        try {
            const headers = {};
            if (token) headers.Authorization = `Bearer ${token}`;

            const res = await fetch(`${PLATFORM_URL}/v1/registry/${parsed.scope}/${parsed.name}`, { headers });

            if (!res.ok) {
                log(color.yellow('  !') + `  ${fullName}: could not check registry`);
                warnings++;
                continue;
            }

            const body = await res.json();
            const data = body.data || body;

            // Check if deprecated
            if (data.deprecated) {
                log(color.red('  ✗') + `  ${fullName}@${info.version} — ${color.red('deprecated')}: ${data.deprecated}`);
                warnings++;
                continue;
            }

            // Check if outdated
            const latest = data.latestVersion || data.version;
            if (latest && latest !== info.version) {
                log(color.yellow('  !') + `  ${fullName}@${info.version} → ${latest} available`);
                warnings++;
            } else {
                log(color.green('  ✓') + `  ${fullName}@${info.version}`);
                ok++;
            }
        } catch (err) {
            log(color.yellow('  !') + `  ${fullName}: ${err.message}`);
            warnings++;
        }
    }

    log('');
    if (warnings === 0) {
        log(color.green(`No issues found. ${ok} module${ok !== 1 ? 's' : ''} OK.`));
    } else {
        log(`${color.yellow(warnings + ' warning' + (warnings !== 1 ? 's' : ''))}` +
            (ok > 0 ? `, ${ok} OK` : ''));
    }
    log('');
}

/**
 * robinpath deprecate <pkg> "reason" — Mark a module as deprecated
 */
async function handleDeprecate(args) {
    const spec = args.find(a => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath deprecate <module> "reason"');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const reason = args.filter(a => a !== spec && !a.startsWith('-')).join(' ') || 'This module is deprecated';
    const { scope, name, fullName } = parsed;
    const token = requireAuth();

    log(`Deprecating ${fullName}...`);

    try {
        const res = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}/deprecate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: reason }),
        });

        if (res.ok) {
            log(color.yellow('Deprecated') + ` ${fullName}: ${reason}`);
        } else {
            const body = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to deprecate: ${body?.error?.message || 'HTTP ' + res.status}`);
            process.exit(1);
        }
    } catch (err) {
        console.error(color.red('Error:') + ` Failed to deprecate: ${err.message}`);
        process.exit(1);
    }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * robinpath check <file> — Syntax checker
 */
async function handleCheck(args) {
    const jsonOutput = args.includes('--json');
    const fileArg = args.find(a => !a.startsWith('-'));
    if (!fileArg) {
        console.error(color.red('Error:') + ' check requires a file argument');
        console.error('Usage: robinpath check <file> [--json]');
        process.exit(2);
    }

    const filePath = resolveScriptPath(fileArg);
    if (!filePath) {
        if (jsonOutput) {
            console.log(JSON.stringify({ ok: false, file: fileArg, error: `File not found: ${fileArg}` }));
        } else {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        }
        process.exit(2);
    }

    const script = readFileSync(filePath, 'utf-8');
    const startTime = FLAG_VERBOSE ? performance.now() : 0;

    try {
        const parser = new Parser(script);
        await parser.parse();
        if (FLAG_VERBOSE) {
            const elapsed = (performance.now() - startTime).toFixed(1);
            logVerbose(`Parsed in ${elapsed}ms`);
        }
        if (jsonOutput) {
            console.log(JSON.stringify({ ok: true, file: fileArg }));
        } else {
            log(color.green('OK') + ` ${fileArg} — no syntax errors`);
        }
        process.exit(0);
    } catch (error) {
        if (jsonOutput) {
            // Extract line/column from error message if possible
            const lineMatch = error.message.match(/line (\d+)/i);
            const colMatch = error.message.match(/column (\d+)/i);
            console.log(JSON.stringify({
                ok: false,
                file: fileArg,
                error: error.message,
                line: lineMatch ? parseInt(lineMatch[1]) : null,
                column: colMatch ? parseInt(colMatch[1]) : null,
            }));
        } else {
            try {
                const formatted = formatErrorWithContext({ message: error.message, code: script });
                console.error(color.red('Syntax error') + ` in ${fileArg}:\n${formatted}`);
            } catch {
                console.error(color.red('Syntax error') + ` in ${fileArg}: ${error.message}`);
            }
        }
        process.exit(2);
    }
}

/**
 * robinpath ast <file> — AST dump
 */
async function handleAST(args) {
    const compact = args.includes('--compact');
    const fileArg = args.find(a => !a.startsWith('-'));
    if (!fileArg) {
        console.error(color.red('Error:') + ' ast requires a file argument');
        console.error('Usage: robinpath ast <file> [--compact]');
        process.exit(2);
    }

    const filePath = resolveScriptPath(fileArg);
    if (!filePath) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(2);
    }

    const script = readFileSync(filePath, 'utf-8');
    const rp = await createRobinPath();
    const startTime = FLAG_VERBOSE ? performance.now() : 0;

    try {
        const ast = await rp.getAST(script);
        if (FLAG_VERBOSE) {
            const elapsed = (performance.now() - startTime).toFixed(1);
            logVerbose(`Parsed in ${elapsed}ms, ${ast.length} top-level nodes`);
        }
        console.log(compact ? JSON.stringify(ast) : JSON.stringify(ast, null, 2));
    } catch (error) {
        displayError(error, script);
        process.exit(2);
    }
}

/**
 * robinpath fmt <file|dir> — Code formatter
 */
async function handleFmt(args) {
    const writeInPlace = args.includes('--write') || args.includes('-w');
    const checkOnly = args.includes('--check');
    const diffMode = args.includes('--diff');
    const fileArg = args.find(a => !a.startsWith('-'));

    if (!fileArg) {
        console.error(color.red('Error:') + ' fmt requires a file or directory argument');
        console.error('Usage: robinpath fmt <file|dir> [--write] [--check] [--diff]');
        process.exit(2);
    }

    // Collect files to format
    const files = collectRPFiles(fileArg);
    if (files.length === 0) {
        console.error(color.red('Error:') + ` No .rp or .robin files found: ${fileArg}`);
        process.exit(2);
    }

    let hasUnformatted = false;

    for (const filePath of files) {
        const script = readFileSync(filePath, 'utf-8');
        const startTime = FLAG_VERBOSE ? performance.now() : 0;

        try {
            const formatted = await formatScript(script);
            if (FLAG_VERBOSE) {
                const elapsed = (performance.now() - startTime).toFixed(1);
                logVerbose(`Formatted ${relative(process.cwd(), filePath)} in ${elapsed}ms`);
            }

            if (checkOnly) {
                if (formatted !== script) {
                    console.error(relative(process.cwd(), filePath) + ' — ' + color.red('not formatted'));
                    hasUnformatted = true;
                } else {
                    log(relative(process.cwd(), filePath) + ' — ' + color.green('OK'));
                }
            } else if (diffMode) {
                if (formatted !== script) {
                    const relPath = relative(process.cwd(), filePath);
                    console.log(simpleDiff(relPath, script, formatted));
                    hasUnformatted = true;
                }
            } else if (writeInPlace) {
                if (formatted !== script) {
                    writeFileSync(filePath, formatted, 'utf-8');
                    log(color.green('formatted') + ' ' + relative(process.cwd(), filePath));
                } else {
                    log(color.dim('unchanged') + ' ' + relative(process.cwd(), filePath));
                }
            } else {
                // Print to stdout
                process.stdout.write(formatted);
            }
        } catch (error) {
            console.error(color.red('Error') + ` formatting ${relative(process.cwd(), filePath)}: ${error.message}`);
            hasUnformatted = true;
        }
    }

    if ((checkOnly || diffMode) && hasUnformatted) {
        process.exit(1);
    }
}

/**
 * Simple unified diff output (no external dependency)
 */
function simpleDiff(filePath, original, formatted) {
    const origLines = original.split('\n');
    const fmtLines = formatted.split('\n');
    const lines = [`--- ${filePath}`, `+++ ${filePath} (formatted)`];

    let i = 0, j = 0;
    while (i < origLines.length || j < fmtLines.length) {
        if (i < origLines.length && j < fmtLines.length && origLines[i] === fmtLines[j]) {
            i++; j++;
            continue;
        }
        // Find the changed region
        const startI = i, startJ = j;
        // Simple: advance both until they match again or end
        let matchFound = false;
        for (let look = 1; look < 10 && !matchFound; look++) {
            // Check if original[i+look] matches formatted[j]
            if (i + look < origLines.length && j < fmtLines.length && origLines[i + look] === fmtLines[j]) {
                matchFound = true; break;
            }
            // Check if original[i] matches formatted[j+look]
            if (j + look < fmtLines.length && i < origLines.length && origLines[i] === fmtLines[j + look]) {
                matchFound = true; break;
            }
        }
        if (!matchFound) {
            // Emit one line from each
            if (i < origLines.length) lines.push(color.red(`- ${origLines[i]}`));
            if (j < fmtLines.length) lines.push(color.green(`+ ${fmtLines[j]}`));
            i++; j++;
        } else {
            // Emit removed lines until match
            while (i < origLines.length && (j >= fmtLines.length || origLines[i] !== fmtLines[j])) {
                lines.push(color.red(`- ${origLines[i]}`));
                i++;
            }
            // Emit added lines until match
            while (j < fmtLines.length && (i >= origLines.length || origLines[i] !== fmtLines[j])) {
                lines.push(color.green(`+ ${fmtLines[j]}`));
                j++;
            }
        }
    }

    return lines.join('\n');
}

/**
 * Format a RobinPath script to canonical style (normalized, no flavor preservation)
 */
async function formatScript(script) {
    const parser = new Parser(script);
    const statements = await parser.parse();

    // Create a dummy LineIndex (no original script = forces normalization)
    const dummyLineIndex = new LineIndexImpl('');

    const ctx = {
        indentLevel: 0,
        lineIndex: dummyLineIndex,
        // No originalScript = forces normalized output
    };

    // Strip flavor/preservation flags so Printer uses canonical forms
    const normalized = statements.map(s => stripFlavorFlags(s));

    const parts = [];
    for (let i = 0; i < normalized.length; i++) {
        const code = Printer.printNode(normalized[i], ctx);
        if (i > 0 && code.trim()) {
            // For normalized output, add blank line between blocks and other statements
            const prevType = normalized[i - 1].type;
            const currType = normalized[i].type;
            const blockTypes = ['ifBlock', 'define', 'do', 'together', 'forLoop', 'onBlock', 'cell'];
            if (blockTypes.includes(prevType) || blockTypes.includes(currType)) {
                parts.push('\n');
            }
        }
        parts.push(code);
    }

    let result = parts.join('');
    // Ensure single trailing newline
    result = result.replace(/\n*$/, '\n');
    return result;
}

/**
 * Recursively strip flavor-preservation flags from AST nodes
 * so the Printer outputs canonical/normalized form.
 */
function stripFlavorFlags(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => stripFlavorFlags(n));

    const clone = { ...node };

    // Assignment: force canonical $x = value form
    if (clone.type === 'assignment') {
        delete clone.isSet;
        delete clone.hasAs;
        delete clone.isImplicit;
    }

    // If block: remove hasThen (for elseif branches)
    if (clone.type === 'ifBlock') {
        delete clone.hasThen;
        if (clone.thenBranch) clone.thenBranch = clone.thenBranch.map(s => stripFlavorFlags(s));
        if (clone.elseBranch) clone.elseBranch = clone.elseBranch.map(s => stripFlavorFlags(s));
        if (clone.elseifBranches) {
            clone.elseifBranches = clone.elseifBranches.map(b => ({
                ...b,
                hasThen: undefined,
                body: b.body ? b.body.map(s => stripFlavorFlags(s)) : b.body,
            }));
        }
    }

    // Command: remove module prefix tracking (force full qualified names)
    if (clone.type === 'command') {
        delete clone.modulePrefix;
    }

    // Strip codePos so Printer doesn't try to extract original code
    delete clone.codePos;
    delete clone.bodyPos;
    delete clone.openPos;
    delete clone.closePos;
    delete clone.headerPos;
    delete clone.keywordPos;
    delete clone.elseKeywordPos;

    // Recurse into body arrays
    if (clone.body && Array.isArray(clone.body)) {
        clone.body = clone.body.map(s => stripFlavorFlags(s));
    }
    if (clone.command && typeof clone.command === 'object') {
        clone.command = stripFlavorFlags(clone.command);
    }

    return clone;
}

/**
 * Collect .rp and .robin files from a path (file or directory)
 */
function collectRPFiles(pathArg) {
    const fullPath = resolve(pathArg);

    if (!existsSync(fullPath)) {
        // Try resolving with extensions
        const resolved = resolveScriptPath(pathArg);
        if (resolved) return [resolved];
        return [];
    }

    const stat = statSync(fullPath);
    if (stat.isFile()) {
        return [fullPath];
    }

    if (stat.isDirectory()) {
        return collectRPFilesRecursive(fullPath);
    }

    return [];
}

function collectRPFilesRecursive(dir) {
    const results = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectRPFilesRecursive(fullPath));
        } else if (entry.endsWith('.rp') || entry.endsWith('.robin')) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * robinpath test [dir|file] — Test runner
 */
async function handleTest(args) {
    const jsonOutput = args.includes('--json');
    const targetArg = args.find(a => !a.startsWith('-'));
    const searchPath = targetArg || '.';

    // Collect test files
    let testFiles;
    const fullPath = resolve(searchPath);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        testFiles = [fullPath];
    } else {
        testFiles = collectTestFiles(searchPath);
    }

    if (testFiles.length === 0) {
        if (jsonOutput) {
            console.log(JSON.stringify({ passed: 0, failed: 0, total: 0, results: [] }));
        } else {
            log(color.yellow('No *.test.rp files found') + (targetArg ? ` in ${targetArg}` : ''));
        }
        process.exit(0);
    }

    let passed = 0;
    let failed = 0;
    const results = [];
    const startTime = performance.now();

    for (const filePath of testFiles) {
        const relPath = relative(process.cwd(), filePath);
        const script = readFileSync(filePath, 'utf-8');
        const rp = await createRobinPath();

        try {
            await rp.executeScript(script);
            passed++;
            results.push({ file: relPath, status: 'pass' });
            if (!jsonOutput) log(color.green('PASS') + '  ' + relPath);
        } catch (error) {
            failed++;
            results.push({ file: relPath, status: 'fail', error: error.message });
            if (!jsonOutput) {
                log(color.red('FAIL') + '  ' + relPath);
                let detail = '  ' + error.message;
                if (error.__formattedMessage) {
                    detail = '  ' + error.__formattedMessage.split('\n').join('\n  ');
                }
                log(color.dim(detail));
            }
        }
    }

    const total = passed + failed;
    const elapsed = (performance.now() - startTime).toFixed(0);

    if (jsonOutput) {
        console.log(JSON.stringify({ passed, failed, total, duration_ms: parseInt(elapsed), results }));
    } else {
        log('');
        const summary = `${total} test${total !== 1 ? 's' : ''}: ${passed} passed, ${failed} failed`;
        if (failed > 0) {
            log(color.red(summary) + color.dim(` (${elapsed}ms)`));
        } else {
            log(color.green(summary) + color.dim(` (${elapsed}ms)`));
        }
    }

    process.exit(failed > 0 ? 1 : 0);
}

/**
 * Collect *.test.rp files recursively
 */
function collectTestFiles(searchPath) {
    const fullPath = resolve(searchPath);
    if (!existsSync(fullPath)) {
        return [];
    }

    const stat = statSync(fullPath);
    if (!stat.isDirectory()) {
        if (fullPath.endsWith('.test.rp')) return [fullPath];
        return [];
    }

    return collectTestFilesRecursive(fullPath);
}

function collectTestFilesRecursive(dir) {
    const results = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectTestFilesRecursive(fullPath));
        } else if (entry.endsWith('.test.rp')) {
            results.push(fullPath);
        }
    }
    return results.sort();
}

/**
 * --watch flag: Re-run script on file changes
 */
async function handleWatch(filePath, script) {
    log(color.dim(`Watching ${relative(process.cwd(), filePath)} for changes...`));
    log('');

    // Initial run
    await runWatchIteration(filePath);

    let debounceTimer = null;
    watch(filePath, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            // Clear screen
            process.stdout.write('\x1b[2J\x1b[H');
            await runWatchIteration(filePath);
        }, 200);
    });
}

async function runWatchIteration(filePath) {
    const timestamp = new Date().toLocaleTimeString();
    log(color.dim(`[${timestamp}]`) + ` Running ${relative(process.cwd(), filePath)}`);
    log(color.dim('─'.repeat(50)));

    const script = readFileSync(filePath, 'utf-8');
    const rp = await createRobinPath();
    try {
        await rp.executeScript(script);
    } catch (error) {
        displayError(error, script);
    }
    log('');
    log(color.dim('Waiting for changes...'));
}

// ============================================================================
// AI Interactive Mode
// ============================================================================

const AI_CONFIG_PATH = join(homedir(), '.robinpath', 'ai.json');
const AI_SESSIONS_DIR = join(homedir(), '.robinpath', 'ai-sessions');
const AI_BRAIN_URL = process.env.ROBINPATH_AI_BRAIN_URL || 'https://ai-brain.robinpath.com';

// --- Session persistence ---
function getSessionPath(sessionId) {
    return join(AI_SESSIONS_DIR, `${sessionId}.json`);
}

function listSessions() {
    if (!existsSync(AI_SESSIONS_DIR)) return [];
    return readdirSync(AI_SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const data = JSON.parse(readFileSync(join(AI_SESSIONS_DIR, f), 'utf-8'));
                return { id: data.id, name: data.name, created: data.created, updated: data.updated, messages: data.messages?.length || 0 };
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
}

function saveSession(sessionId, name, messages, usage) {
    if (!existsSync(AI_SESSIONS_DIR)) mkdirSync(AI_SESSIONS_DIR, { recursive: true });
    const data = {
        id: sessionId,
        name,
        created: existsSync(getSessionPath(sessionId))
            ? JSON.parse(readFileSync(getSessionPath(sessionId), 'utf-8')).created
            : new Date().toISOString(),
        updated: new Date().toISOString(),
        messages: messages.slice(1), // skip system prompt
        usage,
    };
    writeFileSync(getSessionPath(sessionId), JSON.stringify(data, null, 2), 'utf-8');
}

function loadSession(sessionId) {
    const p = getSessionPath(sessionId);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function deleteSession(sessionId) {
    const p = getSessionPath(sessionId);
    if (existsSync(p)) { unlinkSync(p); return true; }
    return false;
}

// --- Persistent memory across sessions ---
const AI_MEMORY_PATH = join(homedir(), '.robinpath', 'memory.json');

function loadMemory() {
    try {
        if (existsSync(AI_MEMORY_PATH)) {
            return JSON.parse(readFileSync(AI_MEMORY_PATH, 'utf-8'));
        }
    } catch { /* ignore */ }
    return { facts: [], updatedAt: null };
}

function saveMemory(memory) {
    try {
        const dir = join(homedir(), '.robinpath');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        memory.updatedAt = new Date().toISOString();
        writeFileSync(AI_MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8');
    } catch { /* ignore */ }
}

function addMemoryFact(fact) {
    const memory = loadMemory();
    // Avoid duplicates
    const lower = fact.toLowerCase().trim();
    if (memory.facts.some(f => f.toLowerCase().trim() === lower)) return false;
    memory.facts.push(fact.trim());
    // Keep max 50 facts
    if (memory.facts.length > 50) memory.facts = memory.facts.slice(-50);
    saveMemory(memory);
    return true;
}

function removeMemoryFact(index) {
    const memory = loadMemory();
    if (index >= 0 && index < memory.facts.length) {
        const removed = memory.facts.splice(index, 1);
        saveMemory(memory);
        return removed[0];
    }
    return null;
}

function buildMemoryContext() {
    const memory = loadMemory();
    if (memory.facts.length === 0) return '';
    return '\n\n## User Memory (persistent across sessions)\n' +
        memory.facts.map(f => `- ${f}`).join('\n') + '\n';
}

/**
 * Extract <memory>...</memory> tags from an AI response.
 * The LLM decides what's worth remembering — no hardcoded patterns.
 * Returns the cleaned response (tags stripped) and any extracted facts.
 */
function extractMemoryTags(response) {
    const facts = [];
    const cleaned = response.replace(/<memory>([\s\S]*?)<\/memory>/gi, (_, fact) => {
        const trimmed = fact.trim();
        if (trimmed.length > 3 && trimmed.length < 300) facts.push(trimmed);
        return ''; // strip from displayed output
    }).replace(/\n{3,}/g, '\n\n').trim(); // clean up extra newlines left behind
    return { cleaned, facts };
}

// --- Auto-compaction: summarize old messages when conversation gets long ---

/** Approximate token count (1 token ≈ 4 chars). */
function estimateTokens(messages) {
    return messages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        return sum + Math.ceil(content.length / 4);
    }, 0);
}

/** Max tokens before auto-compaction triggers. */
const COMPACTION_THRESHOLD = 30000; // ~30k tokens
/** Keep this many recent messages intact after compaction. */
const KEEP_RECENT = 10;

/**
 * Auto-compact conversation if it exceeds the token threshold.
 * Summarizes older messages into a single compact message.
 * Uses the brain to generate the summary.
 */
async function autoCompact(conversationMessages) {
    const tokens = estimateTokens(conversationMessages);
    if (tokens < COMPACTION_THRESHOLD || conversationMessages.length <= KEEP_RECENT + 2) {
        return false; // No compaction needed
    }

    const systemMsg = conversationMessages[0];
    const oldMessages = conversationMessages.slice(1, -KEEP_RECENT);
    const recentMessages = conversationMessages.slice(-KEEP_RECENT);

    // Build summary request
    const summaryText = oldMessages
        .map(m => `${m.role}: ${(typeof m.content === 'string' ? m.content : '').slice(0, 500)}`)
        .join('\n');

    try {
        const response = await fetch(`${AI_BRAIN_URL}/docs/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `Summarize this conversation history in 3-5 bullet points. Focus on: user's name, what they asked for, key decisions made, and any code that was generated. Be concise.\n\n${summaryText}`,
                topK: 0,
                model: 'robinpath-default',
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) return false;

        const data = await response.json();
        const summary = data.code || '';
        if (!summary) return false;

        // Replace conversation with: system + summary + recent
        conversationMessages.length = 0;
        conversationMessages.push(systemMsg);
        conversationMessages.push({
            role: 'system',
            content: `[Conversation Summary — ${oldMessages.length} earlier messages compacted]\n${summary}`,
        });
        conversationMessages.push(...recentMessages);

        return true;
    } catch {
        return false; // Compaction failed, continue with full history
    }
}

// --- Token usage tracking ---
function createUsageTracker() {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
}

// Derive a machine-specific encryption key from hostname + username + fixed salt
function getAiEncryptionKey() {
    const material = `robinpath-ai-${hostname()}-${userInfo().username}-v1`;
    return createHash('sha256').update(material).digest();
}

function encryptApiKey(plaintext) {
    const key = getAiEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptApiKey(stored) {
    try {
        const key = getAiEncryptionKey();
        const [ivHex, tagHex, encrypted] = stored.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    } catch {
        return null;
    }
}

function readAiConfig() {
    try {
        if (!existsSync(AI_CONFIG_PATH)) return {};
        const raw = JSON.parse(readFileSync(AI_CONFIG_PATH, 'utf-8'));
        // Decrypt the API key if it's encrypted
        if (raw.apiKeyEncrypted) {
            const decrypted = decryptApiKey(raw.apiKeyEncrypted);
            if (decrypted) {
                raw.apiKey = decrypted;
            } else {
                raw.apiKey = null; // Decryption failed (different machine?)
            }
            delete raw.apiKeyEncrypted;
        }
        return raw;
    } catch {
        return {};
    }
}

function writeAiConfig(config) {
    const dir = getRobinPathHome();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Encrypt the API key before saving
    const toSave = { ...config };
    if (toSave.apiKey) {
        toSave.apiKeyEncrypted = encryptApiKey(toSave.apiKey);
        delete toSave.apiKey;
    }
    writeFileSync(AI_CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
    if (platform() !== 'win32') {
        try { chmodSync(AI_CONFIG_PATH, 0o600); } catch { /* ignore */ }
    }
}

async function handleAiConfig(args) {
    const sub = args[0];

    if (sub === 'set-key') {
        let key = args[1];
        if (!key) {
            // Interactive input — key won't appear in shell history or process list
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            key = await new Promise((resolve) => {
                // Disable echo for secure input
                if (process.stdin.isTTY) {
                    process.stdout.write('Enter your API key (OpenRouter, OpenAI, or Anthropic): ');
                    process.stdin.setRawMode(true);
                    let input = '';
                    const onData = (ch) => {
                        const c = ch.toString();
                        if (c === '\n' || c === '\r') {
                            process.stdin.setRawMode(false);
                            process.stdin.removeListener('data', onData);
                            process.stdout.write('\n');
                            rl.close();
                            resolve(input);
                        } else if (c === '\u0003') { // Ctrl+C
                            process.stdin.setRawMode(false);
                            process.exit(0);
                        } else if (c === '\u007f' || c === '\b') { // Backspace
                            if (input.length > 0) {
                                input = input.slice(0, -1);
                                process.stdout.write('\b \b');
                            }
                        } else {
                            input += c;
                            process.stdout.write('*');
                        }
                    };
                    process.stdin.on('data', onData);
                } else {
                    rl.question('Enter your API key (OpenRouter, OpenAI, or Anthropic): ', (answer) => {
                        rl.close();
                        resolve(answer.trim());
                    });
                }
            });
        }
        if (!key || !key.trim()) {
            console.error(color.red('Error:') + ' API key cannot be empty');
            process.exit(2);
        }
        const config = readAiConfig();
        config.apiKey = key.trim();
        // Auto-detect provider from key prefix
        const k = key.trim();
        if (k.startsWith('sk-or-')) config.provider = 'openrouter';
        else if (k.startsWith('sk-ant-')) config.provider = 'anthropic';
        else if (k.startsWith('sk-')) config.provider = 'openai';
        else if (!config.provider) config.provider = 'openrouter';
        if (!config.model) config.model = 'anthropic/claude-sonnet-4-20250514';
        writeAiConfig(config);
        log(color.green('API key saved.'));
        log(`Provider: ${color.cyan(config.provider)} (auto-detected)`);
        log(`Model: ${color.cyan(config.model)}`);
        log(`\nStart chatting with: ${color.cyan('robinpath ai')}`);
    } else if (sub === 'set-model') {
        const model = args[1];
        if (!model) {
            console.error(color.red('Error:') + ' Usage: robinpath ai config set-model <model-id>');
            console.error('\nExamples:');
            console.error('  anthropic/claude-sonnet-4-20250514');
            console.error('  openai/gpt-4o');
            console.error('  google/gemini-2.5-pro');
            console.error('  deepseek/deepseek-chat');
            process.exit(2);
        }
        const config = readAiConfig();
        config.model = model;
        writeAiConfig(config);
        log(color.green('Model set:') + ` ${color.cyan(model)}`);
    } else if (sub === 'show') {
        const config = readAiConfig();
        log('');
        log(color.bold('  AI Configuration:'));
        log(color.dim('  ' + '\u2500'.repeat(40)));
        if (!config.apiKey) {
            log(`  Provider:  ${color.cyan('gemini')} (free, no key needed)`);
            log(`  Model:     ${color.cyan('gemini-2.0-flash')}`);
            log(`  API Key:   ${color.dim('(none — using free tier)')}`);
            log('');
            log(color.dim('  Optional: set a key for premium models:'));
            log(color.dim(`  ${color.cyan('robinpath ai config set-key <api-key>')}`));
        } else {
            log(`  Provider:  ${color.cyan(config.provider || 'openrouter')}`);
            log(`  Model:     ${color.cyan(config.model || 'anthropic/claude-sonnet-4-20250514')}`);
            const masked = config.apiKey.length > 8
                ? config.apiKey.slice(0, 5) + '\u2022'.repeat(Math.min(config.apiKey.length - 8, 20)) + config.apiKey.slice(-3)
                : '\u2022\u2022\u2022\u2022';
            log(`  API Key:   ${color.dim(masked)}`);
        }
        log('');
    } else if (sub === 'remove') {
        if (existsSync(AI_CONFIG_PATH)) {
            unlinkSync(AI_CONFIG_PATH);
            log(color.green('AI configuration removed.'));
        } else {
            log('No AI configuration found.');
        }
    } else {
        console.error(color.red('Error:') + ' Usage: robinpath ai config <set-key|set-model|show|remove>');
        console.error('');
        console.error('  robinpath ai config set-key <key>          Set API key (optional, free tier works without)');
        console.error('  robinpath ai config set-model <model>     Set model (e.g. openai/gpt-4o)');
        console.error('  robinpath ai config show                  Show current configuration');
        console.error('  robinpath ai config remove                Remove configuration');
        process.exit(2);
    }
}

// Shell command execution — like Claude Code, AI generates shell commands and CLI executes them
function getShellConfig() {
    const p = platform();
    if (p === 'win32') {
        // Prefer Git Bash on Windows, fall back to cmd
        const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
        if (existsSync(gitBash)) {
            return { shell: gitBash, name: 'bash', isUnix: true };
        }
        return { shell: 'cmd.exe', name: 'cmd', isUnix: false };
    }
    // macOS / Linux — use user's shell or default to bash
    const userShell = process.env.SHELL || '/bin/bash';
    return { shell: userShell, name: basename(userShell), isUnix: true };
}

function executeShellCommand(command, timeout = 30000) {
    const { shell, name: shellName, isUnix } = getShellConfig();
    try {
        const args = isUnix ? ['-c', command] : ['/c', command];
        const result = execSync(command, {
            shell,
            cwd: process.cwd(),
            timeout,
            maxBuffer: 1024 * 1024,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, LANG: 'en_US.UTF-8' },
        });
        return { stdout: (result || '').slice(0, 50000), exitCode: 0 };
    } catch (e) {
        return {
            stdout: (e.stdout || '').slice(0, 50000),
            stderr: (e.stderr || '').slice(0, 10000),
            exitCode: e.status || 1,
            error: e.message.slice(0, 500),
        };
    }
}

// Extract <cmd>...</cmd> blocks from AI response text
function extractCommands(text) {
    const commands = [];
    const regex = /<cmd>([\s\S]*?)<\/cmd>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const cmd = match[1].trim();
        if (cmd) commands.push(cmd);
    }
    return commands;
}

// Strip <cmd> tags from displayed text (they're invisible to user)
function stripCommandTags(text) {
    return text.replace(/<cmd>[\s\S]*?<\/cmd>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildRobinPathSystemPrompt() {
    // Load installed (external) module info
    const manifest = readModulesManifest();
    const installedModuleNames = Object.keys(manifest);
    const installedInfo = installedModuleNames.map(name => {
        const mInfo = manifest[name];
        let desc = '';
        try {
            const pkgPath = join(getModulePath(name), 'package.json');
            if (existsSync(pkgPath)) {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                desc = pkg.description || '';
            }
        } catch { /* ignore */ }
        return `  ${name}@${mInfo.version}${desc ? ' \u2014 ' + desc : ''}`;
    }).join('\n');

    // Load native module info for context
    const moduleInfo = nativeModules.map(m => {
        const fns = Object.keys(m.functions);
        const desc = m.moduleMetadata?.description || '';
        // Include parameter info if available
        const fnDetails = fns.map(fn => {
            const meta = m.functionMetadata?.[fn];
            if (meta?.params?.length) {
                const params = meta.params.map(p => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ');
                return `  ${fn}(${params})`;
            }
            return `  ${fn}`;
        }).join('\n');
        return `${m.name} \u2014 ${desc}\n${fnDetails}`;
    }).join('\n\n');

    return `You are RobinPath AI, an intelligent assistant built into the RobinPath CLI.
You help users write, understand, debug, and modify RobinPath code.

## CLI Commands Reference

\`\`\`
robinpath run <file.rp>       Run a .rp or .robin script
robinpath <file.rp>           Shorthand: run a script directly
robinpath repl                Start the language REPL
robinpath add <pkg>           Install a module (e.g. robinpath add @robinpath/slack)
robinpath remove <pkg>        Uninstall a module
robinpath modules list        List installed modules
robinpath modules upgrade     Upgrade all installed modules to latest
robinpath search <query>      Search the module registry
robinpath info                Show system/environment info
robinpath info --json         Machine-readable system info
robinpath init                Create a new robinpath.json project file
robinpath publish             Publish your module to the registry
robinpath audit               Check installed modules for issues
robinpath doctor              Diagnose CLI installation issues
robinpath start               Start an HTTP server (robinpath start -p 8080)
robinpath test <file>         Run test files
robinpath env set KEY=VALUE   Set a persistent environment variable
robinpath env list            List environment variables
robinpath ai config set-key   Set OpenRouter API key
robinpath ai config set-model Set AI model
robinpath ai config show      Show AI configuration
robinpath -p "question"       Headless AI prompt (for scripting/app integration)
\`\`\`

File extensions: \`.rp\` and \`.robin\` are both recognized.

## About RobinPath
- RobinPath is a scripting language and CLI for automation, APIs, and data processing
- Scripts run on Node.js — all scripts run server-side, NOT in the browser
- RobinPath is synchronous by default but async operations (fetch, timers) are supported
- Cannot use npm packages directly — use RobinPath modules from the registry
- There is no hard file size limit — limited by available system memory
- No TypeScript support — RobinPath is its own language with .rp/.robin files

## RobinPath Language Syntax

RobinPath is a scripting language for automation and data processing.

\`\`\`
# Variables
set $x = 1
$name = "Robin"

# Output
log "Hello " + $name

# Module function calls
set $result = math.add 1 2
set $upper = string.upper "hello"

# If/else
if $x > 5
  log "big"
else
  log "small"
endif

# For loops
for $item in array.create 1 2 3
  log $item
endfor

# Looping with do block
set $i = 0
do
  log $i
  $i = math.add $i 1
enddo

# Functions
def greet $name
  log "Hello " + $name
enddef

# Using functions
greet "World"

# External modules (auto-loaded when installed, no import needed)
# Install with: robinpath add @robinpath/slack
slack.send "#general" "Hello from RobinPath!"

# Error handling (do/catch)
do
  set $data = file.read "missing.txt"
catch $err
  log "Error: " + $err
enddo

# Events
on "myEvent" $data
  log "Received: " + $data
endon
emit "myEvent" "hello"

# Pipe operator
set $result = "hello world" |> string.upper |> string.split " "

# String interpolation
log "Result: {$result}"

# Comments
# This is a comment
\`\`\`

## File Extensions
.rp and .robin are both recognized.

## Available Native Modules

${moduleInfo}

## External Modules
Users can install modules from the registry:
  robinpath add @robinpath/slack
  robinpath add @robinpath/csv

Then import and use:
  import "@robinpath/slack"
  slack.send "#channel" "message"

## Installed External Modules
${installedModuleNames.length > 0 ? `The user has ${installedModuleNames.length} external module(s) installed locally:\n${installedInfo}` : 'The user has no external modules installed yet.'}

IMPORTANT: If the user asks about a module that is NOT in the native modules list above AND NOT in the installed list, they need to install it first. Tell them:
  robinpath add @robinpath/<module-name>
For example, if they ask about Slack but @robinpath/slack is not installed, say:
  "First install it: robinpath add @robinpath/slack"

## Your Capabilities — Shell Commands
You can execute shell commands on the user's machine to perform file operations, run scripts, and explore the filesystem.
To execute a command, wrap it in <cmd> tags in your response:

<cmd>cat myfile.txt</cmd>         — read a file
<cmd>ls -la</cmd>                  — list files
<cmd>echo 'content' > file.txt</cmd>  — create/write a file
<cmd>mkdir -p mydir</cmd>         — create directories
<cmd>cat file.txt | sed 's/old/new/g' > file.tmp && mv file.tmp file.txt</cmd>  — edit a file
<cmd>rm file.txt</cmd>            — delete a file
<cmd>robinpath run script.rp</cmd> — run a RobinPath script

The commands are executed in the system shell (${getShellConfig().name} on ${platform()}).
You can use multiple <cmd> tags in a single response — they execute sequentially.
After execution, you receive the output (stdout/stderr) and can use it to continue.

### Writing files with heredoc
To create files with multi-line content:
<cmd>cat << 'RPEOF' > myfile.rp
@desc "My script"
do
  log "Hello!"
enddo
RPEOF</cmd>

### Editing files with sed
For simple replacements:
<cmd>sed -i 's/old text/new text/g' myfile.rp</cmd>

For multi-line edits, read the file first, then write the modified version.

## User Environment
- Working directory: ${process.cwd()}
- Platform: ${platform()}
- Shell: ${getShellConfig().name}
- RobinPath CLI version: ${CLI_VERSION}

## Guidelines
- When asked to create code, write idiomatic RobinPath using the available modules
- When modifying files, always read them first (cat) to understand the current content
- Show diffs or explain what you changed
- Keep responses concise and focused
- When showing code, use \`\`\`robinpath code blocks
- If the user asks something unrelated to RobinPath, you can still help but focus on being useful
- If the user needs a module that is not installed, tell them to install it with: robinpath add @robinpath/<name>
- Never assume a module is available if it's not in the native or installed modules list
- Run code when appropriate to verify it works
- IMPORTANT: Only use <cmd> tags when you need to actually execute a command. Do NOT use <cmd> tags in examples or explanations — use regular code blocks instead.

## Persistent Memory
You can save important facts about the user across sessions using memory tags.
When the user shares something worth remembering (their name, preferences, project details, workflow habits, corrections, explicit "remember this" requests), wrap the fact in a <memory> tag in your response. Examples:

User: "my name is Alex"
Response: Nice to meet you, Alex! <memory>User's name is Alex</memory>

User: "I always use tabs not spaces"
Response: Got it, I'll use tabs. <memory>User prefers tabs over spaces</memory>

User: "remember that our API runs on port 3001"
Response: Noted! <memory>Project API runs on port 3001</memory>

User: "I work at Acme Corp"
Response: Cool! <memory>User works at Acme Corp</memory>

Rules:
- Only save facts that are genuinely useful across future sessions
- Keep each memory short and factual (under 200 chars)
- Don't save temporary things like "user asked about X" — save lasting preferences, identity, project info
- If the user corrects a previous fact, save the correction (it replaces the old one)
- Don't mention the <memory> tag to the user — it's invisible to them
- Most messages need NO memory tags — only use them when something is clearly worth persisting`;
}

// Spinner animation for "thinking" state
function createSpinner(text) {
    const frames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
    let i = 0;
    const interval = setInterval(() => {
        process.stdout.write(`\r${color.cyan(frames[i % frames.length])} ${color.dim(text)}`);
        i++;
    }, 80);
    return {
        stop(clearLine = true) {
            clearInterval(interval);
            if (clearLine) process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
        },
    };
}

// Format AI response with basic markdown rendering
function formatAiResponse(text) {
    const lines = text.split('\n');
    let inCodeBlock = false;
    const formatted = [];

    for (const line of lines) {
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            if (inCodeBlock) {
                formatted.push(color.dim('\u2500'.repeat(Math.min(process.stdout.columns || 60, 60))));
            } else {
                formatted.push(color.dim('\u2500'.repeat(Math.min(process.stdout.columns || 60, 60))));
            }
            continue;
        }

        if (inCodeBlock) {
            formatted.push('  ' + color.cyan(line));
            continue;
        }

        // Bold: **text**
        let formatted_line = line.replace(/\*\*(.+?)\*\*/g, (_, t) => color.bold(t));
        // Inline code: `text`
        formatted_line = formatted_line.replace(/`([^`]+)`/g, (_, t) => color.cyan(t));
        // Headers
        if (formatted_line.startsWith('## ')) {
            formatted_line = '\n' + color.bold(formatted_line.slice(3));
        } else if (formatted_line.startsWith('# ')) {
            formatted_line = '\n' + color.bold(formatted_line.slice(2));
        }
        // Bullet points
        if (formatted_line.startsWith('- ')) {
            formatted_line = '  \u2022 ' + formatted_line.slice(2);
        }

        formatted.push(formatted_line);
    }

    return formatted.join('\n');
}

/**
 * Fetch RAG context from the AI brain for a given prompt.
 * Returns relevant module docs and examples to inject into the system prompt.
 * Falls back gracefully if the brain is unreachable.
 */
async function fetchBrainContext(prompt) {
    try {
        const response = await fetch(`${AI_BRAIN_URL}/docs/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                topK: 10,
                model: 'robinpath-default',
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            logVerbose('Brain returned', response.status);
            return null;
        }

        const data = await response.json();
        return {
            code: data.code || '',
            sources: data.sources || [],
            context: data.context || {},
        };
    } catch (err) {
        logVerbose('Brain unreachable:', err.message);
        return null;
    }
}

/**
 * Stream brain response via SSE — prints tokens as they arrive.
 * Returns the full accumulated text when done.
 */
async function fetchBrainStream(prompt, { onToken, conversationHistory, provider, model, apiKey, cliContext } = {}) {
    try {
        const body = {
            prompt,
            topK: 10,
            model: model || 'robinpath-default',
            stream: true,
        };
        if (provider) body.provider = provider;
        if (apiKey) body.apiKey = apiKey;
        if (cliContext) body.cliContext = cliContext;
        if (conversationHistory && conversationHistory.length > 0) {
            body.conversationHistory = conversationHistory;
        }
        const response = await fetch(`${AI_BRAIN_URL}/docs/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
            logVerbose('Brain stream returned', response.status);
            return null;
        }

        let fullText = '';
        let metadata = null;
        let doneData = null;

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events (separated by double newlines)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep incomplete last chunk

            for (const event of events) {
                if (!event.trim()) continue;

                let eventType = '';
                let eventData = '';
                for (const line of event.split('\n')) {
                    if (line.startsWith('event: ')) eventType = line.slice(7);
                    else if (line.startsWith('data: ')) eventData = line.slice(6);
                }

                if (!eventType || !eventData) continue;

                try {
                    const parsed = JSON.parse(eventData);

                    if (eventType === 'metadata') {
                        metadata = parsed;
                    } else if (eventType === 'text_delta' || eventType === 'retry_delta') {
                        const delta = parsed.delta || '';
                        fullText += delta;
                        if (onToken) onToken(delta);
                    } else if (eventType === 'validation') {
                        if (parsed.retrying) {
                            // Clear the bad output from screen: move cursor up and erase each line
                            const lines = fullText.split('\n').length;
                            for (let i = 0; i < lines; i++) {
                                process.stdout.write('\x1b[2K\x1b[1A'); // erase line + move up
                            }
                            process.stdout.write('\x1b[2K\r'); // erase current line
                            fullText = ''; // Reset — retry will replace
                            if (onToken) {
                                // Signal the caller to reset any internal buffers too
                                onToken('\x1b[RETRY]');
                            }
                        }
                    } else if (eventType === 'done') {
                        doneData = parsed;
                    } else if (eventType === 'error') {
                        logVerbose('Brain stream error:', parsed.message);
                    }
                } catch {
                    // Skip malformed JSON
                }
            }
        }

        return {
            code: fullText,
            sources: metadata?.sources || [],
            context: metadata?.context || {},
            validation: doneData?.validation || null,
            usage: doneData?.usage || null,
        };
    } catch (err) {
        logVerbose('Brain stream unreachable:', err.message);
        return null;
    }
}

// ============================================================================
// Smart Context Builder — gathers local + brain context before AI calls
// ============================================================================

/**
 * Resolve which modules a prompt needs via the brain's vector search.
 * Returns module names, functions, and relevance scores.
 * Fast — no LLM call, just embedding + vector similarity.
 */
async function resolveBrainModules(prompt) {
    try {
        const response = await fetch(`${AI_BRAIN_URL}/docs/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, topK: 10 }),
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            logVerbose('Brain resolve returned', response.status);
            return null;
        }

        const data = await response.json();
        return data.modules || [];
    } catch (err) {
        logVerbose('Brain resolve unreachable:', err.message);
        return null;
    }
}

/**
 * Build local context from the user's environment:
 * - Installed modules (names + versions)
 * - Native modules (names only)
 * - Current working directory
 * - Project config (robinpath.json)
 * - Relevant local files (.rp scripts, data files)
 * - Environment variable names (not values)
 */
function buildLocalContext() {
    const cwd = process.cwd();
    const ctx = {
        cwd,
        platform: platform(),
        cliVersion: CLI_VERSION,
        installedModules: [],
        nativeModuleNames: [],
        projectConfig: null,
        localFiles: [],
        envVarNames: [],
    };

    // Installed modules
    const manifest = readModulesManifest();
    ctx.installedModules = Object.entries(manifest).map(([name, info]) => ({
        name,
        version: info.version,
    }));

    // Native modules (just names)
    ctx.nativeModuleNames = nativeModules.map(m => m.name);

    // Project config
    try {
        const projectPath = join(cwd, 'robinpath.json');
        if (existsSync(projectPath)) {
            ctx.projectConfig = JSON.parse(readFileSync(projectPath, 'utf-8'));
        }
    } catch { /* ignore */ }

    // Relevant local files (scripts + data, max 20)
    try {
        const entries = readdirSync(cwd, { withFileTypes: true });
        const relevant = [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const ext = entry.name.split('.').pop()?.toLowerCase();
                if (['rp', 'robin', 'csv', 'json', 'txt', 'sql', 'db'].includes(ext)) {
                    try {
                        const st = statSync(join(cwd, entry.name));
                        relevant.push({ name: entry.name, size: st.size });
                    } catch { /* ignore */ }
                }
            }
        }
        ctx.localFiles = relevant.slice(0, 20);
    } catch { /* ignore */ }

    // Environment variable names (from robinpath env, not values)
    try {
        const envPath = join(getRobinPathHome(), 'env');
        if (existsSync(envPath)) {
            const lines = readFileSync(envPath, 'utf-8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    ctx.envVarNames.push(trimmed.slice(0, eqIdx));
                }
            }
        }
    } catch { /* ignore */ }

    return ctx;
}

/**
 * Build an enriched prompt that combines:
 * 1. Brain's module resolution (what modules match the prompt)
 * 2. Local context (what's installed, project files, env)
 * 3. The original user prompt
 *
 * This is what gets sent to the LLM — focused, relevant context only.
 */
async function buildEnrichedPrompt(prompt) {
    const [resolved, local] = await Promise.all([
        resolveBrainModules(prompt),
        Promise.resolve(buildLocalContext()),
    ]);

    const installedNames = new Set([
        ...local.installedModules.map(m => m.name.replace(/^@robinpath\//, '')),
        ...local.nativeModuleNames,
    ]);

    // Modules that overlap with built-in language features (not external deps)
    // Populated dynamically from native module list + core language keywords
    const coreOverlaps = new Set(local.nativeModuleNames);
    for (const mod of nativeModules) {
        // Any native function that shares a name with a resolved module
        for (const fn of Object.keys(mod.functions || {})) {
            coreOverlaps.add(fn);
        }
    }

    const sections = [];

    // Section 1: Module availability
    if (resolved && resolved.length > 0) {
        // Filter: score > 0.76, and exclude modules that overlap with core language features
        const relevant = resolved.filter(m => m.score > 0.76 && !coreOverlaps.has(m.name));
        if (relevant.length > 0) {
            const moduleLines = relevant.map(m => {
                const shortName = m.name;
                const fullName = `@robinpath/${shortName}`;
                const isInstalled = installedNames.has(shortName);
                const fns = m.functions.length > 0 ? m.functions.join(', ') : 'see docs';
                const desc = m.description ? ` — ${m.description}` : '';
                return `  ${fullName} [${isInstalled ? '+' : '-'}]${desc}\n    ${fns}`;
            });
            sections.push(`Modules:\n${moduleLines.join('\n')}`);
        }

        // Collect missing modules
        const missing = relevant
            .filter(m => !installedNames.has(m.name))
            .map(m => `@robinpath/${m.name}`);
        if (missing.length > 0) {
            sections.push(`Not installed: ${missing.join(', ')}`);
        }
    }

    // Section 2: Installed modules
    if (local.installedModules.length > 0) {
        sections.push(`Installed: ${local.installedModules.map(m => m.name).join(', ')}`);
    }

    // Section 3: Local files
    if (local.localFiles.length > 0) {
        sections.push(`Files: ${local.localFiles.map(f => `${f.name} (${formatFileSize(f.size)})`).join(', ')}`);
    }

    // Section 4: Environment variables
    if (local.envVarNames.length > 0) {
        sections.push(`Env: ${local.envVarNames.join(', ')}`);
    }

    // Section 5: Project
    if (local.projectConfig?.name) {
        sections.push(`Project: ${local.projectConfig.name}`);
    }

    // Build the enriched prompt
    const contextBlock = sections.length > 0
        ? `[Context]\n${sections.join('\n\n')}\n[/Context]\n\n`
        : '';

    return {
        enrichedPrompt: `${contextBlock}${prompt}`,
        resolved,
        local,
        missingModules: resolved
            ? resolved.filter(m => m.score > 0.76 && !installedNames.has(m.name) && !coreOverlaps.has(m.name)).map(m => `@robinpath/${m.name}`)
            : [],
    };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// (OpenRouter direct calls removed — Brain handles all LLM calls server-side)

async function startAiREPL(initialPrompt, resumeSessionId) {
    const config = readAiConfig();

    // Resolve provider from API key prefix (if key is set)
    const resolveProvider = (key) => {
        if (!key) return 'gemini';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return config.provider || 'gemini';
    };

    const apiKey = config.apiKey || null;
    const provider = resolveProvider(apiKey);
    const model = apiKey ? (config.model || 'anthropic/claude-sonnet-4-20250514') : 'robinpath-default';
    const modelShort = model === 'robinpath-default' ? 'gemini-2.0-flash (free)' : (model.includes('/') ? model.split('/').pop() : model);

    // Build CLI context to send to brain
    const cliContext = {
        platform: platform(),
        shell: getShellConfig().name,
        cwd: process.cwd(),
        cliVersion: CLI_VERSION,
        nativeModules: nativeModules.map(m => m.name),
        installedModules: Object.keys(readModulesManifest()),
    };

    // Session management
    let sessionId = resumeSessionId || randomUUID().slice(0, 8);
    let sessionName = `session-${new Date().toISOString().slice(0, 10)}`;

    // Token usage tracking
    const usage = createUsageTracker();

    // Conversation messages — no system prompt needed, brain handles it server-side
    const conversationMessages = [];

    // Inject memory context as first user context if available
    const memContext = buildMemoryContext();
    if (memContext.trim()) {
        conversationMessages.push({ role: 'user', content: `[Context] ${memContext.trim()}` });
        conversationMessages.push({ role: 'assistant', content: 'Got it, I have your preferences loaded.' });
    }

    // Resume existing session
    if (resumeSessionId) {
        const session = loadSession(resumeSessionId);
        if (session) {
            sessionName = session.name;
            // Restore conversation messages
            for (const msg of session.messages) {
                conversationMessages.push(msg);
            }
            if (session.usage) {
                usage.promptTokens = session.usage.promptTokens || 0;
                usage.completionTokens = session.usage.completionTokens || 0;
                usage.totalTokens = session.usage.totalTokens || 0;
                usage.requests = session.usage.requests || 0;
            }
            log('');
            log(color.green(`  Resumed session: ${color.bold(sessionName)}`));
            log(color.dim(`  ${session.messages.length} messages restored, ${usage.requests} prior requests`));
        } else {
            log(color.red(`  Session '${resumeSessionId}' not found.`));
        }
    }

    // Welcome banner
    log('');
    log(color.dim('  \u256d' + '\u2500'.repeat(50) + '\u256e'));
    log(color.dim('  \u2502') + color.bold('  RobinPath AI') + ' '.repeat(36) + color.dim('\u2502'));
    log(color.dim('  \u2502') + `  Model: ${color.cyan(modelShort)}` + ' '.repeat(Math.max(0, 41 - modelShort.length)) + color.dim('\u2502'));
    log(color.dim('  \u2502') + `  Type ${color.dim('exit')} to quit, ${color.dim('/help')} for commands` + ' '.repeat(12) + color.dim('\u2502'));
    log(color.dim('  \u2570' + '\u2500'.repeat(50) + '\u256f'));
    log('');

    const history = [];
    try {
        const histPath = join(getRobinPathHome(), 'ai-history');
        if (existsSync(histPath)) {
            const lines = readFileSync(histPath, 'utf-8').split('\n').filter(Boolean);
            history.push(...lines.slice(-500));
        }
    } catch { /* ignore */ }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: color.cyan('> '),
        history,
        historySize: 500,
    });

    function saveHistory(line) {
        try {
            const histPath = join(getRobinPathHome(), 'ai-history');
            appendFileSync(histPath, line + '\n', 'utf-8');
        } catch { /* ignore */ }
    }

    // If initial prompt was provided (rp ai "question"), simulate input
    if (initialPrompt) {
        setTimeout(() => rl.write(initialPrompt + '\n'), 50);
    }

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit') {
            log(color.dim('\nGoodbye!'));
            process.exit(0);
        }

        if (trimmed === '/help') {
            log('');
            log(color.bold('  Commands:'));
            log(color.dim('  ── Conversation ──'));
            log('  /clear         Clear conversation history');
            log('  /compact       Trim conversation to last 10 messages');
            log(color.dim('  ── Sessions ──'));
            log('  /save [name]   Save current session');
            log('  /sessions      List saved sessions');
            log('  /resume <id>   Resume a saved session');
            log('  /delete <id>   Delete a saved session');
            log(color.dim('  ── Memory ──'));
            log('  /memory        Show persistent memory');
            log('  /remember <x>  Save a fact across sessions');
            log('  /forget <n>    Remove a memory by number');
            log(color.dim('  ── Info ──'));
            log('  /model         Show current model');
            log('  /model <id>    Switch model');
            log('  /tools         List available tools');
            log('  /modules       Show installed modules');
            log('  /context       Show what the AI knows about your setup');
            log('  /usage         Show token usage this session');
            log('  /scan          Scan project files for AI context');
            log(color.dim('  ──'));
            log('  exit           Exit AI mode');
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/clear') {
            conversationMessages.length = 1; // Keep system prompt
            log(color.green('Conversation cleared.'));
            rl.prompt();
            return;
        }

        if (trimmed === '/model') {
            log(`Current model: ${color.cyan(model)}`);
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/model ')) {
            const newModel = trimmed.slice(7).trim();
            config.model = newModel;
            writeAiConfig(config);
            log(color.green('Model changed:') + ` ${color.cyan(newModel)}`);
            log(color.dim('(takes effect on next message)'));
            rl.prompt();
            return;
        }

        if (trimmed === '/tools') {
            const { name: shellName } = getShellConfig();
            log('');
            log(color.bold('  Shell command execution:'));
            log(`  Shell: ${color.cyan(shellName)} on ${platform()}`);
            log('');
            log('  The AI executes shell commands to:');
            log(`  ${color.cyan('cat / head / tail')}     Read files`);
            log(`  ${color.cyan('echo > / cat <<')}      Create/write files`);
            log(`  ${color.cyan('sed -i')}               Edit files in-place`);
            log(`  ${color.cyan('ls / find')}             List/search files`);
            log(`  ${color.cyan('mkdir / rm / mv / cp')}  File operations`);
            log(`  ${color.cyan('robinpath run')}         Run .rp scripts`);
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/modules') {
            const mf = readModulesManifest();
            const names = Object.keys(mf);
            log('');
            log(color.bold(`  Native modules (${nativeModules.length}):`));
            log('  ' + nativeModules.map(m => color.cyan(m.name)).join(', '));
            log('');
            if (names.length > 0) {
                log(color.bold(`  Installed modules (${names.length}):`));
                for (const n of names) {
                    log(`  ${color.cyan(n)}@${color.dim(mf[n].version)}`);
                }
            } else {
                log(color.bold('  Installed modules:') + color.dim(' (none)'));
                log('  Install with: ' + color.cyan('robinpath add @robinpath/<name>'));
            }
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/context') {
            const mf = readModulesManifest();
            const installedNames = Object.keys(mf);
            const msgCount = conversationMessages.length - 1; // minus system prompt
            log('');
            log(color.bold('  AI Context:'));
            log(`  Model:              ${color.cyan(readAiConfig().model || model)}`);
            log(`  Working dir:        ${color.cyan(process.cwd())}`);
            log(`  Platform:           ${platform()}`);
            log(`  CLI version:        ${CLI_VERSION}`);
            log(`  Native modules:     ${nativeModules.length}`);
            log(`  Installed modules:  ${installedNames.length}${installedNames.length > 0 ? ' (' + installedNames.map(n => n.replace('@robinpath/', '')).join(', ') + ')' : ''}`);
            log(`  Conversation:       ${msgCount} message${msgCount !== 1 ? 's' : ''}`);
            log(`  Brain:              ${AI_BRAIN_URL}`);
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/compact') {
            const beforeCount = conversationMessages.length - 1;
            const beforeTokens = estimateTokens(conversationMessages);
            const compacted = await autoCompact(conversationMessages);
            if (compacted) {
                const afterCount = conversationMessages.length - 1;
                const afterTokens = estimateTokens(conversationMessages);
                log(color.green(`Compacted: ${beforeCount} messages (~${Math.round(beforeTokens/1000)}k tokens) → ${afterCount} messages (~${Math.round(afterTokens/1000)}k tokens)`));
            } else if (conversationMessages.length > 11) {
                // Fallback: simple truncation if brain is unreachable
                const system = conversationMessages[0];
                const recent = conversationMessages.slice(-10);
                conversationMessages.length = 0;
                conversationMessages.push(system, ...recent);
                log(color.green(`Trimmed to ${recent.length} recent messages.`));
            } else {
                log(color.dim('Conversation is already short — nothing to compact.'));
            }
            rl.prompt();
            return;
        }

        // --- Memory commands ---
        if (trimmed === '/memory') {
            const memory = loadMemory();
            log('');
            if (memory.facts.length === 0) {
                log(color.dim('  No memories saved. Use /remember <fact> to save one.'));
            } else {
                log(color.bold('  Persistent Memory:'));
                memory.facts.forEach((f, i) => log(`  ${color.dim(String(i + 1) + '.')} ${f}`));
                log('');
                log(color.dim(`  ${memory.facts.length} facts — loaded into every conversation`));
            }
            log('');
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/remember ')) {
            const fact = trimmed.slice(10).trim();
            if (fact) {
                const added = addMemoryFact(fact);
                if (added) {
                    log(color.green(`Remembered: "${fact}"`));
                    // Also inject into current system prompt
                    conversationMessages[0].content = buildRobinPathSystemPrompt() + buildMemoryContext();
                } else {
                    log(color.dim('Already remembered.'));
                }
            }
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/forget ')) {
            const idx = parseInt(trimmed.slice(8).trim(), 10) - 1;
            const removed = removeMemoryFact(idx);
            if (removed) {
                log(color.green(`Forgot: "${removed}"`));
                conversationMessages[0].content = buildRobinPathSystemPrompt() + buildMemoryContext();
            } else {
                log(color.red('Invalid memory number. Use /memory to see the list.'));
            }
            rl.prompt();
            return;
        }

        // --- Session commands ---
        if (trimmed === '/save' || trimmed.startsWith('/save ')) {
            const customName = trimmed.slice(5).trim();
            if (customName) sessionName = customName;
            saveSession(sessionId, sessionName, conversationMessages, usage);
            log(color.green(`Session saved: ${color.bold(sessionName)} (${sessionId})`));
            log(color.dim(`  ${conversationMessages.length - 1} messages, ${usage.totalTokens} tokens`));
            rl.prompt();
            return;
        }

        if (trimmed === '/sessions') {
            const sessions = listSessions();
            log('');
            if (sessions.length === 0) {
                log(color.dim('  No saved sessions. Use /save to save the current conversation.'));
            } else {
                log(color.bold(`  Saved Sessions (${sessions.length}):`));
                for (const s of sessions.slice(0, 20)) {
                    const active = s.id === sessionId ? color.green(' \u25c0 current') : '';
                    const age = Math.round((Date.now() - new Date(s.updated).getTime()) / 60000);
                    const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age/60)}h ago` : `${Math.round(age/1440)}d ago`;
                    log(`  ${color.cyan(s.id)}  ${s.name}  ${color.dim(`${s.messages} msgs, ${ageStr}`)}${active}`);
                }
                log('');
                log(color.dim('  Resume with: /resume <id>'));
            }
            log('');
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/resume ')) {
            const targetId = trimmed.slice(8).trim();
            const session = loadSession(targetId);
            if (!session) {
                log(color.red(`Session '${targetId}' not found.`));
            } else {
                sessionId = session.id;
                sessionName = session.name;
                // Rebuild conversation
                conversationMessages.length = 0;
                conversationMessages.push({ role: 'system', content: systemPrompt });
                for (const msg of session.messages) {
                    conversationMessages.push(msg);
                }
                if (session.usage) {
                    usage.promptTokens = session.usage.promptTokens || 0;
                    usage.completionTokens = session.usage.completionTokens || 0;
                    usage.totalTokens = session.usage.totalTokens || 0;
                    usage.requests = session.usage.requests || 0;
                }
                log(color.green(`Resumed: ${color.bold(sessionName)}`));
                log(color.dim(`  ${session.messages.length} messages restored`));
            }
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/delete ')) {
            const targetId = trimmed.slice(8).trim();
            if (deleteSession(targetId)) {
                log(color.green(`Session '${targetId}' deleted.`));
            } else {
                log(color.red(`Session '${targetId}' not found.`));
            }
            rl.prompt();
            return;
        }

        // --- Usage tracking ---
        if (trimmed === '/usage') {
            log('');
            log(color.bold('  Token Usage (this session):'));
            log(`  Prompt tokens:     ${usage.promptTokens.toLocaleString()}`);
            log(`  Completion tokens: ${usage.completionTokens.toLocaleString()}`);
            log(`  Total tokens:      ${color.cyan(usage.totalTokens.toLocaleString())}`);
            log(`  API requests:      ${usage.requests}`);
            log(`  Messages:          ${conversationMessages.length - 1}`);
            log('');
            rl.prompt();
            return;
        }

        // --- Scan project files ---
        if (trimmed === '/scan') {
            const spinner = createSpinner('Scanning project...');
            try {
                const cwd = process.cwd();
                const entries = readdirSync(cwd);
                const rpFiles = [];
                const otherFiles = [];
                const dirs = [];

                for (const entry of entries.slice(0, 200)) {
                    try {
                        const full = join(cwd, entry);
                        const s = statSync(full);
                        if (s.isDirectory()) {
                            if (!['node_modules', '.git', '.robinpath', '__pycache__'].includes(entry)) {
                                dirs.push(entry);
                            }
                        } else if (entry.endsWith('.rp') || entry.endsWith('.robin')) {
                            rpFiles.push({ name: entry, size: s.size });
                        } else if (entry.match(/\.(json|yaml|yml|toml|env|md|txt|csv|js|ts)$/i)) {
                            otherFiles.push({ name: entry, size: s.size });
                        }
                    } catch { /* skip */ }
                }

                // Scan subdirectories one level deep for .rp files
                for (const dir of dirs.slice(0, 20)) {
                    try {
                        const subEntries = readdirSync(join(cwd, dir));
                        for (const sub of subEntries) {
                            if (sub.endsWith('.rp') || sub.endsWith('.robin')) {
                                rpFiles.push({ name: `${dir}/${sub}`, size: statSync(join(cwd, dir, sub)).size });
                            }
                        }
                    } catch { /* skip */ }
                }

                spinner.stop();

                // Build context and inject into conversation
                let scanContext = `[Project Scan — ${cwd}]\n`;
                scanContext += `Directories: ${dirs.join(', ') || '(none)'}\n`;
                if (rpFiles.length > 0) {
                    scanContext += `\nRobinPath files (${rpFiles.length}):\n`;
                    for (const f of rpFiles.slice(0, 30)) {
                        scanContext += `  ${f.name} (${(f.size/1024).toFixed(1)}KB)\n`;
                        // Auto-read small .rp files
                        if (f.size < 5000) {
                            try {
                                const content = readFileSync(join(cwd, f.name), 'utf-8');
                                scanContext += `  --- content ---\n${content}\n  --- end ---\n`;
                            } catch { /* skip */ }
                        }
                    }
                }
                if (otherFiles.length > 0) {
                    scanContext += `\nOther files: ${otherFiles.map(f => f.name).join(', ')}\n`;
                }
                // Read robinpath.json if exists
                const rpJson = join(cwd, 'robinpath.json');
                if (existsSync(rpJson)) {
                    try {
                        scanContext += `\nrobinpath.json:\n${readFileSync(rpJson, 'utf-8')}\n`;
                    } catch { /* skip */ }
                }
                scanContext += `[End Project Scan]`;

                conversationMessages.push({
                    role: 'user',
                    content: scanContext,
                });
                conversationMessages.push({
                    role: 'assistant',
                    content: `I've scanned your project. I can see ${rpFiles.length} RobinPath file(s), ${dirs.length} directories, and ${otherFiles.length} other files. I've loaded the contents of small .rp files into context. How can I help?`,
                });

                log('');
                log(color.bold(`  Project scanned: ${cwd}`));
                if (rpFiles.length > 0) {
                    log(`  RobinPath files: ${color.cyan(String(rpFiles.length))}`);
                    for (const f of rpFiles.slice(0, 10)) {
                        log(color.dim(`    ${f.name}`));
                    }
                    if (rpFiles.length > 10) log(color.dim(`    ... and ${rpFiles.length - 10} more`));
                }
                if (dirs.length > 0) log(`  Directories: ${dirs.join(', ')}`);
                log(color.green('  Context loaded. The AI now knows your project structure.'));
                log('');
            } catch (err) {
                spinner.stop();
                log(color.red(`  Scan error: ${err.message}`));
            }
            rl.prompt();
            return;
        }

        saveHistory(trimmed);

        const activeModel = readAiConfig().model || model;
        const activeKey = readAiConfig().apiKey || apiKey;
        const activeProvider = resolveProvider(activeKey);

        let spinner = createSpinner('Thinking...');

        try {
            // Add user message to history
            conversationMessages.push({ role: 'user', content: trimmed });

            // Auto-compact if conversation is getting long
            const didCompact = await autoCompact(conversationMessages);
            if (didCompact) logVerbose('Conversation auto-compacted');

            // Tags to intercept from streamed output
            const HIDDEN_TAGS = ['<memory>', '</memory>', '<cmd>', '</cmd>'];

            for (let loopCount = 0; loopCount < 15; loopCount++) {
                // Stream from brain with provider/model/apiKey passthrough
                let pending = '';
                let insideMemory = false;
                let insideCmd = false;

                const brainResult = await fetchBrainStream(
                    loopCount === 0 ? trimmed : conversationMessages[conversationMessages.length - 1].content,
                    {
                        onToken: (delta) => {
                            spinner.stop();

                            if (delta === '\x1b[RETRY]') {
                                pending = '';
                                insideMemory = false;
                                insideCmd = false;
                                spinner = createSpinner('Fixing code...');
                                return;
                            }

                            pending += delta;

                            // Process buffer — hide <memory> and <cmd> tags from display
                            while (pending.length > 0) {
                                if (insideMemory) {
                                    const closeIdx = pending.indexOf('</memory>');
                                    if (closeIdx === -1) return;
                                    const fact = pending.slice(0, closeIdx).trim();
                                    if (fact.length > 3 && fact.length < 300) {
                                        addMemoryFact(fact);
                                        logVerbose(`Memory saved: ${fact}`);
                                    }
                                    pending = pending.slice(closeIdx + 9);
                                    insideMemory = false;
                                } else if (insideCmd) {
                                    const closeIdx = pending.indexOf('</cmd>');
                                    if (closeIdx === -1) return;
                                    pending = pending.slice(closeIdx + 6);
                                    insideCmd = false;
                                } else {
                                    // Look for any tag opening
                                    const memIdx = pending.indexOf('<memory>');
                                    const cmdIdx = pending.indexOf('<cmd>');
                                    const firstTag = memIdx === -1 ? cmdIdx : cmdIdx === -1 ? memIdx : Math.min(memIdx, cmdIdx);

                                    if (firstTag === -1) {
                                        // No tag found — flush safely (keep tail that could be partial tag)
                                        const safe = pending.length - 8; // max tag length "<memory>"
                                        if (safe > 0) {
                                            process.stdout.write(pending.slice(0, safe));
                                            pending = pending.slice(safe);
                                        }
                                        return;
                                    }

                                    // Flush text before the tag
                                    if (firstTag > 0) {
                                        process.stdout.write(pending.slice(0, firstTag));
                                    }

                                    if (firstTag === memIdx) {
                                        pending = pending.slice(firstTag + 8);
                                        insideMemory = true;
                                    } else {
                                        pending = pending.slice(firstTag + 5);
                                        insideCmd = true;
                                    }
                                }
                            }
                        },
                        conversationHistory: conversationMessages.slice(0, -1),
                        provider: activeProvider,
                        model: activeModel,
                        apiKey: activeKey,
                        cliContext,
                    },
                );

                // Flush remaining display buffer
                if (pending.length > 0 && !insideMemory && !insideCmd) {
                    process.stdout.write(pending);
                }

                if (!brainResult || !brainResult.code) {
                    log(color.red('\n  Brain returned no response. Check your connection or API key.'));
                    break;
                }

                // Track usage
                if (brainResult.usage) {
                    usage.promptTokens += brainResult.usage.prompt_tokens || 0;
                    usage.completionTokens += brainResult.usage.completion_tokens || 0;
                    usage.totalTokens += (brainResult.usage.prompt_tokens || 0) + (brainResult.usage.completion_tokens || 0);
                    usage.requests++;
                }

                // Extract commands and clean the response
                const commands = extractCommands(brainResult.code);
                const { cleaned } = extractMemoryTags(stripCommandTags(brainResult.code));

                process.stdout.write('\n');

                // Warn if code validation failed
                if (brainResult.validation && !brainResult.validation.valid && brainResult.validation.errors?.length > 0) {
                    const errCount = brainResult.validation.errors.length;
                    const retries = brainResult.validation.retryCount || 0;
                    log(color.yellow(`  Warning: generated code has ${errCount} syntax issue${errCount > 1 ? 's' : ''}${retries > 0 ? ` (after ${retries} auto-fix attempt${retries > 1 ? 's' : ''})` : ''}.`));
                    for (const e of brainResult.validation.errors.slice(0, 3)) {
                        log(color.dim(`    Line ${e.line}: ${e.error}`));
                    }
                    log('');
                }

                // Store assistant message
                if (cleaned) {
                    conversationMessages.push({ role: 'assistant', content: cleaned });
                }

                logVerbose(`Brain: intent=${brainResult.context?.intent || '?'}, docs=${brainResult.context?.documentsUsed || 0}`);

                // If no commands, we're done
                if (commands.length === 0) {
                    // Auto-detect module install suggestions
                    if (cleaned) {
                        const installMatch = cleaned.match(/robinpath add (@robinpath\/[\w-]+)/g);
                        if (installMatch) {
                            const manifest = readModulesManifest();
                            for (const match of installMatch) {
                                const pkg = match.replace('robinpath add ', '');
                                if (!manifest[pkg]) {
                                    log('');
                                    log(color.yellow(`  \u26a1 Module ${color.cyan(pkg)} is not installed.`));
                                    log(color.dim(`     Run: ${color.cyan(match)}`));
                                }
                            }
                        }
                    }
                    break;
                }

                // Execute each shell command
                const cmdResults = [];
                for (const cmd of commands) {
                    const cmdPreview = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
                    log(color.dim(`  \u25b6 ${cmdPreview}`));

                    const result = executeShellCommand(cmd);

                    if (result.exitCode === 0) {
                        const lines = (result.stdout || '').split('\n');
                        const preview = lines.slice(0, 3).join('\n    ');
                        if (preview.trim()) {
                            log(color.dim(`    \u2514 ${preview}${lines.length > 3 ? '\n    ...' : ''}`));
                        } else {
                            log(color.dim(`    \u2514 done`));
                        }
                    } else {
                        log(color.red(`    \u2514 exit ${result.exitCode}: ${(result.stderr || result.error || '').slice(0, 80)}`));
                    }

                    cmdResults.push({
                        command: cmd,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
                        exitCode: result.exitCode,
                    });
                }

                // Feed command results back for next iteration
                const resultSummary = cmdResults.map(r => {
                    let out = `$ ${r.command}\n`;
                    if (r.exitCode === 0) {
                        out += r.stdout || '(no output)';
                    } else {
                        out += `Exit code: ${r.exitCode}\n`;
                        if (r.stderr) out += `stderr: ${r.stderr}\n`;
                        if (r.stdout) out += `stdout: ${r.stdout}`;
                    }
                    return out;
                }).join('\n\n');

                conversationMessages.push({
                    role: 'user',
                    content: `[Command results]\n${resultSummary}`,
                });

                spinner = createSpinner('Processing...');
            }
        } catch (err) {
            spinner.stop();
            log('');
            console.error(color.red('Error:') + ` ${err.message}`);
        }

        log('');
        rl.prompt();
    });

    function exitWithSave() {
        // Auto-save session if there are messages beyond system prompt
        if (conversationMessages.length > 1) {
            saveSession(sessionId, sessionName, conversationMessages, usage);
            log(color.dim(`Session auto-saved: ${sessionId}`));
        }
        log(color.dim('Goodbye!'));
        process.exit(0);
    }

    rl.on('close', () => {
        log('');
        exitWithSave();
    });

    process.on('SIGINT', () => {
        log('');
        exitWithSave();
    });
}

async function handleAi(args) {
    // robinpath ai config <...>
    if (args[0] === 'config') {
        await handleAiConfig(args.slice(1));
        return;
    }

    // robinpath ai sessions — list sessions
    if (args[0] === 'sessions') {
        const sessions = listSessions();
        if (sessions.length === 0) {
            log('No saved sessions.');
        } else {
            log(`\nSaved Sessions (${sessions.length}):`);
            for (const s of sessions) {
                const age = Math.round((Date.now() - new Date(s.updated).getTime()) / 60000);
                const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age/60)}h ago` : `${Math.round(age/1440)}d ago`;
                log(`  ${s.id}  ${s.name}  (${s.messages} msgs, ${ageStr})`);
            }
            log(`\nResume with: robinpath ai --resume <id>`);
        }
        return;
    }

    // robinpath ai --resume <id>
    const resumeIdx = args.indexOf('--resume');
    if (resumeIdx !== -1) {
        const resumeId = args[resumeIdx + 1];
        if (!resumeId) {
            log('Usage: robinpath ai --resume <session-id>');
            return;
        }
        await startAiREPL(null, resumeId);
        return;
    }

    // robinpath ai "prompt" (one-shot mode)
    const prompt = args.join(' ').trim();
    await startAiREPL(prompt || null);
}

/**
 * Headless prompt mode: robinpath -p "question"
 * Returns just the AI response text — no UI, no spinner, no colors.
 * Designed for integration with other apps, scripts, and pipes.
 *
 * Options:
 *   --save         Auto-save generated code to a .rp file
 *   --run          Save and immediately run the generated script
 *   -o <file>      Save to a specific filename (implies --save)
 */
async function handleHeadlessPrompt(prompt, opts = {}) {
    const { save = false, run = false, outFile = null } = opts;

    // Phase 1: Build smart context (local env + brain module resolution)
    const enriched = await buildEnrichedPrompt(prompt);

    // Show missing module warnings (on stderr so stdout stays clean for piping)
    if (enriched.missingModules.length > 0) {
        console.error('');
        for (const mod of enriched.missingModules) {
            console.error(`  \u26A0 Requires: ${mod} (not installed)`);
            console.error(`    \u2192 robinpath add ${mod}`);
        }
        console.error('');
    }

    try {
        // Phase 2: Stream brain response directly (RAG + LLM in one call)
        // The brain handles everything: intent classification, context, generation, validation
        const isSaveOrRun = save || run;

        if (isSaveOrRun) {
            // For --save/--run, collect full response (need the code block)
            const brainResult = await fetchBrainStream(enriched.enrichedPrompt);

            if (!brainResult || !brainResult.code) {
                // Fallback: try non-streaming
                const fallback = await fetchBrainContext(enriched.enrichedPrompt);
                if (fallback && fallback.code) {
                    await handleSaveRun(fallback.code, prompt, { save, run, outFile });
                } else {
                    console.error('Error: Brain returned no response');
                    process.exit(1);
                }
                return;
            }

            await handleSaveRun(brainResult.code, prompt, { save, run, outFile });
        } else {
            // Default: stream tokens to stdout in real-time
            const brainResult = await fetchBrainStream(enriched.enrichedPrompt, {
                onToken: (delta) => {
                    if (delta === '\x1b[RETRY]') return; // retry signal — screen already cleared by fetchBrainStream
                    process.stdout.write(delta);
                },
            });

            if (!brainResult) {
                // Fallback: try non-streaming
                const fallback = await fetchBrainContext(enriched.enrichedPrompt);
                if (fallback && fallback.code) {
                    console.log(fallback.code);
                } else {
                    console.error('Error: Brain returned no response');
                    process.exit(1);
                }
                return;
            }

            // End with a newline if the stream didn't
            if (brainResult.code && !brainResult.code.endsWith('\n')) {
                process.stdout.write('\n');
            }
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

async function handleSaveRun(content, prompt, { save, run, outFile }) {
    const codeMatch = content.match(/```(?:robinpath|robin|rp|js|javascript)?\s*\n([\s\S]*?)```/);
    const codeBlock = codeMatch ? codeMatch[1].trim() : null;

    if (codeBlock) {
        const fs = await import('node:fs');
        const path = await import('node:path');

        let fileName = outFile;
        if (!fileName) {
            const slug = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 50);
            fileName = `${slug}.rp`;
        }
        if (!fileName.endsWith('.rp')) fileName += '.rp';

        const fullPath = path.default.resolve(fileName);
        fs.default.writeFileSync(fullPath, codeBlock + '\n');
        console.error(`Saved: ${fullPath}`);

        if (run) {
            console.error(`Running: ${fileName}\n`);
            await runScript(codeBlock, fullPath);
        } else {
            console.log(content);
        }
    } else {
        console.error('No RobinPath code block found in response — printing raw output');
        console.log(content);
    }
}

// ============================================================================
// Help system
// ============================================================================

function showMainHelp() {
    console.log(`RobinPath v${CLI_VERSION} — Scripting language for automation and data processing

USAGE:
  robinpath [command] [flags] [file]
  rp [command] [flags] [file]          (shorthand alias)

COMMANDS:
  <file.rp>          Run a RobinPath script
  fmt <file|dir>     Format a script (--write to overwrite, --check for CI, --diff)
  check <file>       Check syntax without executing (--json for machine output)
  ast <file>         Dump AST as JSON (--compact for minified)
  test [dir|file]    Run *.test.rp test files (--json for machine output)

MODULE MANAGEMENT:
  add <pkg>[@ver]    Install a module from the registry
  remove <pkg>       Uninstall a module
  upgrade <pkg>      Upgrade a single module to latest
  search [query]     Search the module registry (--category, --sort, --page, --limit)
  info               Show system paths (--json for machines)
  info <pkg>         Show module details from registry
  modules list       List installed modules
  modules upgrade    Upgrade all installed modules
  modules init       Scaffold a new module (interactive wizard)
  audit              Check installed modules for issues

PROJECT:
  init               Create a robinpath.json project
  install            Install all modules from robinpath.json
  doctor             Diagnose environment and modules
  env <set|list|rm>  Manage environment secrets
  cache <list|clean> Manage download cache

SYSTEM:
  install            Install robinpath to system PATH (if no robinpath.json)
  uninstall          Remove robinpath from system
  update             Update robinpath to the latest version

SERVER (HTTP API):
  start              Start HTTP server for app integration
                     -p, --port <port>        Port (default: 6372)
                     -s, --session <token>    Session secret (auto-generated if omitted)
                     --host <addr>            Bind address (default: 127.0.0.1)
                     --timeout <ms>           Max script execution time (default: 30000)
                     --max-concurrent <n>     Max parallel jobs (default: 5)
                     --log-file <path>        Write JSON logs to file
                     --max-body <bytes>       Max request body (default: 5MB)
  status             Check if server is running on a port

  Endpoints:  /v1/health, /v1/execute, /v1/execute/file, /v1/check,
              /v1/fmt, /v1/jobs, /v1/jobs/:id, /v1/jobs/:id/stream,
              /v1/jobs/:id/cancel, /v1/modules, /v1/info,
              /v1/metrics, /v1/stop

  Features:   Session gatekeeper, SSE streaming, webhook callbacks,
              idempotency keys, rate limiting, structured logging,
              job management, API versioning (/v1/)

  All endpoints require x-robinpath-session header (except /v1/health).
  Use 'robinpath help start' for full details.

CLOUD:
  login              Sign in to RobinPath Cloud via browser
  logout             Remove stored credentials
  whoami             Show current user and account info
  publish [dir]      Publish a module to the registry
  pack [dir]         Create tarball without publishing
  deprecate <pkg>    Mark a module as deprecated
  sync               List your published modules

AI:
  (default)              Type 'robinpath' with no args to start AI mode
  -p, --prompt <text>    Headless AI prompt (no UI, just response — for scripts/apps)
  -p "..." --save        Save generated code to an auto-named .rp file
  -p "..." --run         Save and immediately run the generated script
  -p "..." -o <file>     Save generated code to a specific file
  ai config set-key <k>  Set OpenRouter API key
  ai config set-model    Set AI model (e.g. openai/gpt-4o)
  ai config show         Show AI configuration
  ai config remove       Remove AI configuration
  ai sessions            List saved AI sessions
  ai --resume <id>       Resume a saved AI session

SNIPPETS:
  snippet list           List your snippets (--visibility, --status, --category)
  snippet create <file>  Create a snippet from a file (or - for stdin)
  snippet init           Interactive snippet creation wizard
  snippet get <id>       View a snippet (--code-only for raw code)
  snippet update <id>    Update a snippet's metadata or code
  snippet delete <id>    Delete a snippet (--force to confirm)
  snippet explore [q]    Browse public snippets (marketplace)
  snippet search <q>     Search public snippets
  snippet star <id>      Star a snippet
  snippet unstar <id>    Unstar a snippet
  snippet fork <id>      Fork a snippet to your account
  snippet publish <id>   Make a snippet public + published
  snippet unpublish <id> Revert to private draft
  snippet copy <id>      Copy snippet code to clipboard
  snippet run <id>       Fetch and execute (cached, --no-cache to refresh)
  snippet pull <id>      Download snippet code to a local file
  snippet push <f> <id>  Update snippet code from a local file
  snippet diff <f> <id>  Compare local file with remote snippet
  snippet version <id> <v>  Set snippet version
  snippet trending       Browse trending snippets
  snippet export         Export all your snippets to JSON
  snippet import <file>  Import snippets from a JSON export

  Supports partial IDs: robinpath snippet get 01KJ8 (resolves automatically)

FLAGS:
  -p, --prompt <text>  Headless AI prompt (for scripts and app integration)
      --save           Save AI-generated code to .rp file (use with -p)
      --run            Save and run AI-generated code (use with -p)
  -o, --output <file>  Save AI output to specific file (use with -p)
  -e, --eval <code>    Execute inline script
  -w, --watch          Re-run script on file changes
  -q, --quiet          Suppress non-error output
  --verbose            Show timing and debug info
  -v, --version        Show version
  -h, --help           Show this help

REPL:
  repl               Start language REPL (for writing RobinPath code directly)

  REPL Commands:
    help             Show help
    exit / quit      Exit REPL
    clear            Clear screen
    ..               List all available commands/modules
    .load <file>     Load and execute a script file
    .save <file>     Save session to file
    \\                Line continuation (at end of line)

EXAMPLES:
  robinpath app.rp                Run a script
  robinpath hello                 Auto-resolves hello.rp or hello.robin
  robinpath -e 'log "hi"'        Execute inline code
  robinpath fmt app.rp            Print formatted code
  robinpath fmt -w src/           Format all .rp files in dir
  robinpath check app.rp          Syntax check
  robinpath ast app.rp            Dump AST as JSON
  robinpath test                  Run all *.test.rp in current dir
  robinpath test tests/           Run tests in specific dir
  robinpath --watch app.rp        Re-run on file changes
  echo 'log "hi"' | robinpath    Pipe script via stdin
  robinpath start                 Start HTTP server (auto session)
  robinpath start -p 8080 -s my-secret   Start server on port 8080

FILE EXTENSIONS:
  .rp, .robin        Both recognized (auto-resolved without extension)

MODULES (built-in):
  math      Mathematical operations (add, subtract, multiply, ...)
  string    String manipulation (length, slice, split, ...)
  array     Array operations (push, pop, map, filter, ...)
  object    Object operations (keys, values, merge, ...)
  json      JSON parse/stringify
  time      Time operations (sleep, now, format)
  random    Random number generation (int, float, pick, shuffle)
  fetch     HTTP requests (get, post, put, delete)
  test      Test assertions (assert, assertEqual, assertTrue, ...)
  dom       DOM manipulation (browser only)

TEST WRITING:
  Use the test module for assertions:
    test.assert ($value)
    test.assertEqual ($actual) ($expected)
    test.assertTrue ($value)
    test.assertContains ($array) ($item)

  Name test files with .test.rp extension.
  Run with: robinpath test

CONFIGURATION:
  Install dir:  ~/.robinpath/bin/
  Modules dir:  ~/.robinpath/modules/
  History file: ~/.robinpath/history
  Auth file:    ~/.robinpath/auth.json

For more: https://dev.robinpath.com`);
}

function showCommandHelp(command) {
    const helpPages = {
        fmt: `robinpath fmt — Code formatter

USAGE:
  robinpath fmt <file|dir> [flags]

DESCRIPTION:
  Format RobinPath source code to a canonical style (like gofmt).
  Normalizes syntax: 'set $x as 1' becomes '$x = 1', indentation
  is standardized, etc.

FLAGS:
  -w, --write    Overwrite file(s) in place
  --check        Exit code 1 if any file is not formatted (for CI)
  --diff         Show what would change (unified diff output)

  Without flags, formatted code is printed to stdout.

EXAMPLES:
  robinpath fmt app.rp            Print formatted code to stdout
  robinpath fmt -w app.rp         Format and overwrite file
  robinpath fmt --check app.rp    Check if formatted (CI mode)
  robinpath fmt --diff app.rp     Show diff of changes
  robinpath fmt -w src/           Format all .rp/.robin files in directory
  robinpath fmt --check .         Check all files in current directory`,

        check: `robinpath check — Syntax checker

USAGE:
  robinpath check <file> [--json]

DESCRIPTION:
  Parse a RobinPath script and report syntax errors without executing.
  Shows rich error context with line numbers and caret pointers.

FLAGS:
  --json         Output result as JSON (for AI agents and tooling)
                 Success: {"ok":true,"file":"app.rp"}
                 Error:   {"ok":false,"file":"app.rp","error":"...","line":5,"column":3}

EXIT CODES:
  0    No syntax errors
  2    Syntax error found

EXAMPLES:
  robinpath check app.rp          Check single file
  robinpath check app.rp --json   Machine-readable output
  robinpath check hello           Auto-resolves hello.rp or hello.robin`,

        ast: `robinpath ast — AST dump

USAGE:
  robinpath ast <file> [flags]

DESCRIPTION:
  Parse a RobinPath script and output its Abstract Syntax Tree as JSON.
  Useful for tooling, editor integrations, and debugging.

FLAGS:
  --compact      Output minified JSON (no indentation)

EXAMPLES:
  robinpath ast app.rp            Pretty-printed AST
  robinpath ast app.rp --compact  Minified AST`,

        test: `robinpath test — Test runner

USAGE:
  robinpath test [dir|file] [--json]

DESCRIPTION:
  Discover and run *.test.rp test files. Uses the built-in 'test'
  module for assertions. Each test file runs in an isolated RobinPath
  instance. If any assertion fails, the file is marked FAIL.

  Without arguments, searches the current directory recursively.

FLAGS:
  --json         Output results as JSON (for AI agents and CI)
                 {"passed":1,"failed":1,"total":2,"duration_ms":42,
                  "results":[{"file":"...","status":"pass"},
                             {"file":"...","status":"fail","error":"..."}]}

EXIT CODES:
  0    All tests passed
  1    One or more tests failed

ASSERTIONS (test module):
  test.assert ($value)            Assert value is truthy
  test.assertEqual ($a) ($b)      Assert a equals b
  test.assertTrue ($value)        Assert value is true
  test.assertFalse ($value)       Assert value is false
  test.assertContains ($arr) ($v) Assert array contains value

EXAMPLES:
  robinpath test                  Run all tests in current dir
  robinpath test --json           Machine-readable results
  robinpath test tests/           Run tests in specific dir
  robinpath test my.test.rp       Run a single test file`,

        install: `robinpath install — System installation

USAGE:
  robinpath install

DESCRIPTION:
  Copy the robinpath binary to ~/.robinpath/bin/ and add it to
  your system PATH. After installation, restart your terminal
  and run 'robinpath --version' to verify.`,

        uninstall: `robinpath uninstall — System removal

USAGE:
  robinpath uninstall

DESCRIPTION:
  Remove ~/.robinpath/ and clean the PATH entry. After uninstalling,
  restart your terminal.`,

        login: `robinpath login — Sign in to RobinPath Cloud

USAGE:
  robinpath login

DESCRIPTION:
  Opens your browser to sign in via Google. A unique verification code
  is displayed in your terminal — confirm it matches in the browser to
  complete authentication. The token is stored in ~/.robinpath/auth.json
  and is valid for 30 days.

ENVIRONMENT:
  ROBINPATH_CLOUD_URL      Override the cloud app URL (default: https://dev.robinpath.com)
  ROBINPATH_PLATFORM_URL   Override the platform API URL`,

        logout: `robinpath logout — Remove stored credentials

USAGE:
  robinpath logout

DESCRIPTION:
  Deletes the auth token stored in ~/.robinpath/auth.json.
  You will need to run 'robinpath login' again to use cloud features.`,

        whoami: `robinpath whoami — Show current user info

USAGE:
  robinpath whoami

DESCRIPTION:
  Shows your locally stored email and name, token expiry, and
  fetches your server profile (username, tier, role) if reachable.`,

        publish: `robinpath publish — Publish a module to the registry

USAGE:
  robinpath publish [dir] [flags]

DESCRIPTION:
  Pack the target directory (default: current dir) as a tarball and upload
  it to the RobinPath registry. Requires a package.json with "name" and
  "version" fields. Scoped packages (@scope/name) are supported.

  Maximum package size: 5MB.
  Excluded from tarball: node_modules, .git, dist

FLAGS:
  --public             Publish as public (default)
  --private            Publish as private (only you can install)
  --org <name>         Publish to an organization
  --patch              Auto-bump patch version before publish
  --minor              Auto-bump minor version before publish
  --major              Auto-bump major version before publish
  --dry-run            Validate and show what would be published

EXAMPLES:
  robinpath publish                        Publish current directory
  robinpath publish --private              Publish as private
  robinpath publish --org mycompany        Publish to org
  robinpath publish --patch                Bump 0.1.0 → 0.1.1 and publish
  robinpath publish --dry-run              Preview without uploading`,

        sync: `robinpath sync — List your published modules

USAGE:
  robinpath sync

DESCRIPTION:
  Fetches your published modules from the registry and displays
  them in a table with name, version, downloads, and visibility.`,

        add: `robinpath add — Install a module from the registry

USAGE:
  robinpath add <module>[@version]

DESCRIPTION:
  Downloads and installs a module to ~/.robinpath/modules/.
  Installed modules are automatically available in all scripts.

FLAGS:
  --force            Reinstall even if already installed

EXAMPLES:
  robinpath add @robinpath/slack          Install latest version
  robinpath add @robinpath/slack@0.2.0    Install specific version`,

        remove: `robinpath remove — Uninstall a module

USAGE:
  robinpath remove <module>

DESCRIPTION:
  Removes an installed module from ~/.robinpath/modules/ and
  updates the local manifest.

EXAMPLES:
  robinpath remove @robinpath/slack`,

        upgrade: `robinpath upgrade — Upgrade a module to the latest version

USAGE:
  robinpath upgrade <module>

DESCRIPTION:
  Checks the registry for a newer version and installs it.

EXAMPLES:
  robinpath upgrade @robinpath/slack`,

        modules: `robinpath modules — Module management subcommands

USAGE:
  robinpath modules <subcommand>

SUBCOMMANDS:
  list               List all installed modules
  upgrade            Upgrade all installed modules to latest
  init               Scaffold a new RobinPath module (interactive wizard)

EXAMPLES:
  robinpath modules list
  robinpath modules upgrade
  robinpath modules init`,

        pack: `robinpath pack — Create a tarball without publishing

USAGE:
  robinpath pack [dir]

DESCRIPTION:
  Creates a .tar.gz archive of the module, same as publish would,
  but saves it to the current directory instead of uploading.

EXAMPLES:
  robinpath pack
  robinpath pack ./my-module`,

        search: `robinpath search — Search the module registry

USAGE:
  robinpath search <query> [options]
  robinpath search --category=<cat> [options]

OPTIONS:
  --category=<cat>   Filter by category (utilities, devops, productivity, web,
                     sales, marketing, data, communication, ai)
  --sort=<key>       Sort results by: downloads, stars, updated, created, name
                     (default: downloads)
  --page=<n>         Page number (default: 1)
  --limit=<n>        Results per page (default: 20)
  --json             Machine-readable JSON output

DESCRIPTION:
  Searches the RobinPath module registry and displays matching modules.
  You can search by keyword, browse by category, or combine both.
  Results show name, version, download count, stars, and last update.

EXAMPLES:
  robinpath search slack
  robinpath search --category=ai
  robinpath search crm --category=sales --sort=stars
  robinpath search http --limit=5 --page=2
  robinpath search --category=utilities --json`,

        info: `robinpath info — System info & module details

USAGE:
  robinpath info                Show system paths and environment info
  robinpath info --json         Machine-readable JSON output
  robinpath info <module>       Show module details from registry

DESCRIPTION:
  Without arguments, displays system information including version,
  platform, paths to home dir, modules, cache, auth, and more.
  Useful for external tools that need to discover where RobinPath lives.

  With a module name, displays detailed information from the registry,
  including version, author, license, downloads, and install status.

FLAGS:
  --json       Output as JSON (system info mode, no args)

EXAMPLES:
  robinpath info                 Show system paths
  robinpath info --json          JSON output for external tools
  robinpath info @robinpath/slack`,

        init: `robinpath init — Create a new RobinPath project

USAGE:
  robinpath init [--force]

DESCRIPTION:
  Creates a robinpath.json project config file in the current directory,
  along with a main.rp entry file, .env, and .gitignore.

EXAMPLES:
  robinpath init`,

        doctor: `robinpath doctor — Diagnose environment

USAGE:
  robinpath doctor

DESCRIPTION:
  Checks CLI installation, authentication status, installed modules,
  project config, and cache. Reports any issues found.`,

        env: `robinpath env — Manage environment secrets

USAGE:
  robinpath env set <KEY> <value>
  robinpath env list
  robinpath env remove <KEY>

DESCRIPTION:
  Manages environment variables stored in ~/.robinpath/env.
  Values are masked when listed.

EXAMPLES:
  robinpath env set SLACK_TOKEN xoxb-1234
  robinpath env list
  robinpath env remove SLACK_TOKEN`,

        cache: `robinpath cache — Manage download cache

USAGE:
  robinpath cache list
  robinpath cache clean

DESCRIPTION:
  Manages the module download cache at ~/.robinpath/cache/.
  Cached tarballs speed up reinstalls and enable offline installs.

EXAMPLES:
  robinpath cache list
  robinpath cache clean`,

        audit: `robinpath audit — Check installed modules for issues

USAGE:
  robinpath audit

DESCRIPTION:
  Checks each installed module against the registry for deprecation
  warnings and available updates.`,

        deprecate: `robinpath deprecate — Mark a module as deprecated

USAGE:
  robinpath deprecate <module> "reason"

DESCRIPTION:
  Marks a published module as deprecated. Users who have it installed
  will see a warning when running 'robinpath audit'.

EXAMPLES:
  robinpath deprecate @myorg/old-module "Use @myorg/new-module instead"`,

        start: `robinpath start — Start HTTP server for app integration

USAGE:
  robinpath start [flags]

DESCRIPTION:
  Starts a local HTTP API server that exposes RobinPath as a service.
  Any application can execute scripts, check syntax, format code,
  and manage jobs via REST API. Session token acts as a secret
  gatekeeper — requests without a valid token are rejected (403).

  Outputs JSON to stdout on startup:
    {"ok":true,"port":6372,"host":"127.0.0.1","session":"...","version":"..."}

  If the port is already in use, outputs:
    {"ok":false,"error":"Port 6372 is already in use"}

FLAGS:
  -p, --port <port>             Port to listen on (default: 6372)
  -s, --session <token>         Session secret (default: auto-generated UUID)
  --host <address>              Bind address (default: 127.0.0.1)
  --timeout <ms>                Max script execution time (default: 30000)
  --max-concurrent <n>          Max parallel jobs (default: 5)
  --cors-origin <origin>        CORS origin (default: *)
  --log-file <path>             Write structured JSON logs to file
  --max-body <bytes>            Max request body size (default: 5000000)

ENDPOINTS:
  GET  /v1/health               Health check (no auth required)
  POST /v1/execute/file         Execute a .rp file by path
  POST /v1/execute              Execute a RobinPath script (returns job)
  POST /v1/check                Syntax check without executing
  POST /v1/fmt                  Format code
  GET  /v1/jobs                 List all jobs
  GET  /v1/jobs/:id             Job detail with output
  GET  /v1/jobs/:id/stream      SSE real-time progress stream
  POST /v1/jobs/:id/cancel      Cancel a running job
  GET  /v1/modules              List loaded modules
  GET  /v1/info                 Server info and config
  GET  /v1/metrics              Prometheus-style metrics
  POST /v1/stop                 Graceful server shutdown

HEADERS:
  x-robinpath-session           Required on all endpoints (except /health)
  x-request-id                  Optional client request ID (auto-generated if missing)
  x-idempotency-key             Prevents duplicate execution on retry
  accept: text/event-stream     On /v1/execute to get SSE streaming

EXECUTE BODY:
  { "script": "log \\"hi\\"" }                 Inline script
  { "file": "./send-emails.rp" }              Run a file by path
  { "script": "...", "webhook": "url" }       Fire-and-forget with webhook callback
  { "script": "...", "webhook": "url",
    "webhook_secret": "whsec_..." }           Webhook with signature verification

EXAMPLES:
  robinpath start                                Start with defaults
  robinpath start -p 8080 -s my-secret           Custom port and session
  robinpath start --timeout 60000                Allow 60s scripts
  robinpath start --max-concurrent 10            Allow 10 parallel jobs

CURL EXAMPLES:
  curl http://localhost:6372/v1/health

  curl -X POST http://localhost:6372/v1/execute \\
    -H "x-robinpath-session: <token>" \\
    -H "Content-Type: application/json" \\
    -d '{"script":"print(\\"hello\\")"}'

  curl -X POST http://localhost:6372/v1/stop \\
    -H "x-robinpath-session: <token>"`,

        status: `robinpath status — Check if a server is running

USAGE:
  robinpath status [-p port]

DESCRIPTION:
  Checks if a robinpath server is running on the given port.
  Queries the /v1/health endpoint and checks the PID file.
  Outputs JSON with running status, port, PID, and version.

FLAGS:
  -p, --port <port>    Port to check (default: 6372)

OUTPUT:
  Running:  {"ok":true,"running":true,"port":6372,"pid":"12345","version":"1.42.0"}
  Stopped:  {"ok":true,"running":false,"port":6372,"reason":"Server not reachable"}

EXAMPLES:
  robinpath status              Check default port
  robinpath status -p 8080      Check specific port`,

        snippet: `robinpath snippet — Manage code snippets

USAGE:
  robinpath snippet <subcommand> [options]

  Supports partial IDs — use just the first few characters:
    robinpath snippet get 01KJ8     (resolves to full ID automatically)

SUBCOMMANDS:
  list                    List your saved snippets
  create <file|->         Create a snippet from a file or stdin
  init                    Interactive snippet creation wizard
  get <id>                View a snippet (code + metadata)
  update <id>             Update a snippet
  delete <id>             Delete a snippet (--force required)
  explore [query]         Browse public snippets (marketplace)
  search <query>          Search public snippets
  star <id>               Star a snippet
  unstar <id>             Unstar a snippet
  fork <id>               Fork a snippet to your account
  publish <id>            Make public + set status to published
  unpublish <id>          Revert to private draft
  copy <id>               Copy snippet code to clipboard
  run <id>                Fetch and execute (cached locally for 5 min)
  pull <id> [file]        Download snippet code to a local file
  push <file> <id>        Update snippet code from local file
  diff <file> <id>        Compare local file with remote snippet
  version <id> <ver>      Set version (--changelog=<text>)
  trending                Browse trending snippets (alias: explore --sort=popular)
  export [file]           Export all snippets to JSON
  import <file>           Import snippets from JSON export

COMMON FLAGS:
  --json                  Machine-readable JSON output
  --page=<n>              Page number (default: 1)
  --limit=<n>             Results per page (default: 20)

GET FLAGS:
  --code-only             Output only the raw code (pipeable)
                          Example: robinpath snippet get <id> --code-only | robinpath

LIST FLAGS:
  --visibility=<v>        Filter: public or private
  --status=<s>            Filter: draft, published, or archived
  --category=<cat>        Filter by category
  [query]                 Search by name/description

CREATE FLAGS:
  --name=<name>           Snippet name (defaults to filename)
  --description=<desc>    Description
  --visibility=<v>        public or private (default: private)
  --category=<cat>        Category (forms, notifications, crm, e-commerce,
                          data-processing, auth, ai, webhooks, utilities, other)
  --tags=<t1,t2>          Comma-separated tags
  --status=<s>            draft, published, or archived
  --license=<lic>         License (MIT, Apache-2.0, GPL-3.0, etc.)
  --version=<ver>         Version string
  --readme=<file>         Readme from file

RUN FLAGS:
  --no-cache              Skip local cache, always fetch from network

EXPLORE FLAGS:
  --category=<cat>        Filter by category
  --sort=<key>            Sort: popular, stars, newest, updated
  --tags=<t1,t2>          Filter by tags

EXAMPLES:
  robinpath snippet list
  robinpath snippet list --visibility=public --status=published
  robinpath snippet list contact                          Search your snippets
  robinpath snippet init                                  Interactive wizard
  robinpath snippet create app.rp --name="My Tool" --visibility=public
  robinpath snippet create - < script.rp --name="Piped Snippet"
  robinpath snippet get 01KJ8                             Partial ID works
  robinpath snippet get abc123 --code-only                Raw code only
  robinpath snippet get abc123 --code-only | robinpath    Pipe to execute
  robinpath snippet update abc123 --name="New Name" --tags=utils,helpers
  robinpath snippet delete abc123 --force
  robinpath snippet explore --category=ai --sort=popular
  robinpath snippet search "slack notification"
  robinpath snippet star abc123
  robinpath snippet fork abc123
  robinpath snippet publish abc123
  robinpath snippet run abc123                            Cached for 5 min
  robinpath snippet run abc123 --no-cache                 Force fresh fetch
  robinpath snippet pull abc123 my-local.rp
  robinpath snippet push updated.rp abc123
  robinpath snippet diff app.rp abc123                    Compare before push
  robinpath snippet version abc123 2.0.0 --changelog="Major rewrite"
  robinpath snippet trending --limit=10
  robinpath snippet export my-backup.json
  robinpath snippet import my-backup.json`,

        ai: `robinpath ai \u2014 AI configuration & interactive mode

USAGE:
  robinpath                          Start AI interactive session (default)
  robinpath -p "question"            Headless prompt (no UI, for scripts/apps)
  robinpath ai config <subcommand>   Manage AI configuration

DESCRIPTION:
  RobinPath AI is an intelligent assistant built into the CLI. It knows
  RobinPath syntax, modules, and patterns. Ask questions, generate code,
  edit files, and run scripts \u2014 all from an interactive prompt.

  Just type 'robinpath' to start. The AI can read and modify your files,
  execute RobinPath code, and help you build projects.

  The -p flag runs a single prompt without UI \u2014 perfect for integration
  with other apps, scripts, or piping output.

SETUP:
  1. Get an API key from https://openrouter.ai/keys
  2. robinpath ai config set-key sk-or-...
  3. robinpath

CONFIG SUBCOMMANDS:
  set-key           Set your OpenRouter API key (interactive secure input)
  set-key <key>     Set your OpenRouter API key (inline — less secure)
  set-model <id>    Set the AI model (default: anthropic/claude-sonnet-4-20250514)
  show              Show current AI configuration
  remove            Remove AI configuration

AI SESSION COMMANDS:
  /help             Show help inside AI session
  /clear            Clear conversation history
  /model            Show or switch model
  /tools            List available AI tools
  exit              Exit AI mode

AI TOOLS:
  The AI can use these tools during conversation:
  - read_file       Read file contents
  - write_file      Create or overwrite files
  - edit_file       Modify specific parts of files
  - run_script      Execute RobinPath code
  - list_files      Explore project structure

HEADLESS MODE (-p):
  The -p flag returns just the AI response with no UI, colors, or
  formatting. Designed for:
  - Shell scripts:  result=$(robinpath -p "write a CSV parser")
  - App integration: spawn robinpath with -p flag, read stdout
  - Piping:         robinpath -p "explain this" | less

POPULAR MODELS:
  anthropic/claude-sonnet-4-20250514       (default, recommended)
  openai/gpt-4o
  google/gemini-2.5-pro
  deepseek/deepseek-chat              (budget-friendly)

EXAMPLES:
  robinpath ai config set-key sk-or-v1-abc123
  robinpath ai config set-model openai/gpt-4o
  robinpath                                        Start AI session
  robinpath -p "how do I read a file?"             Quick answer
  robinpath -p "write a slack bot" > bot.rp        Generate to file

  # Inside AI session:
  > make a script that reads a CSV and posts to Slack
  > add error handling to app.rp
  > what does my project do?
  > run the tests`,
    };

    const page = helpPages[command];
    if (page) {
        console.log(page);
    } else {
        console.error(color.red('Error:') + ` Unknown command: ${command}`);
        console.error('Available: add, remove, upgrade, search, info, modules, init, doctor, env, cache, audit, deprecate, pack, fmt, check, ast, test, install, uninstall, login, logout, whoami, publish, sync, snippet, ai, start, status');
        process.exit(2);
    }
}

// ============================================================================
// REPL
// ============================================================================

/**
 * Get REPL history file path
 */
function getHistoryPath() {
    return join(getRobinPathHome(), 'history');
}

/**
 * Load REPL history from file
 */
function loadHistory() {
    const historyPath = getHistoryPath();
    try {
        if (existsSync(historyPath)) {
            const content = readFileSync(historyPath, 'utf-8');
            return content.split('\n').filter(line => line.trim()).reverse();
        }
    } catch {
        // Ignore errors reading history
    }
    return [];
}

/**
 * Append a line to REPL history file
 */
function appendHistory(line) {
    const historyPath = getHistoryPath();
    try {
        const dir = getRobinPathHome();
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        appendFileSync(historyPath, line + '\n', 'utf-8');

        // Trim history file if it exceeds 1000 lines
        try {
            const content = readFileSync(historyPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            if (lines.length > 1000) {
                const trimmed = lines.slice(lines.length - 1000);
                writeFileSync(historyPath, trimmed.join('\n') + '\n', 'utf-8');
            }
        } catch {
            // Ignore trim errors
        }
    } catch {
        // Ignore errors writing history
    }
}

async function startREPL() {
    const rp = await createRobinPath({ threadControl: true });
    rp.createThread('default');

    const sessionLines = []; // Track session lines for .save

    function getPrompt() {
        const thread = rp.getCurrentThread();
        if (!thread) return '> ';
        const currentModule = thread.getCurrentModule();
        if (currentModule) {
            return `${thread.id}@${currentModule}> `;
        }
        return `${thread.id}> `;
    }

    function endsWithBackslash(line) {
        return line.trimEnd().endsWith('\\');
    }

    let accumulatedLines = [];

    // Load history
    const history = loadHistory();

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getPrompt(),
        history: history,
        historySize: 1000,
    });

    log(`RobinPath v${CLI_VERSION}`);
    log('Type "help" for commands, "exit" to quit');
    log('');

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();

        if (!trimmed && accumulatedLines.length === 0) {
            rl.prompt();
            return;
        }

        if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit') {
            log('Goodbye!');
            process.exit(0);
        }

        if (accumulatedLines.length === 0 && (trimmed === 'help' || trimmed === '.help')) {
            log('');
            log('RobinPath REPL Commands:');
            log('  exit, quit     Exit the REPL');
            log('  help           Show this help');
            log('  clear          Clear the screen');
            log('  ..             Show all available commands');
            log('  .load <file>   Load and execute a script file');
            log('  .save <file>   Save session to file');
            log('');
            log('Write RobinPath code and press Enter to execute.');
            log('Multi-line blocks (if/def/for/do) are supported.');
            log('Use \\ at end of line for line continuation.');
            log('');
            rl.prompt();
            return;
        }

        if (accumulatedLines.length === 0 && (trimmed === 'clear' || trimmed === '.clear')) {
            console.clear();
            rl.prompt();
            return;
        }

        // ".." command — show available commands
        if (accumulatedLines.length === 0 && trimmed === '..') {
            const thread = rp.getCurrentThread();
            const commands = thread ? thread.getAvailableCommands() : rp.getAvailableCommands();
            log(JSON.stringify(commands, null, 2));
            rl.prompt();
            return;
        }

        // .load <file> — load and execute a script file
        if (accumulatedLines.length === 0 && trimmed.startsWith('.load ')) {
            const fileArg = trimmed.slice(6).trim();
            if (!fileArg) {
                console.error(color.red('Error:') + ' .load requires a file argument');
                rl.prompt();
                return;
            }
            const loadPath = resolveScriptPath(fileArg);
            if (!loadPath) {
                console.error(color.red('Error:') + ` File not found: ${fileArg}`);
                rl.prompt();
                return;
            }
            try {
                const script = readFileSync(loadPath, 'utf-8');
                log(color.dim(`Loading ${fileArg}...`));
                const thread = rp.getCurrentThread();
                if (thread) {
                    await thread.executeScript(script);
                } else {
                    await rp.executeScript(script);
                }
                log(color.green('Loaded') + ` ${fileArg}`);
            } catch (error) {
                displayError(error, null);
            }
            rl.setPrompt(getPrompt());
            rl.prompt();
            return;
        }

        // .save <file> — save session lines to a file
        if (accumulatedLines.length === 0 && trimmed.startsWith('.save ')) {
            const fileArg = trimmed.slice(6).trim();
            if (!fileArg) {
                console.error(color.red('Error:') + ' .save requires a file argument');
                rl.prompt();
                return;
            }
            try {
                const content = sessionLines.join('\n') + '\n';
                writeFileSync(resolve(fileArg), content, 'utf-8');
                log(color.green('Saved') + ` ${sessionLines.length} lines to ${fileArg}`);
            } catch (error) {
                console.error(color.red('Error:') + ` Could not save: ${error.message}`);
            }
            rl.prompt();
            return;
        }

        // Backslash continuation
        if (endsWithBackslash(line)) {
            accumulatedLines.push(line);
            rl.setPrompt('... ');
            rl.prompt();
            return;
        }

        // If we have accumulated lines, add this one
        if (accumulatedLines.length > 0) {
            accumulatedLines.push(line);
        }

        // Determine the full script to check/execute
        const scriptToCheck = accumulatedLines.length > 0
            ? accumulatedLines.join('\n')
            : line;

        try {
            const thread = rp.getCurrentThread();
            let needsMore;
            if (thread) {
                needsMore = await thread.needsMoreInput(scriptToCheck);
            } else {
                needsMore = await rp.needsMoreInput(scriptToCheck);
            }

            if (needsMore.needsMore) {
                if (accumulatedLines.length === 0) {
                    accumulatedLines.push(line);
                }
                rl.setPrompt('... ');
                rl.prompt();
                return;
            }

            // Block is complete — execute
            const finalScript = accumulatedLines.length > 0
                ? accumulatedLines.join('\n')
                : line;
            accumulatedLines = [];

            // Save to history and session
            appendHistory(finalScript);
            sessionLines.push(finalScript);

            if (thread) {
                await thread.executeScript(finalScript);
            } else {
                await rp.executeScript(finalScript);
            }

            rl.setPrompt(getPrompt());
        } catch (error) {
            displayError(error, null);
            accumulatedLines = [];
            rl.setPrompt(getPrompt());
        }

        rl.prompt();
    });

    rl.on('close', () => {
        log('\nGoodbye!');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        if (accumulatedLines.length > 0) {
            log('\nBlock cancelled.');
            accumulatedLines = [];
            rl.setPrompt(getPrompt());
            rl.prompt();
        } else {
            log('\nGoodbye!');
            process.exit(0);
        }
    });
}

// ============================================================================
// Main entry point
// ============================================================================

async function main() {
    const args = process.argv.slice(2);

    // Parse global flags first
    FLAG_QUIET = args.includes('--quiet') || args.includes('-q');
    FLAG_VERBOSE = args.includes('--verbose');

    // Detect invoked name (robinpath or rp)
    const invokedAs = basename(process.execPath, '.exe').toLowerCase();
    const cliName = invokedAs === 'rp' ? 'rp' : 'robinpath';

    // Handle flags (can appear anywhere)
    if (args.includes('--version') || args.includes('-v')) {
        console.log(`${cliName} v${CLI_VERSION} (lang v${ROBINPATH_VERSION})`);
        return;
    }

    if (args.includes('--help') || args.includes('-h')) {
        showMainHelp();
        return;
    }

    // Handle commands
    const command = args[0];

    // help <command>
    if (command === 'help') {
        const subCommand = args[1];
        if (subCommand) {
            showCommandHelp(subCommand);
        } else {
            showMainHelp();
        }
        return;
    }

    // Module management: add, remove, upgrade, search, info, modules
    if (command === 'add') {
        await handleAdd(args.slice(1));
        return;
    }
    if (command === 'remove') {
        await handleRemove(args.slice(1));
        return;
    }
    if (command === 'upgrade') {
        await handleUpgrade(args.slice(1));
        return;
    }
    if (command === 'search') {
        await handleSearch(args.slice(1));
        return;
    }
    if (command === 'info') {
        await handleInfo(args.slice(1));
        return;
    }
    if (command === 'modules' || command === 'module') {
        const sub = args[1];
        if (!sub || sub === 'list') {
            await handleModulesList();
        } else if (sub === 'upgrade') {
            await handleModulesUpgradeAll();
        } else if (sub === 'init') {
            await handleModulesInit();
        } else {
            console.error(color.red('Error:') + ` Unknown subcommand: modules ${sub}`);
            console.error('Available: modules list, modules upgrade, modules init');
            process.exit(2);
        }
        return;
    }
    if (command === 'pack') {
        await handlePack(args.slice(1));
        return;
    }
    if (command === 'audit') {
        await handleAudit();
        return;
    }
    if (command === 'deprecate') {
        await handleDeprecate(args.slice(1));
        return;
    }
    if (command === 'env') {
        await handleEnv(args.slice(1));
        return;
    }
    if (command === 'cache') {
        await handleCache(args.slice(1));
        return;
    }
    if (command === 'doctor') {
        await handleDoctor();
        return;
    }
    if (command === 'init') {
        await handleInit(args.slice(1));
        return;
    }

    // install — project install (if robinpath.json exists) or system install
    if (command === 'install') {
        const hasProjectFile = existsSync(resolve('robinpath.json'));
        if (hasProjectFile) {
            await handleProjectInstall();
        } else {
            handleInstall();
        }
        return;
    }
    if (command === 'uninstall') {
        handleUninstall();
        return;
    }
    if (command === 'update') {
        await handleUpdate();
        return;
    }

    // check <file>
    if (command === 'check') {
        await handleCheck(args.slice(1));
        return;
    }

    // ast <file>
    if (command === 'ast') {
        await handleAST(args.slice(1));
        return;
    }

    // fmt <file|dir>
    if (command === 'fmt') {
        await handleFmt(args.slice(1));
        return;
    }

    // test [dir|file]
    if (command === 'test') {
        await handleTest(args.slice(1));
        return;
    }

    // login
    if (command === 'login') {
        await handleLogin();
        return;
    }

    // logout
    if (command === 'logout') {
        handleLogout();
        return;
    }

    // whoami
    if (command === 'whoami') {
        await handleWhoami();
        return;
    }

    // publish [dir]
    if (command === 'publish') {
        await handlePublish(args.slice(1));
        return;
    }

    // sync
    if (command === 'sync') {
        await handleSync();
        return;
    }

    // snippet <subcommand>
    if (command === 'snippet' || command === 'snippets') {
        await handleSnippet(args.slice(1));
        return;
    }

    // ai config — AI configuration
    if (command === 'ai') {
        await handleAi(args.slice(1));
        return;
    }

    // repl — language REPL (moved from default)
    if (command === 'repl') {
        await startREPL();
        return;
    }

    // start — HTTP server mode
    if (command === 'start') {
        await handleStart(args.slice(1));
        return;
    }

    // status — check if a server is running
    if (command === 'status') {
        await handleStatus(args.slice(1));
        return;
    }

    // Handle -p / --prompt (headless AI prompt — no UI, just response)
    const promptIdx = args.indexOf('-p') !== -1 ? args.indexOf('-p') : args.indexOf('--prompt');
    if (promptIdx !== -1) {
        // Extract flags before building prompt text
        const hasSave = args.includes('--save');
        const hasRun = args.includes('--run');
        const outIdx = args.indexOf('-o') !== -1 ? args.indexOf('-o') : args.indexOf('--output');
        const outFile = outIdx !== -1 ? args[outIdx + 1] : null;

        // Build prompt from remaining args (strip flags)
        const skipSet = new Set([promptIdx]);
        if (hasSave) skipSet.add(args.indexOf('--save'));
        if (hasRun) skipSet.add(args.indexOf('--run'));
        if (outIdx !== -1) { skipSet.add(outIdx); skipSet.add(outIdx + 1); }
        const promptParts = [];
        for (let pi = promptIdx + 1; pi < args.length; pi++) {
            if (!skipSet.has(pi)) promptParts.push(args[pi]);
        }
        const prompt = promptParts.join(' ').trim();
        if (!prompt) {
            console.error(color.red('Error:') + ' -p requires a prompt argument');
            process.exit(2);
        }
        await handleHeadlessPrompt(prompt, { save: hasSave || !!outFile, run: hasRun, outFile });
        return;
    }

    // Handle -e / --eval
    const evalIdx = args.indexOf('-e') !== -1 ? args.indexOf('-e') : args.indexOf('--eval');
    if (evalIdx !== -1) {
        const script = args[evalIdx + 1];
        if (!script) {
            console.error(color.red('Error:') + ' -e requires a script argument');
            process.exit(2);
        }
        await runScript(script);
        return;
    }

    // Handle -- (everything after is treated as file arg)
    const dashDashIdx = args.indexOf('--');
    let fileArg;
    if (dashDashIdx !== -1) {
        fileArg = args[dashDashIdx + 1];
    } else {
        // Filter out known flags before finding file arg
        const flagsToSkip = new Set(['-q', '--quiet', '--verbose', '-p', '--prompt']);
        fileArg = args.find(a => !a.startsWith('-') && !flagsToSkip.has(a));
    }

    // Handle file argument
    if (fileArg) {
        const filePath = resolveScriptPath(fileArg);
        if (!filePath) {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
            if (!extname(fileArg)) {
                console.error(`  (also tried ${fileArg}.rp and ${fileArg}.robin)`);
            }
            process.exit(2);
        }

        const script = readFileSync(filePath, 'utf-8');

        // --watch / -w flag (only when file is present)
        const hasWatch = args.includes('--watch');
        // -w only means watch when a file arg is present and -w is NOT after 'fmt'
        const hasShortWatch = args.includes('-w') && command !== 'fmt';
        if (hasWatch || hasShortWatch) {
            await handleWatch(filePath, script);
            return;
        }

        await runScript(script, filePath);
        return;
    }

    // No file, no -e — check if stdin is piped (not a terminal)
    if (!process.stdin.isTTY) {
        // Piped input: read all stdin and execute as a script
        const script = await readStdin();
        if (script.trim()) {
            await runScript(script);
        }
        return;
    }

    // Check for updates (non-blocking)
    checkForUpdates();

    // Default: AI interactive mode (stdin is a terminal)
    await startAiREPL(null);
}

main().catch(err => {
    console.error(color.red('Fatal:') + ` ${err.message}`);
    process.exit(1);
});
