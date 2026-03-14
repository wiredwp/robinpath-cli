/**
 * RobinPath CLI — AI REPL, handlers, welcome wizard, config commands
 *
 * Extracted from cli-entry.js lines 6231–8375.
 * All logic is preserved verbatim; only TypeScript types and module
 * imports/exports have been added.
 */
import { createInterface, Interface as ReadlineInterface } from 'node:readline';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
    color,
    log,
    logVerbose,
    createSpinner,
    getShellConfig,
    getRobinPathHome,
    CLI_VERSION,
    FLAG_AUTO_ACCEPT,
    FLAG_DEV_MODE,
} from './utils';
import { readAiConfig, writeAiConfig, AI_BRAIN_URL, AI_CONFIG_PATH } from './config';
import type { AiConfig } from './config';
import { AI_MODELS, createUsageTracker, estimateCost } from './models';
import type { UsageTracker, ModelInfo } from './models';
import {
    listSessions,
    saveSession,
    loadSession,
    deleteSession,
    addMemoryFact,
    removeMemoryFact,
    loadMemory,
    buildMemoryContext,
    extractMemoryTags,
    autoCompact,
    estimateTokens,
} from './sessions';
import type { Message } from './sessions';
import {
    executeShellCommand,
    extractCommands,
    stripCommandTags,
    detectFileWrite,
    showFileDiff,
} from './shell';
import {
    selectModelInteractive,
    selectSessionInteractive,
    createInteractivePicker,
    confirmCommand,
    isDangerousCommand,
    formatAiResponse,
} from './ui';
import type { ConfirmResult } from './ui';
import { fetchBrainStream, fetchBrainContext, buildEnrichedPrompt } from './brain';
import type { BrainStreamResult } from './brain';

import { nativeModules } from './runtime';

// ============================================================================
// External declarations — these come from modules not yet extracted into src/
// ============================================================================

/** Native module descriptor (from modules/index.js). */
interface NativeModule {
    name: string;
    [key: string]: unknown;
}

/**
 * These symbols live in the main entry file and are passed in at call-time
 * or declared here so TypeScript doesn't complain.  When the full migration
 * is complete they will be proper imports.
 */
import { readModulesManifest, runScript } from './commands-core';
import { FLAG_VERBOSE, setFlags } from './utils';

// ============================================================================
// Interfaces
// ============================================================================

export interface ReplOptions {
    autoAccept?: boolean;
    devMode?: boolean;
}

interface ScannedFile {
    name: string;
    size: number;
}

interface CommandResult {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
}

// ============================================================================
// welcomeWizard()  — lines 6231–6331
// ============================================================================

export async function welcomeWizard(): Promise<void> {
    const options: { name: string; value: string }[] = [
        { name: 'Start with free tier (no key needed)', value: 'free' },
        { name: 'I have an API key (OpenRouter, OpenAI, Anthropic)', value: 'key' },
    ];

    let cursor = 0;

    const picked: string | null = await createInteractivePicker({
        renderFn: (out: (text: string) => void) => {
            out('');
            out(color.bold('  Welcome to RobinPath AI!'));
            out(color.dim('  Your AI-powered scripting assistant'));
            out('');
            for (let i = 0; i < options.length; i++) {
                const marker = i === cursor ? color.cyan('\u276f') : ' ';
                const text = i === cursor ? color.cyan(color.bold(options[i].name)) : options[i].name;
                out(`  ${marker} ${text}`);
            }
            out('');
            out(color.dim('  \u2191\u2193 navigate  Enter select'));
        },
        onKeyFn: (key: string) => {
            if (key === '\r' || key === '\n') return options[cursor].value;
            if (key === '\x1b') return 'free';
            if (key === '\x1b[A' || key === 'k') { cursor = Math.max(0, cursor - 1); return 'render'; }
            if (key === '\x1b[B' || key === 'j') { cursor = Math.min(options.length - 1, cursor + 1); return 'render'; }
            return undefined;
        },
    }) || 'free';

    if (picked === 'free') {
        writeAiConfig({ model: 'robinpath-default' });
        log(color.green('  \u2713 Free tier activated \u2014 using Gemini 2.0 Flash'));
        log(color.dim(`  Upgrade anytime: ${color.cyan('robinpath ai config set-key <api-key>')}`));
        log('');
        return;
    }

    // Key setup flow — masked input (no readline, pure raw mode)
    log('');
    const key: string = await new Promise((resolve) => {
        if (process.stdin.isTTY) {
            process.stdout.write(color.cyan('  Paste your API key: '));
            process.stdin.setRawMode!(true);
            process.stdin.resume();
            let input = '';
            const onData = (ch: Buffer): void => {
                const c = ch.toString();
                if (c === '\n' || c === '\r') {
                    process.stdin.removeListener('data', onData);
                    try { process.stdin.setRawMode!(false); } catch {}
                    process.stdin.pause();
                    process.stdout.write('\n');
                    resolve(input);
                } else if (c === '\u0003') {
                    process.stdin.removeListener('data', onData);
                    try { process.stdin.setRawMode!(false); } catch {}
                    process.stdin.pause();
                    resolve('');
                } else if (c === '\u007f' || c === '\b') {
                    if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
                } else if (c.charCodeAt(0) >= 32) {
                    input += c;
                    process.stdout.write('*');
                }
            };
            process.stdin.on('data', onData);
        } else {
            const rl2 = createInterface({ input: process.stdin, output: process.stdout });
            rl2.question('  Paste your API key: ', (answer: string) => { rl2.close(); resolve(answer.trim()); });
        }
    });

    if (!key || !key.trim()) {
        writeAiConfig({ model: 'robinpath-default' });
        log(color.dim('  No key provided \u2014 using free tier.'));
        return;
    }

    const k: string = key.trim();
    const config: AiConfig = { apiKey: k };
    if (k.startsWith('sk-or-')) config.provider = 'openrouter';
    else if (k.startsWith('sk-ant-')) config.provider = 'anthropic';
    else if (k.startsWith('sk-')) config.provider = 'openai';
    else config.provider = 'openrouter';
    config.model = 'anthropic/claude-sonnet-4.6';
    writeAiConfig(config);

    log(color.green('  \u2713 API key saved'));
    log(`  Provider: ${color.cyan(config.provider as string)} (auto-detected)`);
    log('');

    // Show model picker
    const picked2: string | null = await selectModelInteractive(config.model);
    if (picked2) {
        config.model = picked2;
        writeAiConfig(config);
    }
    log(color.green(`  \u2713 Model: ${color.cyan(config.model)}`));
    log('');
}

// ============================================================================
// handleAiConfig()  — lines 6333–6474
// ============================================================================

export async function handleAiConfig(args: string[]): Promise<void> {
    const sub: string | undefined = args[0];

    if (sub === 'set-key') {
        let key: string | undefined = args[1];
        if (!key) {
            // Interactive secure input — masked with * characters
            key = await new Promise<string>((resolve) => {
                if (process.stdin.isTTY) {
                    process.stdout.write('Enter your API key (OpenRouter, OpenAI, or Anthropic): ');
                    process.stdin.setRawMode!(true);
                    process.stdin.resume();
                    let input = '';
                    const onData = (ch: Buffer): void => {
                        const c = ch.toString();
                        if (c === '\n' || c === '\r') {
                            process.stdin.removeListener('data', onData);
                            try { process.stdin.setRawMode!(false); } catch {}
                            process.stdin.pause();
                            process.stdout.write('\n');
                            resolve(input);
                        } else if (c === '\u0003') { // Ctrl+C
                            process.stdin.removeListener('data', onData);
                            try { process.stdin.setRawMode!(false); } catch {}
                            process.stdin.pause();
                            process.exit(0);
                        } else if (c === '\u007f' || c === '\b') { // Backspace
                            if (input.length > 0) {
                                input = input.slice(0, -1);
                                process.stdout.write('\b \b');
                            }
                        } else if (c.charCodeAt(0) >= 32) { // Printable chars only
                            input += c;
                            process.stdout.write('*');
                        }
                    };
                    process.stdin.on('data', onData);
                } else {
                    const rl = createInterface({ input: process.stdin, output: process.stdout });
                    rl.question('Enter your API key: ', (answer: string) => {
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
        const config: AiConfig = readAiConfig();
        config.apiKey = key.trim();
        // Auto-detect provider from key prefix
        const k: string = key.trim();
        if (k.startsWith('sk-or-')) config.provider = 'openrouter';
        else if (k.startsWith('sk-ant-')) config.provider = 'anthropic';
        else if (k.startsWith('sk-')) config.provider = 'openai';
        else if (!config.provider) config.provider = 'openrouter';
        if (!config.model) config.model = 'anthropic/claude-sonnet-4.6';
        writeAiConfig(config);
        log(color.green('API key saved.'));
        log(`Provider: ${color.cyan(config.provider as string)} (auto-detected)`);
        log('');
        // Show interactive model picker after saving key
        if (process.stdin.isTTY) {
            const picked: string | null = await selectModelInteractive(config.model);
            if (picked) {
                config.model = picked;
                writeAiConfig(config);
                log(color.green('Model set:') + ` ${color.cyan(picked)}`);
            } else {
                log(`Model: ${color.cyan(config.model)} (default)`);
            }
        } else {
            log(`Model: ${color.cyan(config.model)}`);
        }
        log(`\nStart chatting with: ${color.cyan('robinpath ai')}`);
    } else if (sub === 'set-model') {
        const model: string | undefined = args[1];
        if (!model) {
            // No model arg — show interactive picker
            if (process.stdin.isTTY) {
                const config2: AiConfig = readAiConfig();
                const picked: string | null = await selectModelInteractive(config2.model || 'anthropic/claude-sonnet-4.6');
                if (picked) {
                    config2.model = picked;
                    writeAiConfig(config2);
                    log(color.green('Model set:') + ` ${color.cyan(picked)}`);
                } else {
                    log('Model selection cancelled.');
                }
                return;
            }
            console.error(color.red('Error:') + ' Usage: robinpath ai config set-model <model-id>');
            console.error('\nExamples:');
            console.error('  anthropic/claude-sonnet-4.6');
            console.error('  openai/gpt-5.2');
            console.error('  google/gemini-3-flash-preview');
            process.exit(2);
        }
        const config: AiConfig = readAiConfig();
        config.model = model;
        writeAiConfig(config);
        log(color.green('Model set:') + ` ${color.cyan(model)}`);
    } else if (sub === 'show') {
        const config: AiConfig = readAiConfig();
        log('');
        log(color.bold('  AI Configuration:'));
        log(color.dim('  ' + '\u2500'.repeat(40)));
        if (!config.apiKey) {
            log(`  Provider:  ${color.cyan('gemini')} (free, no key needed)`);
            log(`  Model:     ${color.cyan('gemini-2.0-flash')}`);
            log(`  API Key:   ${color.dim('(none \u2014 using free tier)')}`);
            log('');
            log(color.dim('  Optional: set a key for premium models:'));
            log(color.dim(`  ${color.cyan('robinpath ai config set-key <api-key>')}`));
        } else {
            log(`  Provider:  ${color.cyan(config.provider as string || 'openrouter')}`);
            log(`  Model:     ${color.cyan(config.model || 'anthropic/claude-sonnet-4.6')}`);
            const masked: string = (config.apiKey as string).length > 8
                ? (config.apiKey as string).slice(0, 5) + '\u2022'.repeat(Math.min((config.apiKey as string).length - 8, 20)) + (config.apiKey as string).slice(-3)
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

// ============================================================================
// startAiREPL()  — lines 7263–8219
// ============================================================================

export async function startAiREPL(
    initialPrompt: string | null,
    resumeSessionId: string | null,
    opts: ReplOptions = {},
): Promise<void> {
    const config: AiConfig = readAiConfig();
    let autoAccept: boolean = opts.autoAccept || false;
    const devMode: boolean = opts.devMode || false;
    if (devMode) setFlags({ verbose: true });

    // Resolve provider from API key prefix (if key is set)
    const resolveProvider = (key: string | null | undefined): string => {
        if (!key) return 'gemini';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return (config.provider as string) || 'gemini';
    };

    const apiKey: string | null = (config.apiKey as string) || null;
    const provider: string = resolveProvider(apiKey);
    const model: string = apiKey ? (config.model || 'anthropic/claude-sonnet-4.6') : 'robinpath-default';
    const modelShort: string = model === 'robinpath-default' ? 'gemini-2.0-flash (free)' : (model.includes('/') ? model.split('/').pop()! : model);

    // Build CLI context to send to brain
    const cliContext: Record<string, unknown> = {
        platform: platform(),
        shell: getShellConfig().name,
        cwd: process.cwd(),
        cliVersion: CLI_VERSION,
        nativeModules: nativeModules.map((m: NativeModule) => m.name),
        installedModules: Object.keys(readModulesManifest()),
    };

    // Session management
    let sessionId: string = resumeSessionId || randomUUID().slice(0, 8);
    let sessionName: string = `session-${new Date().toISOString().slice(0, 10)}`;

    // Token usage tracking
    const usage: UsageTracker = createUsageTracker();

    // Conversation messages — no system prompt needed, brain handles it server-side
    const conversationMessages: Message[] = [];

    // Inject memory context as first user context if available
    const memContext: string = buildMemoryContext();
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
    const modeStr: string = devMode ? 'dev (auto+verbose)' : autoAccept ? 'auto' : 'confirm';
    const modeColor: (s: string) => string = devMode ? color.yellow : autoAccept ? color.yellow : color.green;
    // Shorten cwd for display
    const cwdDisplay: string = process.cwd().replace(homedir(), '~');
    const cwdShort: string = cwdDisplay.length > 40 ? '...' + cwdDisplay.slice(-37) : cwdDisplay;

    log(color.dim('  \u256d' + '\u2500'.repeat(50) + '\u256e'));
    log(color.dim('  \u2502') + color.bold('  RobinPath AI') + ' '.repeat(36) + color.dim('\u2502'));
    log(color.dim('  \u2502') + `  Model: ${color.cyan(modelShort)}` + ' '.repeat(Math.max(0, 41 - modelShort.length)) + color.dim('\u2502'));
    log(color.dim('  \u2502') + `  Mode:  ${modeColor(modeStr)}` + ' '.repeat(Math.max(0, 41 - modeStr.length)) + color.dim('\u2502'));
    log(color.dim('  \u2502') + `  Dir:   ${color.dim(cwdShort)}` + ' '.repeat(Math.max(0, 41 - cwdShort.length)) + color.dim('\u2502'));
    log(color.dim('  \u2570' + '\u2500'.repeat(50) + '\u256f'));
    log('');

    // Auto-scan: lightweight project context on startup (like Cursor)
    try {
        const cwd: string = process.cwd();
        const entries: string[] = readdirSync(cwd).filter((e: string) => !e.startsWith('.'));
        const dirs: string[] = [];
        const rpFiles: string[] = [];
        const keyFiles: string[] = [];
        for (const entry of entries.slice(0, 100)) {
            try {
                const full: string = join(cwd, entry);
                const s = statSync(full);
                if (s.isDirectory() && !['node_modules', '__pycache__', 'dist', 'build', '.git'].includes(entry)) {
                    dirs.push(entry);
                } else if (entry.endsWith('.rp') || entry.endsWith('.robin')) {
                    rpFiles.push(entry);
                } else if (['robinpath.json', 'package.json', 'README.md'].includes(entry)) {
                    keyFiles.push(entry);
                }
            } catch {}
        }
        if (rpFiles.length > 0 || dirs.length > 0 || keyFiles.length > 0) {
            let scanCtx = `[Project context \u2014 ${cwd}]\n`;
            if (dirs.length > 0) scanCtx += `Directories: ${dirs.join(', ')}\n`;
            if (rpFiles.length > 0) {
                scanCtx += `RobinPath files: ${rpFiles.join(', ')}\n`;
                for (const f of rpFiles.slice(0, 5)) {
                    try {
                        const content = readFileSync(join(cwd, f), 'utf-8');
                        if (content.length < 3000) scanCtx += `\n--- ${f} ---\n${content}\n`;
                    } catch {}
                }
            }
            if (keyFiles.length > 0) scanCtx += `Key files: ${keyFiles.join(', ')}\n`;
            const rpJson: string = join(cwd, 'robinpath.json');
            if (existsSync(rpJson)) {
                try { scanCtx += `\nrobinpath.json:\n${readFileSync(rpJson, 'utf-8')}\n`; } catch {}
            }
            conversationMessages.push({ role: 'user', content: scanCtx });
            conversationMessages.push({ role: 'assistant', content: 'Project context loaded.' });
            log(color.dim(`  Project: ${rpFiles.length} .rp file(s), ${dirs.length} dir(s)`));
            log('');
        }
    } catch {}

    const history: string[] = [];
    try {
        const histPath: string = join(getRobinPathHome(), 'ai-history');
        if (existsSync(histPath)) {
            const lines: string[] = readFileSync(histPath, 'utf-8').split('\n').filter(Boolean);
            history.push(...lines.slice(-500));
        }
    } catch { /* ignore */ }

    // Slash command tab completion
    const slashCommands: string[] = [
        '/help', '/model', '/auto', '/clear', '/compact',
        '/save', '/sessions', '/resume', '/delete',
        '/memory', '/remember', '/forget',
        '/tools', '/modules', '/context', '/usage', '/scan',
    ];
    function completer(line: string): [string[], string] {
        if (line.startsWith('/')) {
            const hits = slashCommands.filter((c: string) => c.startsWith(line));
            return [hits.length ? hits : slashCommands, line];
        }
        return [[], line];
    }

    const rl: ReadlineInterface = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: color.cyan('\u276f '),
        history,
        historySize: 500,
        completer,
    } as any);

    function saveHistory(line: string): void {
        try {
            const histPath: string = join(getRobinPathHome(), 'ai-history');
            appendFileSync(histPath, line + '\n', 'utf-8');
        } catch { /* ignore */ }
    }

    // If initial prompt was provided (rp ai "question"), simulate input
    if (initialPrompt) {
        setTimeout(() => rl.write(initialPrompt + '\n'), 50);
    } else if (!resumeSessionId) {
        log(color.dim('  Type a message, /help for commands, Tab to complete'));
    }

    rl.prompt();

    rl.on('line', async (line: string) => {
        const trimmed: string = line.trim();
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
            log(color.dim('  \u2500\u2500 Conversation \u2500\u2500'));
            log('  /clear         Clear conversation history');
            log('  /compact       Trim conversation to last 10 messages');
            log(color.dim('  \u2500\u2500 Sessions \u2500\u2500'));
            log('  /save [name]   Save current session');
            log('  /sessions      List saved sessions');
            log('  /resume <id>   Resume a saved session');
            log('  /delete <id>   Delete a saved session');
            log(color.dim('  \u2500\u2500 Memory \u2500\u2500'));
            log('  /memory        Show persistent memory');
            log('  /remember <x>  Save a fact across sessions');
            log('  /forget <n>    Remove a memory by number');
            log(color.dim('  \u2500\u2500 Permissions \u2500\u2500'));
            log('  /auto          Toggle auto-accept mode');
            log('  /auto on|off   Enable/disable auto-accept');
            log(color.dim('  \u2500\u2500 Info \u2500\u2500'));
            log('  /model         Switch model (interactive picker)');
            log('  /model <id>    Switch model by ID');
            log('  /tools         List available tools');
            log('  /modules       Show installed modules');
            log('  /context       Show what the AI knows about your setup');
            log('  /usage         Show token usage this session');
            log('  /scan          Scan project files for AI context');
            log(color.dim('  \u2500\u2500'));
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
            // Show numbered model list — no raw mode, uses readline (safe)
            const hasKey: boolean = !!(readAiConfig().apiKey);
            const models: ModelInfo[] = hasKey ? AI_MODELS : AI_MODELS.filter((m: ModelInfo) => !m.requiresKey);
            const currentModel: string = readAiConfig().model || model;
            log('');
            let lastGroup = '';
            for (let i = 0; i < models.length; i++) {
                const m: ModelInfo = models[i];
                if (m.group !== lastGroup) {
                    log(color.dim(`  \u2500\u2500 ${m.group} \u2500\u2500`));
                    lastGroup = m.group;
                }
                const cur: string = m.id === currentModel ? color.green(' \u2713') : '';
                const num: string = color.cyan(`${i + 1}`);
                log(`  ${num}. ${m.name} ${color.dim(`\u2014 ${m.desc}`)}${cur}`);
            }
            log('');
            const answer: string = await new Promise((resolve) => {
                rl.question(color.dim('  Enter number (or press Enter to cancel): '), resolve);
            });
            const idx: number = parseInt(answer, 10) - 1;
            if (idx >= 0 && idx < models.length) {
                config.model = models[idx].id;
                writeAiConfig(config);
                log(color.green('Model changed:') + ` ${color.cyan(models[idx].id)}`);
                log(color.dim('(takes effect on next message)'));
            } else {
                log(`Current model: ${color.cyan(currentModel)}`);
            }
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/model ')) {
            const newModel: string = trimmed.slice(7).trim();
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
            log(`  ${color.cyan('robinpath <file.rp>')}    Run .rp scripts`);
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/modules') {
            const mf = readModulesManifest();
            const names: string[] = Object.keys(mf);
            log('');
            log(color.bold(`  Native modules (${nativeModules.length}):`));
            log('  ' + nativeModules.map((m: NativeModule) => color.cyan(m.name)).join(', '));
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
            const installedNames: string[] = Object.keys(mf);
            const msgCount: number = conversationMessages.length - 1; // minus system prompt
            log('');
            log(color.bold('  AI Context:'));
            log(`  Model:              ${color.cyan(readAiConfig().model || model)}`);
            log(`  Working dir:        ${color.cyan(process.cwd())}`);
            log(`  Platform:           ${platform()}`);
            log(`  CLI version:        ${CLI_VERSION}`);
            log(`  Native modules:     ${nativeModules.length}`);
            log(`  Installed modules:  ${installedNames.length}${installedNames.length > 0 ? ' (' + installedNames.map((n: string) => n.replace('@robinpath/', '')).join(', ') + ')' : ''}`);
            log(`  Conversation:       ${msgCount} message${msgCount !== 1 ? 's' : ''}`);
            log(`  Brain:              ${AI_BRAIN_URL}`);
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/compact') {
            const beforeCount: number = conversationMessages.length - 1;
            const beforeTokens: number = estimateTokens(conversationMessages);
            const compacted: boolean = await autoCompact(conversationMessages);
            if (compacted) {
                const afterCount: number = conversationMessages.length - 1;
                const afterTokens: number = estimateTokens(conversationMessages);
                log(color.green(`Compacted: ${beforeCount} messages (~${Math.round(beforeTokens / 1000)}k tokens) \u2192 ${afterCount} messages (~${Math.round(afterTokens / 1000)}k tokens)`));
            } else if (conversationMessages.length > 11) {
                // Fallback: simple truncation if brain is unreachable
                const system: Message = conversationMessages[0];
                const recent: Message[] = conversationMessages.slice(-10);
                conversationMessages.length = 0;
                conversationMessages.push(system, ...recent);
                log(color.green(`Trimmed to ${recent.length} recent messages.`));
            } else {
                log(color.dim('Conversation is already short \u2014 nothing to compact.'));
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
                memory.facts.forEach((f: string, i: number) => log(`  ${color.dim(String(i + 1) + '.')} ${f}`));
                log('');
                log(color.dim(`  ${memory.facts.length} facts \u2014 loaded into every conversation`));
            }
            log('');
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/remember ')) {
            const fact: string = trimmed.slice(10).trim();
            if (fact) {
                const added: boolean = addMemoryFact(fact);
                if (added) {
                    log(color.green(`Remembered: "${fact}"`));
                    // Memory is sent to Brain via conversationHistory — no local system prompt needed
                } else {
                    log(color.dim('Already remembered.'));
                }
            }
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/forget ')) {
            const idx: number = parseInt(trimmed.slice(8).trim(), 10) - 1;
            const removed: string | null = removeMemoryFact(idx);
            if (removed) {
                log(color.green(`Forgot: "${removed}"`));
            } else {
                log(color.red('Invalid memory number. Use /memory to see the list.'));
            }
            rl.prompt();
            return;
        }

        // --- Session commands ---
        if (trimmed === '/save' || trimmed.startsWith('/save ')) {
            const customName: string = trimmed.slice(5).trim();
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
                    const active: string = s.id === sessionId ? color.green(' \u25c0 current') : '';
                    const age: number = Math.round((Date.now() - new Date(s.updated).getTime()) / 60000);
                    const ageStr: string = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
                    log(`  ${color.cyan(s.id)}  ${s.name}  ${color.dim(`${s.messages} msgs, ${ageStr}`)}${active}`);
                }
                log('');
                log(color.dim('  Resume with: /resume <id>'));
            }
            log('');
            rl.prompt();
            return;
        }

        if (trimmed === '/resume' || trimmed.startsWith('/resume ')) {
            let targetId: string = trimmed.slice(8).trim();
            if (!targetId) {
                // Show numbered session list — no raw mode, uses readline (safe)
                const sessions = listSessions();
                if (sessions.length === 0) {
                    log(color.dim('  No saved sessions.'));
                    rl.prompt();
                    return;
                }
                log('');
                for (let i = 0; i < sessions.length; i++) {
                    const s = sessions[i];
                    const diff: number = Date.now() - new Date(s.updated || s.created).getTime();
                    const mins: number = Math.floor(diff / 60000);
                    const ago: string = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
                    log(`  ${color.cyan(String(i + 1))}. ${s.name}  ${color.dim(`${ago}, ${s.messages} msgs`)}`);
                }
                log('');
                const answer: string = await new Promise((resolve) => {
                    rl.question(color.dim('  Enter number (or press Enter to cancel): '), resolve);
                });
                const idx: number = parseInt(answer, 10) - 1;
                if (idx >= 0 && idx < sessions.length) {
                    targetId = sessions[idx].id;
                } else {
                    rl.prompt();
                    return;
                }
            }
            const session = loadSession(targetId);
            if (!session) {
                log(color.red(`Session '${targetId}' not found.`));
            } else {
                sessionId = session.id;
                sessionName = session.name;
                // Rebuild conversation — Brain handles system prompt server-side
                conversationMessages.length = 0;
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
            const targetId: string = trimmed.slice(8).trim();
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
            if (usage.cost > 0) {
                log(`  Est. cost:         ${color.yellow('$' + usage.cost.toFixed(4))}`);
            } else {
                log(`  Est. cost:         ${color.green('$0.00 (free tier)')}`);
            }
            log('');
            rl.prompt();
            return;
        }

        // --- Scan project files ---
        if (trimmed === '/scan') {
            const spinner = createSpinner('Scanning project...');
            try {
                const cwd: string = process.cwd();
                const entries: string[] = readdirSync(cwd);
                const rpFiles: ScannedFile[] = [];
                const otherFiles: ScannedFile[] = [];
                const dirs: string[] = [];

                for (const entry of entries.slice(0, 200)) {
                    try {
                        const full: string = join(cwd, entry);
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
                        const subEntries: string[] = readdirSync(join(cwd, dir));
                        for (const sub of subEntries) {
                            if (sub.endsWith('.rp') || sub.endsWith('.robin')) {
                                rpFiles.push({ name: `${dir}/${sub}`, size: statSync(join(cwd, dir, sub)).size });
                            }
                        }
                    } catch { /* skip */ }
                }

                spinner.stop();

                // Build context and inject into conversation
                let scanContext = `[Project Scan \u2014 ${cwd}]\n`;
                scanContext += `Directories: ${dirs.join(', ') || '(none)'}\n`;
                if (rpFiles.length > 0) {
                    scanContext += `\nRobinPath files (${rpFiles.length}):\n`;
                    for (const f of rpFiles.slice(0, 30)) {
                        scanContext += `  ${f.name} (${(f.size / 1024).toFixed(1)}KB)\n`;
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
                    scanContext += `\nOther files: ${otherFiles.map((f: ScannedFile) => f.name).join(', ')}\n`;
                }
                // Read robinpath.json if exists
                const rpJson: string = join(cwd, 'robinpath.json');
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
            } catch (err: any) {
                spinner.stop();
                log(color.red(`  Scan error: ${err.message}`));
            }
            rl.prompt();
            return;
        }

        if (trimmed === '/auto' || trimmed.startsWith('/auto ')) {
            const arg: string = trimmed.slice(5).trim().toLowerCase();
            if (arg === 'on') {
                autoAccept = true;
            } else if (arg === 'off') {
                autoAccept = false;
            } else {
                autoAccept = !autoAccept;
            }
            const status: string = autoAccept ? color.green('ON') : color.yellow('OFF');
            log(`  Auto-accept: ${status}`);
            if (autoAccept) {
                log(color.dim('  Commands run automatically (dangerous commands still confirm)'));
            }
            rl.prompt();
            return;
        }

        saveHistory(trimmed);

        const activeModel: string = readAiConfig().model || model;
        const activeKey: string | null = (readAiConfig().apiKey as string) || apiKey;
        const activeProvider: string = resolveProvider(activeKey);

        let spinner = createSpinner('Thinking...');

        try {
            // Add user message to history
            conversationMessages.push({ role: 'user', content: trimmed });

            // Auto-compact if conversation is getting long
            const didCompact: boolean = await autoCompact(conversationMessages);
            if (didCompact) logVerbose('Conversation auto-compacted');

            // Tags to intercept from streamed output
            const HIDDEN_TAGS: string[] = ['<memory>', '</memory>', '<cmd>', '</cmd>'];

            for (let loopCount = 0; loopCount < 15; loopCount++) {
                // Stream from brain with provider/model/apiKey passthrough
                let pending = '';
                let insideMemory = false;
                let insideCmd = false;

                const brainResult: BrainStreamResult | null = await fetchBrainStream(
                    loopCount === 0 ? trimmed : conversationMessages[conversationMessages.length - 1].content as string,
                    {
                        onToken: (delta: string) => {
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
                            // Simple approach: flush everything except content inside tags
                            while (true) {
                                if (insideMemory) {
                                    const closeIdx: number = pending.indexOf('</memory>');
                                    if (closeIdx === -1) break; // wait for closing tag
                                    const fact: string = pending.slice(0, closeIdx).trim();
                                    if (fact.length > 3 && fact.length < 300) {
                                        addMemoryFact(fact);
                                        logVerbose(`Memory saved: ${fact}`);
                                    }
                                    pending = pending.slice(closeIdx + 9);
                                    insideMemory = false;
                                    continue;
                                }
                                if (insideCmd) {
                                    const closeIdx: number = pending.indexOf('</cmd>');
                                    if (closeIdx === -1) break; // wait for closing tag
                                    pending = pending.slice(closeIdx + 6);
                                    insideCmd = false;
                                    continue;
                                }

                                // Look for tag openings
                                const memIdx: number = pending.indexOf('<memory>');
                                const cmdIdx: number = pending.indexOf('<cmd>');

                                // No tags at all — check for partial tag at the end
                                if (memIdx === -1 && cmdIdx === -1) {
                                    const ltIdx: number = pending.lastIndexOf('<');
                                    if (ltIdx !== -1 && ltIdx > pending.length - 9) {
                                        if (ltIdx > 0) {
                                            process.stdout.write(pending.slice(0, ltIdx).replace(/\n{3,}/g, '\n\n'));
                                            pending = pending.slice(ltIdx);
                                        }
                                    } else {
                                        process.stdout.write(pending.replace(/\n{3,}/g, '\n\n'));
                                        pending = '';
                                    }
                                    break;
                                }

                                // Found a tag — flush text before it, then enter tag mode
                                const firstTag: number = memIdx === -1 ? cmdIdx : cmdIdx === -1 ? memIdx : Math.min(memIdx, cmdIdx);
                                if (firstTag > 0) {
                                    process.stdout.write(pending.slice(0, firstTag).replace(/\n{3,}/g, '\n\n'));
                                }
                                if (firstTag === memIdx) {
                                    pending = pending.slice(firstTag + 8);
                                    insideMemory = true;
                                } else {
                                    pending = pending.slice(firstTag + 5);
                                    insideCmd = true;
                                }
                            }
                        },
                        conversationHistory: conversationMessages.slice(0, -1),
                        provider: activeProvider,
                        model: activeModel,
                        apiKey: activeKey || undefined,
                        cliContext: cliContext as any,
                    },
                );

                // Flush remaining display buffer
                if (pending.length > 0 && !insideMemory && !insideCmd) {
                    process.stdout.write(pending);
                }

                if (!brainResult || !brainResult.code) {
                    spinner.stop();
                    log(color.red('\n  Brain returned no response. Check your connection or API key.'));
                    break;
                }

                // Track usage
                if (brainResult.usage) {
                    const usageData = brainResult.usage as Record<string, number>;
                    const pt: number = usageData.prompt_tokens || 0;
                    const ct: number = usageData.completion_tokens || 0;
                    usage.promptTokens += pt;
                    usage.completionTokens += ct;
                    usage.totalTokens += pt + ct;
                    usage.requests++;
                    const activeModelForCost: string = readAiConfig().model || model;
                    usage.cost += estimateCost(activeModelForCost, pt, ct);
                }

                // Extract commands and clean the response
                const commands: string[] = extractCommands(brainResult.code);
                const { cleaned } = extractMemoryTags(stripCommandTags(brainResult.code));

                // Clean up trailing blank lines from streaming
                process.stdout.write('\x1b[0G'); // move cursor to column 0
                process.stdout.write('\n');

                // Warn if code validation failed
                const validation = brainResult.validation as Record<string, any> | null;
                if (validation && !validation.valid && validation.errors?.length > 0) {
                    const errCount: number = validation.errors.length;
                    const retries: number = validation.retryCount || 0;
                    log(color.yellow(`  Warning: generated code has ${errCount} syntax issue${errCount > 1 ? 's' : ''}${retries > 0 ? ` (after ${retries} auto-fix attempt${retries > 1 ? 's' : ''})` : ''}.`));
                    for (const e of validation.errors.slice(0, 3)) {
                        log(color.dim(`    Line ${e.line}: ${e.error}`));
                    }
                    log('');
                }

                // Store assistant message
                if (cleaned) {
                    conversationMessages.push({ role: 'assistant', content: cleaned });
                }

                logVerbose(`Brain: intent=${(brainResult.context as Record<string, any>)?.intent || '?'}, docs=${(brainResult.context as Record<string, any>)?.documentsUsed || 0}`);

                // If no commands, we're done
                if (commands.length === 0) {
                    // Auto-detect module install suggestions
                    if (cleaned) {
                        const installMatch: RegExpMatchArray | null = cleaned.match(/robinpath add (@robinpath\/[\w-]+)/g);
                        if (installMatch) {
                            const manifest = readModulesManifest();
                            for (const match of installMatch) {
                                const pkg: string = match.replace('robinpath add ', '');
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

                // Execute each shell command with permission check
                const cmdResults: CommandResult[] = [];
                rl.pause();
                for (let ci = 0; ci < commands.length; ci++) {
                    let cmd: string = commands[ci];

                    // Diff preview: if command writes to an existing file, show what will change
                    const writeTarget: string | null = detectFileWrite(cmd);
                    if (writeTarget) {
                        try {
                            const targetPath: string = join(process.cwd(), writeTarget);
                            if (existsSync(targetPath)) {
                                const oldContent: string = readFileSync(targetPath, 'utf-8');
                                log(color.dim(`  File exists: ${writeTarget} (${oldContent.split('\n').length} lines)`));
                            }
                        } catch { /* skip — file might not be readable */ }
                    }

                    // Permission check
                    const decision: ConfirmResult = await confirmCommand(cmd, autoAccept);

                    if (decision === 'no') {
                        const preview: string = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
                        log(color.dim(`  \u23ed Skipped: ${preview}`));
                        cmdResults.push({ command: cmd, stdout: '', stderr: '(skipped by user)', exitCode: -1 });
                        continue;
                    }

                    if (decision === 'auto') {
                        autoAccept = true;
                        log(color.green('  \u2713 Auto-accept enabled for this session'));
                    }

                    if (decision === 'edit') {
                        // Let user edit the command
                        const editRl: ReadlineInterface = createInterface({ input: process.stdin, output: process.stdout });
                        cmd = await new Promise<string>((resolve) => {
                            editRl.question(color.cyan('  Edit: '), (answer: string) => {
                                editRl.close();
                                resolve(answer.trim() || cmd);
                            });
                            editRl.write(cmd);
                        });
                        // Re-confirm if edited command is dangerous
                        if (isDangerousCommand(cmd)) {
                            const recheck: ConfirmResult = await confirmCommand(cmd, false);
                            if (recheck === 'no') {
                                cmdResults.push({ command: cmd, stdout: '', stderr: '(skipped by user)', exitCode: -1 });
                                continue;
                            }
                        }
                    }

                    if (decision !== 'yes' && decision !== 'auto' && decision !== 'edit') {
                        continue;
                    }

                    // Snapshot file before execution for diff preview
                    let preContent: string | null = null;
                    const diffTarget: string | null = detectFileWrite(cmd);
                    if (diffTarget) {
                        try {
                            const targetPath: string = join(process.cwd(), diffTarget);
                            if (existsSync(targetPath)) preContent = readFileSync(targetPath, 'utf-8');
                        } catch {}
                    }

                    const cmdPreview: string = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
                    if (!autoAccept || isDangerousCommand(cmd)) {
                        log(color.dim(`  \u25b6 ${cmdPreview}`));
                    }

                    const result = await executeShellCommand(cmd);

                    // Show result status
                    if (result.exitCode === 0) {
                        // Show diff after file write
                        if (diffTarget) {
                            try {
                                const targetPath: string = join(process.cwd(), diffTarget);
                                if (existsSync(targetPath)) {
                                    const postContent: string = readFileSync(targetPath, 'utf-8');
                                    showFileDiff(diffTarget, preContent, postContent);
                                }
                            } catch {}
                        }
                        // If no stdout was streamed, show "done"
                        if (!(result.stdout || '').trim()) {
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
                rl.resume();

                // Feed command results back for next iteration
                const resultSummary: string = cmdResults.map((r: CommandResult) => {
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
        } catch (err: any) {
            spinner.stop();
            log('');
            console.error(color.red('Error:') + ` ${err.message}`);
        }

        log('');
        rl.prompt();
    });

    function exitWithSave(): void {
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

// ============================================================================
// handleAi()  — lines 8221–8260
// ============================================================================

export async function handleAi(args: string[]): Promise<void> {
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
                const age: number = Math.round((Date.now() - new Date(s.updated).getTime()) / 60000);
                const ageStr: string = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
                log(`  ${s.id}  ${s.name}  (${s.messages} msgs, ${ageStr})`);
            }
            log(`\nResume with: robinpath ai --resume <id>`);
        }
        return;
    }

    // robinpath ai --resume <id>
    const resumeIdx: number = args.indexOf('--resume');
    if (resumeIdx !== -1) {
        const resumeId: string | undefined = args[resumeIdx + 1];
        if (!resumeId) {
            log('Usage: robinpath ai --resume <session-id>');
            return;
        }
        await startAiREPL(null, resumeId, { autoAccept: FLAG_AUTO_ACCEPT, devMode: FLAG_DEV_MODE });
        return;
    }

    // robinpath ai "prompt" (one-shot mode)
    const prompt: string = args.join(' ').trim();
    await startAiREPL(prompt || null, null, { autoAccept: FLAG_AUTO_ACCEPT, devMode: FLAG_DEV_MODE });
}

// ============================================================================
// handleHeadlessPrompt()  — lines 8272–8340
// ============================================================================

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
export async function handleHeadlessPrompt(
    prompt: string,
    opts: { save?: boolean; run?: boolean; outFile?: string | null } = {},
): Promise<void> {
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
        const isSaveOrRun: boolean = save || run;

        if (isSaveOrRun) {
            // For --save/--run, collect full response (need the code block)
            const brainResult: BrainStreamResult | null = await fetchBrainStream(enriched.enrichedPrompt);

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
            const brainResult: BrainStreamResult | null = await fetchBrainStream(enriched.enrichedPrompt, {
                onToken: (delta: string) => {
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
    } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

// ============================================================================
// handleSaveRun()  — lines 8342–8375
// ============================================================================

export async function handleSaveRun(
    content: string,
    prompt: string,
    { save, run, outFile }: { save: boolean; run: boolean; outFile: string | null },
): Promise<void> {
    const codeMatch: RegExpMatchArray | null = content.match(/```(?:robinpath|robin|rp|js|javascript)?\s*\n([\s\S]*?)```/);
    const codeBlock: string | null = codeMatch ? codeMatch[1].trim() : null;

    if (codeBlock) {
        const fs = await import('node:fs');
        const path = await import('node:path');

        let fileName: string | null = outFile;
        if (!fileName) {
            const slug: string = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 50);
            fileName = `${slug}.rp`;
        }
        if (!fileName.endsWith('.rp')) fileName += '.rp';

        const fullPath: string = path.default.resolve(fileName);
        fs.default.writeFileSync(fullPath, codeBlock + '\n');
        console.error(`Saved: ${fullPath}`);

        if (run) {
            console.error(`Running: ${fileName}\n`);
            await runScript(codeBlock, fullPath);
        } else {
            console.log(content);
        }
    } else {
        console.error('No RobinPath code block found in response \u2014 printing raw output');
        console.log(content);
    }
}
