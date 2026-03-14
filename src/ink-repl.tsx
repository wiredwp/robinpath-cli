/**
 * Ink-based AI REPL — single React app that stays mounted.
 *
 * Uses <Static> for completed messages (never re-renders).
 * Uses dynamic state for streaming response + input box.
 * NO direct process.stdout.write() — everything through React.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { render, Box, Text, Static, useInput, useApp, useStdout } from 'ink';
import InkSpinner from 'ink-spinner';
import { color, log, getShellConfig, getAvailableShells, setShellOverride, getRobinPathHome, CLI_VERSION, setFlags, logVerbose } from './utils';
import { readAiConfig, writeAiConfig, AI_BRAIN_URL } from './config';
import type { AiConfig } from './config';
import { AI_MODELS, createUsageTracker, estimateCost } from './models';
import type { UsageTracker, ModelInfo } from './models';
import {
    saveSession, loadSession, listSessions, buildMemoryContext,
    extractMemoryTags, addMemoryFact, removeMemoryFact, loadMemory,
    autoCompact, estimateTokens, deleteSession,
} from './sessions';
import type { Message } from './sessions';
import { expandFileRefs } from './file-refs';
import { fetchBrainStream } from './brain';
import type { BrainStreamResult } from './brain';
import { executeShellCommand, extractCommands, stripCommandTags } from './shell';
import { isDangerousCommand } from './ui';
import { readModulesManifest } from './commands-core';
import { getNativeModules } from './runtime';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ──
interface ChatMsg { id: number; role: 'user' | 'assistant' | 'info'; text: string; }

let nextId = 0;

// ── Input Component ──
function InputBox({ onSubmit, active, placeholder }: {
    onSubmit: (v: string) => void;
    active: boolean;
    placeholder: string;
}) {
    const [value, setValue] = useState('');

    useInput((input, key) => {
        if (!active) return;
        if (key.return) {
            if (value.endsWith('\\')) { setValue(p => p.slice(0, -1) + '\n'); return; }
            const text = value.trim();
            if (text) { onSubmit(text); setValue(''); }
            return;
        }
        if (input === '\n') { setValue(p => p + '\n'); return; }
        if (key.escape) { setValue(''); return; }
        if (key.backspace || key.delete) { setValue(p => p.slice(0, -1)); return; }
        if (key.tab) return;
        if (input === '\x15') { setValue(''); return; }
        if (input === '\x17') { setValue(p => p.replace(/\S+\s*$/, '')); return; }
        if (input && !key.ctrl && !key.meta) setValue(p => p + input);
    }, { isActive: active });

    const lines = value.split('\n');
    const empty = value === '';

    return (
        <Box flexDirection="column" marginTop={1}>
            <Box borderStyle="round" borderColor={active ? 'cyan' : 'gray'} flexDirection="column" paddingX={1} marginX={1}>
                {empty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>{line}{i === lines.length - 1 && active ? <Text color="cyan">█</Text> : null}</Text>
                    ))
                )}
            </Box>
            <Box marginX={2}><Text dimColor>enter send · \ newline · esc clear · / commands</Text></Box>
        </Box>
    );
}

// ── Main App ──
function App({ engine }: { engine: ReplEngine }) {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingLabel, setLoadingLabel] = useState('Thinking');
    const [status, setStatus] = useState('');
    const { exit } = useApp();

    // Expose state setters to the engine
    useEffect(() => {
        engine.ui = {
            addMessage: (role: ChatMsg['role'], text: string) => setMessages(p => [...p, { id: ++nextId, role, text }]),
            setStreaming, setLoading, setLoadingLabel, setStatus, exit,
        };
    }, []);

    const handleSubmit = useCallback(async (text: string) => {
        if (text === 'exit' || text === 'quit') { engine.exit(); return; }
        await engine.handleInput(text);
    }, [engine]);

    const isFirst = messages.length === 0;

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box marginTop={1} marginBottom={1} marginX={1}>
                <Text><Text color="cyan" bold>◆</Text> <Text bold>RobinPath</Text> <Text dimColor>v{CLI_VERSION}</Text></Text>
            </Box>

            {/* Completed messages — Static prevents re-render */}
            <Static items={messages}>
                {(msg) => (
                    <Box key={msg.id} marginX={2} marginBottom={msg.role === 'assistant' ? 1 : 0}>
                        {msg.role === 'user' ? (
                            <Text><Text color="cyan" bold>❯ </Text><Text bold>{msg.text}</Text></Text>
                        ) : msg.role === 'info' ? (
                            <Text dimColor>{msg.text}</Text>
                        ) : (
                            <Text wrap="wrap">{msg.text}</Text>
                        )}
                    </Box>
                )}
            </Static>

            {/* Streaming response */}
            {loading && streaming ? (
                <Box marginX={2} marginBottom={1}><Text wrap="wrap">{streaming}<Text color="cyan">▍</Text></Text></Box>
            ) : null}

            {/* Spinner */}
            {loading && !streaming ? (
                <Box marginX={2} marginBottom={1}>
                    <Text dimColor><InkSpinner type="dots" /> {loadingLabel}</Text>
                </Box>
            ) : null}

            {/* Input */}
            <InputBox
                onSubmit={handleSubmit}
                active={!loading}
                placeholder={isFirst ? 'What do you want to automate?' : 'Ask anything...'}
            />

            {/* Status bar */}
            {status ? <Box marginX={2}><Text dimColor>{status}</Text></Box> : null}
        </Box>
    );
}

// ── REPL Engine (non-React logic) ──
class ReplEngine {
    config: AiConfig;
    autoAccept: boolean;
    devMode: boolean;
    apiKey: string | null;
    model: string;
    provider: string;
    sessionId: string;
    sessionName: string;
    usage: UsageTracker;
    conversationMessages: Message[];
    cliContext: Record<string, unknown>;
    ui: any = null;

    constructor(resumeSessionId: string | null, opts: { autoAccept?: boolean; devMode?: boolean }) {
        this.config = readAiConfig();
        this.autoAccept = opts.autoAccept || false;
        this.devMode = opts.devMode || false;
        if (this.devMode) setFlags({ verbose: true });

        this.apiKey = (this.config.apiKey as string) || null;
        this.provider = this.resolveProvider(this.apiKey);
        this.model = this.apiKey ? this.config.model || 'anthropic/claude-sonnet-4.6' : 'robinpath-default';
        this.sessionId = resumeSessionId || randomUUID().slice(0, 8);
        this.sessionName = `session-${new Date().toISOString().slice(0, 10)}`;
        this.usage = createUsageTracker();
        this.conversationMessages = [];

        this.cliContext = {
            platform: platform(), shell: getShellConfig().name,
            cwd: process.cwd(), cliVersion: CLI_VERSION,
            nativeModules: getNativeModules().map((m: any) => m.name),
            installedModules: Object.keys(readModulesManifest()),
        };

        const mem = buildMemoryContext();
        if (mem.trim()) {
            this.conversationMessages.push({ role: 'user', content: `[Context] ${mem.trim()}` });
            this.conversationMessages.push({ role: 'assistant', content: 'Preferences loaded.' });
        }

        if (resumeSessionId) {
            const session = loadSession(resumeSessionId);
            if (session) {
                this.sessionName = session.name;
                for (const msg of session.messages) this.conversationMessages.push(msg);
                if (session.usage) {
                    this.usage.promptTokens = session.usage.promptTokens || 0;
                    this.usage.completionTokens = session.usage.completionTokens || 0;
                    this.usage.totalTokens = session.usage.totalTokens || 0;
                    this.usage.requests = session.usage.requests || 0;
                }
            }
        }
    }

    resolveProvider(key: string | null | undefined): string {
        if (!key) return 'gemini';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return (this.config.provider as string) || 'gemini';
    }

    updateStatus() {
        const model = this.model.includes('/') ? this.model.split('/').pop() : this.model;
        const cost = this.usage.cost > 0 ? ` · $${this.usage.cost.toFixed(4)}` : '';
        const tokens = this.usage.totalTokens > 0 ? ` · ${this.usage.totalTokens.toLocaleString()} tokens` : '';
        this.ui?.setStatus(`${model} · ${getShellConfig().name} · ${this.autoAccept ? 'auto' : 'confirm'}${tokens}${cost}`);
    }

    exit() {
        if (this.conversationMessages.length > 1) {
            saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
        }
        this.ui?.exit();
    }

    async handleInput(text: string) {
        // Slash commands
        if (text === '/' || text === '/help') {
            const cmds = ['/model', '/shell', '/auto', '/clear', '/save', '/sessions', '/memory', '/usage', 'exit'];
            this.ui?.addMessage('info', cmds.join('  '));
            return;
        }
        if (text === '/clear') { this.conversationMessages.length = 0; this.ui?.addMessage('info', 'Cleared.'); return; }
        if (text === '/usage') {
            const c = this.usage.cost > 0 ? `$${this.usage.cost.toFixed(4)}` : '$0 (free)';
            this.ui?.addMessage('info', `${this.usage.totalTokens.toLocaleString()} tokens · ${this.usage.requests} requests · ${c}`);
            return;
        }
        if (text === '/auto') { this.autoAccept = !this.autoAccept; this.ui?.addMessage('info', `Auto-accept: ${this.autoAccept ? 'ON' : 'OFF'}`); this.updateStatus(); return; }
        if (text === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            this.ui?.addMessage('info', models.map((m, i) => `${i+1}. ${m.name} — ${m.desc}`).join('\n'));
            return;
        }
        if (text.match(/^\/model \d+$/)) {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const idx = parseInt(text.split(' ')[1], 10) - 1;
            if (idx >= 0 && idx < models.length) {
                this.config.model = models[idx].id;
                this.model = models[idx].id;
                writeAiConfig(this.config);
                this.ui?.addMessage('info', `Model: ${models[idx].id}`);
                this.updateStatus();
            }
            return;
        }
        if (text === '/memory') {
            const mem = loadMemory();
            this.ui?.addMessage('info', mem.facts.length ? mem.facts.map((f: string, i: number) => `${i+1}. ${f}`).join('\n') : 'No memories.');
            return;
        }
        if (text.startsWith('/save')) {
            if (text.length > 5) this.sessionName = text.slice(5).trim();
            saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
            this.ui?.addMessage('info', `Saved: ${this.sessionName}`);
            return;
        }
        if (text.startsWith('/')) { this.ui?.addMessage('info', `Unknown: ${text}. Type / for help.`); return; }

        // AI message
        this.ui?.addMessage('user', text);
        this.ui?.setLoading(true);
        this.ui?.setStreaming('');
        this.ui?.setLoadingLabel('Thinking');

        try {
            const { expanded } = expandFileRefs(text);
            this.conversationMessages.push({ role: 'user', content: expanded });
            await autoCompact(this.conversationMessages);

            const activeModel = readAiConfig().model || this.model;
            const activeKey = (readAiConfig().apiKey as string) || this.apiKey;
            const activeProvider = this.resolveProvider(activeKey);

            let fullResponse = '';

            for (let loop = 0; loop < 15; loop++) {
                this.ui?.setLoadingLabel(loop === 0 ? 'Thinking' : 'Processing');
                fullResponse = '';

                const result: BrainStreamResult | null = await fetchBrainStream(
                    loop === 0 ? expanded : this.conversationMessages[this.conversationMessages.length - 1].content as string,
                    {
                        onToken: (delta: string) => {
                            if (delta === '\x1b[RETRY]') { fullResponse = ''; this.ui?.setStreaming(''); return; }
                            fullResponse += delta;
                            // Strip tags for display
                            const clean = fullResponse
                                .replace(/<memory>[\s\S]*?<\/memory>/g, '')
                                .replace(/<cmd>[\s\S]*?<\/cmd>/g, '')
                                .replace(/\n{3,}/g, '\n\n')
                                .trim();
                            this.ui?.setStreaming(clean);
                        },
                        conversationHistory: this.conversationMessages.slice(0, -1),
                        provider: activeProvider, model: activeModel, apiKey: activeKey,
                        cliContext: this.cliContext,
                    },
                );

                if (!result || !result.code) {
                    this.ui?.addMessage('assistant', fullResponse || 'No response. Check connection or API key.');
                    break;
                }

                if (result.usage) {
                    const pt = result.usage.prompt_tokens || 0;
                    const ct = result.usage.completion_tokens || 0;
                    this.usage.promptTokens += pt; this.usage.completionTokens += ct;
                    this.usage.totalTokens += pt + ct; this.usage.requests++;
                    this.usage.cost += estimateCost(activeModel, pt, ct);
                    this.updateStatus();
                }

                // Extract memory tags
                const { cleaned } = extractMemoryTags(stripCommandTags(result.code));
                const commands = extractCommands(result.code);

                if (cleaned) {
                    this.conversationMessages.push({ role: 'assistant', content: cleaned });
                }

                if (commands.length === 0) {
                    if (cleaned) this.ui?.addMessage('assistant', cleaned);
                    break;
                }

                // Show response text before commands
                if (cleaned) this.ui?.addMessage('assistant', cleaned);

                // Execute commands (auto-accept for now — confirmCommand uses raw mode which conflicts with Ink)
                const cmdResults: any[] = [];
                for (const cmd of commands) {
                    this.ui?.addMessage('info', `$ ${cmd.split('\n')[0]}${cmd.includes('\n') ? ` (+${cmd.split('\n').length-1} lines)` : ''}`);
                    const r = await executeShellCommand(cmd);
                    if (r.exitCode === 0 && r.stdout?.trim()) {
                        this.ui?.addMessage('info', r.stdout.trim().split('\n').slice(0, 5).join('\n'));
                    } else if (r.exitCode !== 0) {
                        this.ui?.addMessage('info', `exit ${r.exitCode}: ${(r.stderr || '').slice(0, 100)}`);
                    }
                    cmdResults.push({ command: cmd, stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.exitCode });
                }

                const summary = cmdResults.map((r: any) => {
                    let o = `$ ${r.command}\n`;
                    if (r.exitCode === 0) o += r.stdout || '(no output)';
                    else { o += `Exit: ${r.exitCode}\n`; if (r.stderr) o += r.stderr; }
                    return o;
                }).join('\n\n');
                this.conversationMessages.push({ role: 'user', content: `[Command results]\n${summary}` });
                this.ui?.setStreaming('');
            }
        } catch (err: any) {
            this.ui?.addMessage('info', `Error: ${err.message}`);
        } finally {
            this.ui?.setLoading(false);
            this.ui?.setStreaming('');
            saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
        }
    }
}

// ── Entry point ──
interface InkReplOptions { autoAccept?: boolean; devMode?: boolean; }

export async function startInkREPL(
    initialPrompt: string | null,
    resumeSessionId: string | null,
    opts: InkReplOptions = {},
): Promise<void> {
    const engine = new ReplEngine(resumeSessionId, opts);

    const { waitUntilExit } = render(<App engine={engine} />);

    // Wait for engine.ui to be set by React
    await new Promise(r => setTimeout(r, 100));

    engine.updateStatus();

    // Handle initial prompt
    if (initialPrompt) {
        await engine.handleInput(initialPrompt);
    }

    await waitUntilExit();
}
