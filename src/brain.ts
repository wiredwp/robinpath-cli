/**
 * RobinPath CLI — Brain API integration: RAG context, streaming, smart context builder
 */
import { join } from 'node:path';
import { platform } from 'node:os';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { logVerbose, color, getShellConfig, getRobinPathHome, CLI_VERSION } from './utils';
import { AI_BRAIN_URL, readAiConfig } from './config';
import type { Message } from './sessions';
import { getNativeModules } from './runtime';

// ============================================================================
// Interfaces
// ============================================================================

export interface BrainResult {
    code: string;
    sources: unknown[];
    context: Record<string, unknown>;
}

export interface BrainStreamOptions {
    onToken?: (delta: string) => void;
    conversationHistory?: Message[];
    provider?: string;
    model?: string;
    apiKey?: string;
    cliContext?: CLIContext;
}

export interface BrainStreamResult {
    code: string;
    sources: unknown[];
    context: Record<string, unknown>;
    validation: unknown | null;
    usage: unknown | null;
}

export interface CLIContext {
    cwd: string;
    platform: string;
    cliVersion: string;
    installedModules: { name: string; version: string }[];
    nativeModuleNames: string[];
    projectConfig: Record<string, unknown> | null;
    localFiles: { name: string; size: number }[];
    envVarNames: string[];
}

export interface ResolvedModule {
    name: string;
    score: number;
    description?: string;
    functions: string[];
}

export interface EnrichedPromptResult {
    enrichedPrompt: string;
    resolved: ResolvedModule[] | null;
    local: CLIContext;
    missingModules: string[];
}

import { readModulesManifest } from './commands-core';

// ============================================================================
// Brain RAG context
// ============================================================================

/**
 * Fetch RAG context from the AI brain for a given prompt.
 * Returns relevant module docs and examples to inject into the system prompt.
 * Falls back gracefully if the brain is unreachable.
 */
export async function fetchBrainContext(prompt: string): Promise<BrainResult | null> {
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
    } catch (err: unknown) {
        logVerbose('Brain unreachable:', (err as Error).message);
        return null;
    }
}

// ============================================================================
// Brain streaming
// ============================================================================

/**
 * Stream brain response via SSE — prints tokens as they arrive.
 * Returns the full accumulated text when done.
 */
export async function fetchBrainStream(
    prompt: string,
    { onToken, conversationHistory, provider, model, apiKey, cliContext }: BrainStreamOptions = {},
): Promise<BrainStreamResult | null> {
    try {
        const body: Record<string, unknown> = {
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
            const errorHint = response.status === 401 ? 'Invalid API key.'
                : response.status === 429 ? 'Rate limited. Wait a moment and try again.'
                : response.status >= 500 ? 'Brain server error. Try again.'
                : `Brain returned HTTP ${response.status}.`;
            return { code: '', sources: [], context: {}, validation: null, usage: null, error: errorHint } as any;
        }

        let fullText = '';
        let metadata: { sources?: unknown[]; context?: Record<string, unknown> } | null = null;
        let doneData: { validation?: unknown; usage?: unknown } | null = null;

        // Parse SSE stream
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
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
                        const delta: string = parsed.delta || '';
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
    } catch (err: unknown) {
        const msg = (err as Error).message || '';
        logVerbose('Brain stream unreachable:', msg);

        // Classify the error for user-friendly messages
        let errorHint: string;
        if (msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError') || msg.includes('getaddrinfo')) {
            errorHint = 'No internet connection. Check your network and try again.';
        } else if (msg.includes('abort') || msg.includes('timeout') || msg.includes('TimeoutError')) {
            errorHint = 'Request timed out. The server might be slow — try again.';
        } else if (msg.includes('CERT') || msg.includes('SSL') || msg.includes('certificate')) {
            errorHint = 'SSL/certificate error. Check your network or proxy settings.';
        } else {
            errorHint = `Connection failed: ${msg.slice(0, 100)}`;
        }

        return { code: '', sources: [], context: {}, validation: null, usage: null, error: errorHint } as any;
    }
}

// ============================================================================
// Smart Context Builder
// ============================================================================

/**
 * Resolve which modules a prompt needs via the brain's vector search.
 * Returns module names, functions, and relevance scores.
 * Fast — no LLM call, just embedding + vector similarity.
 */
export async function resolveBrainModules(prompt: string): Promise<ResolvedModule[] | null> {
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
    } catch (err: unknown) {
        logVerbose('Brain resolve unreachable:', (err as Error).message);
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
export function buildLocalContext(): CLIContext {
    const cwd = process.cwd();
    const ctx: CLIContext = {
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
    ctx.nativeModuleNames = getNativeModules().map((m) => m.name);

    // Project config
    try {
        const projectPath = join(cwd, 'robinpath.json');
        if (existsSync(projectPath)) {
            ctx.projectConfig = JSON.parse(readFileSync(projectPath, 'utf-8'));
        }
    } catch {
        /* ignore */
    }

    // Relevant local files (scripts + data, max 20)
    try {
        const entries = readdirSync(cwd, { withFileTypes: true });
        const relevant: { name: string; size: number }[] = [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const ext = entry.name.split('.').pop()?.toLowerCase();
                if (['rp', 'robin', 'csv', 'json', 'txt', 'sql', 'db'].includes(ext || '')) {
                    try {
                        const st = statSync(join(cwd, entry.name));
                        relevant.push({ name: entry.name, size: st.size });
                    } catch {
                        /* ignore */
                    }
                }
            }
        }
        ctx.localFiles = relevant.slice(0, 20);
    } catch {
        /* ignore */
    }

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
    } catch {
        /* ignore */
    }

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
export async function buildEnrichedPrompt(prompt: string): Promise<EnrichedPromptResult> {
    const [resolved, local] = await Promise.all([resolveBrainModules(prompt), Promise.resolve(buildLocalContext())]);

    const installedNames = new Set<string>([
        ...local.installedModules.map((m) => m.name.replace(/^@robinpath\//, '')),
        ...local.nativeModuleNames,
    ]);

    // Modules that overlap with built-in language features (not external deps)
    // Populated dynamically from native module list + core language keywords
    const coreOverlaps = new Set<string>(local.nativeModuleNames);
    for (const mod of getNativeModules()) {
        // Any native function that shares a name with a resolved module
        for (const fn of Object.keys(mod.functions || {})) {
            coreOverlaps.add(fn);
        }
    }

    const sections: string[] = [];

    // Section 1: Module availability
    if (resolved && resolved.length > 0) {
        // Filter: score > 0.76, and exclude modules that overlap with core language features
        const relevant = resolved.filter((m) => m.score > 0.76 && !coreOverlaps.has(m.name));
        if (relevant.length > 0) {
            const moduleLines = relevant.map((m) => {
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
        const missing = relevant.filter((m) => !installedNames.has(m.name)).map((m) => `@robinpath/${m.name}`);
        if (missing.length > 0) {
            sections.push(`Not installed: ${missing.join(', ')}`);
        }
    }

    // Section 2: Installed modules
    if (local.installedModules.length > 0) {
        sections.push(`Installed: ${local.installedModules.map((m) => m.name).join(', ')}`);
    }

    // Section 3: Local files
    if (local.localFiles.length > 0) {
        sections.push(`Files: ${local.localFiles.map((f) => `${f.name} (${formatFileSize(f.size)})`).join(', ')}`);
    }

    // Section 4: Environment variables
    if (local.envVarNames.length > 0) {
        sections.push(`Env: ${local.envVarNames.join(', ')}`);
    }

    // Section 5: Project
    if (local.projectConfig?.name) {
        sections.push(`Project: ${(local.projectConfig as Record<string, string>).name}`);
    }

    // Build the enriched prompt
    const contextBlock = sections.length > 0 ? `[Context]\n${sections.join('\n\n')}\n[/Context]\n\n` : '';

    return {
        enrichedPrompt: `${contextBlock}${prompt}`,
        resolved,
        local,
        missingModules: resolved
            ? resolved
                  .filter((m) => m.score > 0.76 && !installedNames.has(m.name) && !coreOverlaps.has(m.name))
                  .map((m) => `@robinpath/${m.name}`)
            : [],
    };
}

// ============================================================================
// Helpers
// ============================================================================

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
