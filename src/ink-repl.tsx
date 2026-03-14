/**
 * Ink-based AI REPL — uses React for input, stdout for output.
 *
 * Pattern: render Ink for input → unmount → process with stdout → re-render.
 * This avoids the Ink/stdout conflict that causes garbled rendering.
 */
import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { color, log, getShellConfig, getAvailableShells, setShellOverride, getRobinPathHome, CLI_VERSION, setFlags, createSpinner, logVerbose } from './utils';
import { readAiConfig, writeAiConfig, AI_BRAIN_URL } from './config';
import type { AiConfig } from './config';
import { AI_MODELS, createUsageTracker, estimateCost } from './models';
import type { UsageTracker, ModelInfo } from './models';
import {
    saveSession, loadSession, listSessions, buildMemoryContext,
    extractMemoryTags, addMemoryFact, removeMemoryFact, loadMemory,
    autoCompact, estimateTokens, saveSession as saveSess, deleteSession,
} from './sessions';
import type { Message } from './sessions';
import { expandFileRefs } from './file-refs';
import { fetchBrainStream } from './brain';
import type { BrainStreamResult } from './brain';
import { executeShellCommand, extractCommands, stripCommandTags, detectFileWrite, showFileDiff } from './shell';
import { isDangerousCommand, confirmCommand } from './ui';
import type { ConfirmResult } from './ui';
import { readModulesManifest } from './commands-core';
import { getNativeModules } from './runtime';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Ink Input Component ──
function InputPrompt({ placeholder, onSubmit, onExit }: {
    placeholder: string;
    onSubmit: (v: string) => void;
    onExit: () => void;
}) {
    const [value, setValue] = useState('');
    const { exit } = useApp();

    useInput((input, key) => {
        if (key.return) {
            if (value.endsWith('\\')) { setValue(p => p.slice(0, -1) + '\n'); return; }
            const text = value.trim();
            if (text) { exit(); onSubmit(text); }
            return;
        }
        if (input === '\n') { setValue(p => p + '\n'); return; }
        if (key.escape) { setValue(''); return; }
        if (input === '\x03') { if (!value) { exit(); onExit(); } else setValue(''); return; }
        if (key.backspace || key.delete) { setValue(p => p.slice(0, -1)); return; }
        if (key.tab) return;
        if (input === '\x15') { setValue(''); return; }
        if (input === '\x17') { setValue(p => p.replace(/\S+\s*$/, '')); return; }
        if (input && !key.ctrl && !key.meta) setValue(p => p + input);
    });

    const lines = value.split('\n');
    const empty = value === '';

    return (
        <Box flexDirection="column">
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginX={1}>
                {empty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>{line}{i === lines.length - 1 ? <Text color="cyan">█</Text> : null}</Text>
                    ))
                )}
            </Box>
            <Box marginX={2}>
                <Text dimColor>enter send · \ newline · esc clear · / commands</Text>
            </Box>
        </Box>
    );
}

/** Show Ink input and wait for submission. Returns text or null (exit). */
function collectInkInput(placeholder: string): Promise<string | null> {
    if (!process.stdin.isTTY) {
        return Promise.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
        let resolved = false;
        const { waitUntilExit } = render(
            <InputPrompt
                placeholder={placeholder}
                onSubmit={(v) => { if (!resolved) { resolved = true; resolve(v); } }}
                onExit={() => { if (!resolved) { resolved = true; resolve(null); } }}
            />,
        );
        waitUntilExit().then(() => { if (!resolved) { resolved = true; resolve(null); } });
    });
}

// ── ASCII Logo ──
function printBanner(modelShort: string, modeStr: string, cwdShort: string, shellName: string) {
    log('');
    log(`  ${color.cyan('◆')} ${color.bold('RobinPath')} ${color.dim('v' + CLI_VERSION)}`);
    log(color.dim(`  ${modelShort} · ${shellName} · ${modeStr}`));
    log('');
}

// ── Main REPL ──
interface InkReplOptions { autoAccept?: boolean; devMode?: boolean; }

export async function startInkREPL(
    initialPrompt: string | null,
    resumeSessionId: string | null,
    opts: InkReplOptions = {},
): Promise<void> {
    const config: AiConfig = readAiConfig();
    let autoAccept = opts.autoAccept || false;
    const devMode = opts.devMode || false;
    if (devMode) setFlags({ verbose: true });

    const resolveProvider = (key: string | null | undefined): string => {
        if (!key) return 'gemini';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return (config.provider as string) || 'gemini';
    };

    const apiKey = (config.apiKey as string) || null;
    const provider = resolveProvider(apiKey);
    const model = apiKey ? config.model || 'anthropic/claude-sonnet-4.6' : 'robinpath-default';
    const modelShort = model === 'robinpath-default'
        ? 'gemini-2.0-flash (free)'
        : model.includes('/') ? model.split('/').pop()! : model;

    const cliContext: Record<string, unknown> = {
        platform: platform(), shell: getShellConfig().name,
        cwd: process.cwd(), cliVersion: CLI_VERSION,
        nativeModules: getNativeModules().map((m: any) => m.name),
        installedModules: Object.keys(readModulesManifest()),
    };

    let sessionId = resumeSessionId || randomUUID().slice(0, 8);
    let sessionName = `session-${new Date().toISOString().slice(0, 10)}`;
    const usage: UsageTracker = createUsageTracker();
    const conversationMessages: Message[] = [];
    const history: string[] = [];

    const memContext = buildMemoryContext();
    if (memContext.trim()) {
        conversationMessages.push({ role: 'user', content: `[Context] ${memContext.trim()}` });
        conversationMessages.push({ role: 'assistant', content: 'Got it, I have your preferences loaded.' });
    }

    if (resumeSessionId) {
        const session = loadSession(resumeSessionId);
        if (session) {
            sessionName = session.name;
            for (const msg of session.messages) conversationMessages.push(msg);
            if (session.usage) {
                usage.promptTokens = session.usage.promptTokens || 0;
                usage.completionTokens = session.usage.completionTokens || 0;
                usage.totalTokens = session.usage.totalTokens || 0;
                usage.requests = session.usage.requests || 0;
            }
            log(color.green(`  Resumed: ${sessionName} (${session.messages.length} msgs)`));
        }
    }

    const modeStr = devMode ? 'dev' : autoAccept ? 'auto' : 'confirm';
    const cwdShort = process.cwd().replace(homedir(), '~');
    printBanner(modelShort, modeStr, cwdShort, getShellConfig().name);

    // Auto-scan
    try {
        const entries = readdirSync(process.cwd()).filter(e => !e.startsWith('.'));
        let rpCount = 0, dirCount = 0;
        for (const e of entries.slice(0, 100)) {
            try {
                const s = statSync(join(process.cwd(), e));
                if (s.isDirectory() && !['node_modules','__pycache__','dist','build'].includes(e)) dirCount++;
                else if (e.endsWith('.rp') || e.endsWith('.robin')) rpCount++;
            } catch {}
        }
        if (rpCount > 0 || dirCount > 0) log(color.dim(`  ${rpCount} .rp file(s), ${dirCount} dir(s)`));
    } catch {}

    let isFirst = !resumeSessionId && !initialPrompt;

    // ── REPL Loop ──
    while (true) {
        let trimmed: string;

        if (initialPrompt) {
            trimmed = initialPrompt.trim();
            initialPrompt = null;
            log(color.cyan('  ❯ ') + trimmed);
        } else {
            const input = await collectInkInput(
                isFirst ? 'What do you want to automate?' : 'Ask anything...'
            );
            isFirst = false;
            if (input === null) { exitWithSave(); break; }
            trimmed = input.trim();
            if (!trimmed) continue;
            // Echo the input
            log(color.cyan('  ❯ ') + color.bold(trimmed));
        }

        // ── Slash commands (handled with stdout, no Ink) ──
        if (trimmed === '/') {
            log('');
            for (const [cmd, desc] of Object.entries(SLASH_CMDS)) {
                log(`  ${color.cyan(cmd.padEnd(14))} ${color.dim(desc)}`);
            }
            log('');
            continue;
        }
        if (trimmed === 'exit' || trimmed === 'quit') { exitWithSave(); break; }
        if (trimmed === '/help') {
            log('');
            for (const [cmd, desc] of Object.entries(SLASH_CMDS)) {
                log(`  ${color.cyan(cmd.padEnd(14))} ${color.dim(desc)}`);
            }
            log('');
            continue;
        }
        if (trimmed === '/clear') { conversationMessages.length = 0; log(color.green('  Cleared.')); continue; }
        if (trimmed === '/usage') {
            const cost = usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : '$0.00 (free)';
            log(`  ${usage.totalTokens.toLocaleString()} tokens · ${usage.requests} requests · ${cost}`);
            continue;
        }
        if (trimmed === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const cur = readAiConfig().model || model;
            log('');
            let lastGroup = '';
            for (let i = 0; i < models.length; i++) {
                const m = models[i];
                if (m.group !== lastGroup) { log(color.dim(`  ── ${m.group} ──`)); lastGroup = m.group; }
                const mark = m.id === cur ? color.green(' ✓') : '';
                log(`  ${color.cyan(String(i+1))}. ${m.name} ${color.dim('— ' + m.desc)}${mark}`);
            }
            log('');
            // Use collectInkInput for model selection
            const answer = await collectInkInput('Enter number...');
            if (answer) {
                const idx = parseInt(answer, 10) - 1;
                if (idx >= 0 && idx < models.length) {
                    config.model = models[idx].id;
                    writeAiConfig(config);
                    log(color.green(`  Model: ${models[idx].id}`));
                }
            }
            continue;
        }
        if (trimmed === '/auto' || trimmed.startsWith('/auto ')) {
            const arg = trimmed.slice(5).trim().toLowerCase();
            if (arg === 'on') autoAccept = true;
            else if (arg === 'off') autoAccept = false;
            else autoAccept = !autoAccept;
            log(`  Auto-accept: ${autoAccept ? color.green('ON') : color.yellow('OFF')}`);
            continue;
        }
        if (trimmed === '/memory') {
            const mem = loadMemory();
            if (mem.facts.length === 0) log(color.dim('  No memories.'));
            else mem.facts.forEach((f: string, i: number) => log(`  ${i+1}. ${f}`));
            continue;
        }
        if (trimmed.startsWith('/remember ')) { addMemoryFact(trimmed.slice(10).trim()); log(color.green('  Remembered.')); continue; }
        if (trimmed.startsWith('/forget ')) {
            removeMemoryFact(parseInt(trimmed.slice(8).trim(), 10) - 1);
            log(color.green('  Forgot.')); continue;
        }
        if (trimmed === '/save' || trimmed.startsWith('/save ')) {
            if (trimmed.length > 5) sessionName = trimmed.slice(5).trim();
            saveSession(sessionId, sessionName, conversationMessages, usage);
            log(color.green(`  Saved: ${sessionName}`)); continue;
        }
        if (trimmed === '/sessions') {
            const sessions = listSessions();
            if (sessions.length === 0) log(color.dim('  No sessions.'));
            else sessions.forEach(s => log(`  ${color.cyan(s.id)} ${s.name} ${color.dim(`${s.messages} msgs`)}`));
            continue;
        }
        if (trimmed === '/shell') {
            const shells = getAvailableShells();
            shells.forEach(s => {
                const mark = s.current ? color.green(' ✓') : s.available ? '' : color.dim(' (not found)');
                log(`  ${s.available ? color.cyan(s.name) : color.dim(s.name)}${mark}`);
            });
            continue;
        }
        if (trimmed.startsWith('/shell ')) {
            setShellOverride(trimmed.slice(7).trim());
            cliContext.shell = getShellConfig().name;
            log(`  Shell: ${color.cyan(getShellConfig().name)}`);
            continue;
        }
        if (trimmed.startsWith('/')) { log(color.dim(`  Unknown: ${trimmed}. Type / for commands.`)); continue; }

        // ── AI message ──
        const { expanded } = expandFileRefs(trimmed);
        conversationMessages.push({ role: 'user', content: expanded });
        await autoCompact(conversationMessages);

        const activeModel = readAiConfig().model || model;
        const activeKey = (readAiConfig().apiKey as string) || apiKey;
        const activeProvider = resolveProvider(activeKey);

        let spinner = createSpinner('Thinking');

        try {
            for (let loop = 0; loop < 15; loop++) {
                let pending = '';
                let insideMemory = false;
                let insideCmd = false;

                const result: BrainStreamResult | null = await fetchBrainStream(
                    loop === 0 ? expanded : conversationMessages[conversationMessages.length - 1].content as string,
                    {
                        onToken: (delta: string) => {
                            spinner.stop();
                            if (delta === '\x1b[RETRY]') { pending = ''; insideMemory = false; insideCmd = false; spinner = createSpinner('Retrying'); return; }
                            pending += delta;
                            // Flush visible text, hide <memory> and <cmd> tags
                            while (true) {
                                if (insideMemory) {
                                    const ci = pending.indexOf('</memory>');
                                    if (ci === -1) break;
                                    const fact = pending.slice(0, ci).trim();
                                    if (fact.length > 3 && fact.length < 300) addMemoryFact(fact);
                                    pending = pending.slice(ci + 9);
                                    insideMemory = false;
                                    continue;
                                }
                                if (insideCmd) {
                                    const ci = pending.indexOf('</cmd>');
                                    if (ci === -1) break;
                                    pending = pending.slice(ci + 6);
                                    insideCmd = false;
                                    continue;
                                }
                                const mi = pending.indexOf('<memory>');
                                const ci = pending.indexOf('<cmd>');
                                if (mi === -1 && ci === -1) {
                                    const lt = pending.lastIndexOf('<');
                                    if (lt !== -1 && lt > pending.length - 9) {
                                        if (lt > 0) { process.stdout.write(pending.slice(0, lt).replace(/\n{3,}/g, '\n\n')); pending = pending.slice(lt); }
                                    } else {
                                        process.stdout.write(pending.replace(/\n{3,}/g, '\n\n'));
                                        pending = '';
                                    }
                                    break;
                                }
                                const first = mi === -1 ? ci : ci === -1 ? mi : Math.min(mi, ci);
                                if (first > 0) process.stdout.write(pending.slice(0, first).replace(/\n{3,}/g, '\n\n'));
                                if (first === mi) { pending = pending.slice(first + 8); insideMemory = true; }
                                else { pending = pending.slice(first + 5); insideCmd = true; }
                            }
                        },
                        conversationHistory: conversationMessages.slice(0, -1),
                        provider: activeProvider, model: activeModel, apiKey: activeKey, cliContext,
                    },
                );

                if (pending && !insideMemory && !insideCmd) process.stdout.write(pending);

                if (!result || !result.code) { spinner.stop(); log(color.red('\n  No response.')); break; }

                if (result.usage) {
                    const pt = result.usage.prompt_tokens || 0;
                    const ct = result.usage.completion_tokens || 0;
                    usage.promptTokens += pt; usage.completionTokens += ct;
                    usage.totalTokens += pt + ct; usage.requests++;
                    usage.cost += estimateCost(activeModel, pt, ct);
                }

                const commands = extractCommands(result.code);
                const { cleaned } = extractMemoryTags(stripCommandTags(result.code));
                process.stdout.write('\n');
                if (cleaned) conversationMessages.push({ role: 'assistant', content: cleaned });
                if (commands.length === 0) break;

                // Execute commands
                const cmdResults: any[] = [];
                for (const cmd of commands) {
                    const decision: ConfirmResult = await confirmCommand(cmd, autoAccept);
                    if (decision === 'no') { cmdResults.push({ command: cmd, stdout: '', stderr: '(skipped)', exitCode: -1 }); continue; }
                    if (decision === 'auto') { autoAccept = true; log(color.green('  Auto-accept ON')); }
                    const r = await executeShellCommand(cmd);
                    if (r.exitCode !== 0) log(color.red(`  exit ${r.exitCode}: ${(r.stderr || '').slice(0, 80)}`));
                    cmdResults.push({ command: cmd, stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.exitCode });
                }

                const summary = cmdResults.map((r: any) => {
                    let o = `$ ${r.command}\n`;
                    if (r.exitCode === 0) o += r.stdout || '(no output)';
                    else { o += `Exit: ${r.exitCode}\n`; if (r.stderr) o += r.stderr; }
                    return o;
                }).join('\n\n');
                conversationMessages.push({ role: 'user', content: `[Command results]\n${summary}` });
                spinner = createSpinner('Processing');
            }
        } catch (err: any) {
            spinner.stop();
            log(color.red(`  Error: ${err.message}`));
        }

        log('');
        // Show cost after each message
        if (usage.cost > 0) log(color.dim(`  $${usage.cost.toFixed(4)} · ${usage.totalTokens.toLocaleString()} tokens`));
    }

    function exitWithSave() {
        if (conversationMessages.length > 1) {
            saveSession(sessionId, sessionName, conversationMessages, usage);
            log(color.dim(`  Session saved: ${sessionId}`));
        }
        log(color.dim('  Goodbye!'));
        process.exit(0);
    }

    process.on('SIGINT', () => { log(''); exitWithSave(); });
}

const SLASH_CMDS: Record<string, string> = {
    '/help': 'Show commands',
    '/model': 'Switch AI model',
    '/shell': 'Switch shell',
    '/auto': 'Toggle auto-accept',
    '/clear': 'Clear conversation',
    '/save': 'Save session',
    '/sessions': 'List sessions',
    '/memory': 'Show memory',
    '/remember': 'Save a fact',
    '/forget': 'Remove a memory',
    '/usage': 'Token usage & cost',
    'exit': 'Quit',
};
