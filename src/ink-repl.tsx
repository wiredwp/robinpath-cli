/**
 * Ink-based AI REPL
 *
 * Layout: Static messages (grow up) + dynamic area (streaming OR input, never both)
 * Input area only renders when AI is NOT streaming — prevents garbled output.
 */
import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {render, Box, Text, Static, useInput, useApp} from 'ink';
import InkSpinner from 'ink-spinner';
import {Markdown} from './ui/Markdown';
import {getShellConfig, getAvailableShells, setShellOverride, getRobinPathHome, CLI_VERSION, setFlags, logVerbose} from './utils';
import {readAiConfig, writeAiConfig} from './config';
import type {AiConfig} from './config';
import {AI_MODELS, createUsageTracker, estimateCost} from './models';
import type {UsageTracker} from './models';
import {
    saveSession, loadSession, listSessions, buildMemoryContext,
    extractMemoryTags, addMemoryFact, removeMemoryFact, loadMemory,
    autoCompact, deleteSession,
} from './sessions';
import type {Message} from './sessions';
import {expandFileRefs} from './file-refs';
import {fetchBrainStream} from './brain';
import type {BrainStreamResult} from './brain';
import {executeShellCommand, extractCommands, stripCommandTags} from './shell';
import {readModulesManifest} from './commands-core';
import {getNativeModules} from './runtime';
import {homedir, platform} from 'node:os';
import {randomUUID} from 'node:crypto';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

// ── Types ──
interface ChatMsg { id: number; text: string; dim?: boolean }
let nextId = 0;

// ── All slash commands ──
const COMMANDS: Record<string, string> = {
    '/model': 'Switch AI model',
    '/auto': 'Toggle auto-accept (commands)',
    '/clear': 'Clear conversation',
    '/compact': 'Trim to last 10 messages',
    '/save': 'Save session',
    '/sessions': 'List saved sessions',
    '/resume': 'Resume a session',
    '/delete': 'Delete a session',
    '/memory': 'Show persistent memory',
    '/remember': 'Save a fact',
    '/forget': 'Remove a memory',
    '/usage': 'Token usage & cost',
    '/shell': 'Switch shell',
    '/help': 'All commands',
};

// ── Input Area ──
function InputArea({onSubmit, placeholder}: {onSubmit: (v: string) => void; placeholder: string}) {
    const [value, setValue] = useState('');
    const {exit} = useApp();

    const matchingCommands = useMemo(() => {
        if (!value.startsWith('/')) return [];
        if (value === '/') return Object.entries(COMMANDS);
        return Object.entries(COMMANDS).filter(([cmd]) => cmd.startsWith(value));
    }, [value]);

    const showHints = value.startsWith('/') && matchingCommands.length > 0;

    useInput((ch, key) => {
        if (key.return) {
            if (value.endsWith('\\')) {setValue(p => p.slice(0, -1) + '\n'); return;}
            const text = value.trim();
            if (text) {onSubmit(text); setValue('');}
            return;
        }
        if (ch === '\n') {setValue(p => p + '\n'); return;}
        if (key.escape) {setValue(''); return;}
        if (ch === '\x03') {if (!value) exit(); else setValue(''); return;}
        if (key.backspace || key.delete) {setValue(p => p.slice(0, -1)); return;}
        if (key.tab) {
            if (matchingCommands.length === 1) setValue(matchingCommands[0][0]);
            return;
        }
        if (ch === '\x15') {setValue(''); return;}
        if (ch === '\x17') {setValue(p => p.replace(/\S+\s*$/, '')); return;}
        if (ch && !key.ctrl && !key.meta) setValue(p => p + ch);
    });

    const lines = value.split('\n');
    const empty = value === '';
    const w = Math.min(process.stdout.columns - 4 || 76, 76);

    return (
        <Box flexDirection="column" marginTop={1}>
            {showHints && (
                <Box flexDirection="column" marginX={2} marginBottom={1}>
                    {matchingCommands.slice(0, 8).map(([cmd, desc]) => (
                        <Text key={cmd}>
                            <Text color="cyan">{cmd.padEnd(14)}</Text>
                            <Text dimColor>{desc}</Text>
                        </Text>
                    ))}
                </Box>
            )}

            <Box flexDirection="column">
                <Text dimColor>{'─'.repeat(Math.max(process.stdout.columns || 80, 40))}</Text>
                <Box paddingX={2} flexDirection="column">
                    {empty ? (
                        <Text dimColor>{'> '}{placeholder}</Text>
                    ) : (
                        lines.map((line, i) => (
                            <Text key={i}>
                                {i === 0 ? <Text color="cyan">{'> '}</Text> : <Text dimColor>{'  '}</Text>}
                                {line}
                                {i === lines.length - 1 ? <Text color="cyan">▎</Text> : null}
                            </Text>
                        ))
                    )}
                </Box>
                <Text dimColor>{'─'.repeat(Math.max(process.stdout.columns || 80, 40))}</Text>
            </Box>

            <Box paddingX={2}>
                <Text dimColor>enter send · \ newline · / commands · @/ files</Text>
            </Box>
        </Box>
    );
}

// ── Main App ──
function ChatApp({engine}: {engine: ReplEngine}) {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => {
        engine.ui = {
            setStreaming, setLoading, setStatus,
            addMessage: (text: string, dim?: boolean) => setMessages(p => [...p, {id: ++nextId, text, dim}]),
        };
        engine.updateStatus();
    }, []);

    const handleSubmit = useCallback(async (text: string) => {
        if (text === 'exit' || text === 'quit') {engine.exit(); return;}
        // Slash commands — show result inline without user message echo
        if (text.startsWith('/')) {
            const result = await engine.handleSlashCommand(text);
            if (result) setMessages(p => [...p, {id: ++nextId, text: result, dim: true}]);
            engine.updateStatus();
            return;
        }
        // AI message
        setMessages(p => [...p, {id: ++nextId, text: `❯ ${text}`}]);
        setLoading(true);
        setStreaming('');
        try {
            const response = await engine.handleAIMessage(text);
            if (response) setMessages(p => [...p, {id: ++nextId, text: response}]);
        } catch (err: any) {
            setMessages(p => [...p, {id: ++nextId, text: `Error: ${err.message}`, dim: true}]);
        }
        setLoading(false);
        setStreaming('');
        engine.updateStatus();
    }, [engine]);

    const isFirst = messages.length === 0;

    return (
        <Box flexDirection="column" paddingY={1}>
            <Box marginBottom={1}>
                <Text><Text color="cyan" bold>◆</Text> <Text bold>RobinPath</Text> <Text dimColor>v{CLI_VERSION}</Text></Text>
            </Box>

            <Static items={messages}>
                {msg => (
                    <Box key={msg.id} paddingX={1} marginBottom={msg.text.startsWith('❯') ? 0 : 1} flexDirection="column">
                        {msg.text.startsWith('❯') ? (
                            <Text><Text color="cyan" bold>❯</Text><Text bold>{msg.text.slice(1)}</Text></Text>
                        ) : msg.dim ? (
                            <Text dimColor wrap="wrap">{msg.text}</Text>
                        ) : (
                            <Markdown>{msg.text}</Markdown>
                        )}
                    </Box>
                )}
            </Static>

            {loading ? (
                <Box flexDirection="column" paddingX={1}>
                    {streaming ? (
                        <Box flexDirection="column">
                            <Markdown>{streaming}</Markdown>
                            <Text color="cyan">▍</Text>
                        </Box>
                    ) : (
                        <Text dimColor><InkSpinner type="dots" /> Thinking</Text>
                    )}
                </Box>
            ) : (
                <InputArea
                    onSubmit={handleSubmit}
                    placeholder="Message RobinPath..."
                />
            )}

            {status ? <Box marginTop={1} paddingX={1}><Text dimColor>{status}</Text></Box> : null}
        </Box>
    );
}

// ── REPL Engine ──
class ReplEngine {
    config: AiConfig;
    autoAccept: boolean;
    apiKey: string | null;
    model: string;
    sessionId: string;
    sessionName: string;
    usage: UsageTracker;
    conversationMessages: Message[];
    cliContext: Record<string, unknown>;
    ui: any = null;

    constructor(resumeSessionId: string | null, opts: {autoAccept?: boolean; devMode?: boolean}) {
        this.config = readAiConfig();
        this.autoAccept = opts.autoAccept || false;
        if (opts.devMode) setFlags({verbose: true});

        this.apiKey = (this.config.apiKey as string) || null;
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
            this.conversationMessages.push({role: 'user', content: `[Context] ${mem.trim()}`});
            this.conversationMessages.push({role: 'assistant', content: 'Preferences loaded.'});
        }

        if (resumeSessionId) {
            const session = loadSession(resumeSessionId);
            if (session) {
                this.sessionName = session.name;
                for (const msg of session.messages) this.conversationMessages.push(msg);
                if (session.usage) Object.assign(this.usage, session.usage);
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
        const m = this.model.includes('/') ? this.model.split('/').pop() : this.model;
        const parts: string[] = [m || 'default'];
        if (this.usage.totalTokens > 0) parts.push(`${this.usage.totalTokens.toLocaleString()} tokens`);
        if (this.usage.cost > 0) parts.push(`$${this.usage.cost.toFixed(4)}`);
        this.ui?.setStatus(parts.join(' · '));
    }

    exit() {
        if (this.conversationMessages.length > 1) saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
        process.exit(0);
    }

    // ── Slash commands — return display text, not a chat message ──
    async handleSlashCommand(text: string): Promise<string> {
        if (text === '/' || text === '/help') {
            return Object.entries(COMMANDS).map(([cmd, desc]) => `${cmd.padEnd(14)} ${desc}`).join('\n');
        }
        if (text === '/clear') {this.conversationMessages.length = 0; return '✓ Conversation cleared.';}
        if (text === '/compact') {
            if (this.conversationMessages.length > 12) {
                this.conversationMessages.splice(1, this.conversationMessages.length - 11);
            }
            return `✓ Trimmed to ${this.conversationMessages.length} messages.`;
        }
        if (text === '/auto') {
            this.autoAccept = !this.autoAccept;
            return `Auto-accept: ${this.autoAccept ? 'ON — commands run without asking' : 'OFF — confirm each command'}`;
        }
        if (text === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const cur = readAiConfig().model || this.model;
            return models.map((m, i) => {
                const mark = m.id === cur ? ' ✓' : '';
                return `${String(i + 1).padStart(2)}. ${m.name.padEnd(22)} ${m.desc}${mark}`;
            }).join('\n') + '\n\nType /model <number> to switch.';
        }
        if (text.match(/^\/model \d+$/)) {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const idx = parseInt(text.split(' ')[1], 10) - 1;
            if (idx >= 0 && idx < models.length) {
                this.config.model = models[idx].id;
                this.model = models[idx].id;
                writeAiConfig(this.config);
                return `✓ Model: ${models[idx].name}`;
            }
            return 'Invalid number. Type /model to see the list.';
        }
        if (text === '/usage') {
            const c = this.usage.cost > 0 ? `$${this.usage.cost.toFixed(4)}` : '$0.00 (free)';
            return `${this.usage.totalTokens.toLocaleString()} tokens · ${this.usage.requests} requests · ${c}`;
        }
        if (text === '/memory') {
            const m = loadMemory();
            return m.facts.length ? m.facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n') : 'No memories saved yet.\nUse /remember <fact> to save something.';
        }
        if (text.startsWith('/remember ')) {
            const fact = text.slice(10).trim();
            if (!fact) return 'Usage: /remember <fact>';
            addMemoryFact(fact);
            return `✓ Remembered: "${fact}"`;
        }
        if (text.startsWith('/forget ')) {
            const idx = parseInt(text.slice(8).trim(), 10) - 1;
            const removed = removeMemoryFact(idx);
            return removed ? `✓ Forgot: "${removed}"` : 'Invalid number. Type /memory to see the list.';
        }
        if (text === '/save' || text.startsWith('/save ')) {
            if (text.length > 5) this.sessionName = text.slice(5).trim();
            saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
            return `✓ Saved: ${this.sessionName} (${this.sessionId})`;
        }
        if (text === '/sessions') {
            const sessions = listSessions();
            if (sessions.length === 0) return 'No saved sessions.';
            return sessions.map(s => {
                const age = Math.round((Date.now() - new Date(s.updated || s.created).getTime()) / 60000);
                const ago = age < 60 ? `${age}m` : age < 1440 ? `${Math.floor(age/60)}h` : `${Math.floor(age/1440)}d`;
                return `${s.id}  ${s.name.padEnd(20)} ${s.messages} msgs · ${ago} ago`;
            }).join('\n') + '\n\nType /resume <id> to resume.';
        }
        if (text.startsWith('/resume ')) {
            const targetId = text.slice(8).trim();
            const session = loadSession(targetId);
            if (!session) return `Session '${targetId}' not found.`;
            this.sessionId = session.id;
            this.sessionName = session.name;
            this.conversationMessages.length = 0;
            for (const msg of session.messages) this.conversationMessages.push(msg);
            if (session.usage) Object.assign(this.usage, session.usage);
            return `✓ Resumed: ${session.name} (${session.messages.length} msgs)`;
        }
        if (text.startsWith('/delete ')) {
            const targetId = text.slice(8).trim();
            const deleted = deleteSession(targetId);
            return deleted ? `✓ Deleted session ${targetId}` : `Session '${targetId}' not found.`;
        }
        if (text === '/shell') {
            return getAvailableShells().map(s => {
                const mark = s.current ? ' ✓' : s.available ? '' : ' (not found)';
                return `${s.name}${mark}`;
            }).join('\n') + '\n\nType /shell <name> to switch.';
        }
        if (text.startsWith('/shell ')) {
            setShellOverride(text.slice(7).trim());
            this.cliContext.shell = getShellConfig().name;
            return `✓ Shell: ${getShellConfig().name}`;
        }
        return `Unknown command: ${text}\nType / to see available commands.`;
    }

    // ── AI message ──
    async handleAIMessage(text: string): Promise<string> {
        const ui = this.ui;
        const {expanded} = expandFileRefs(text);
        this.conversationMessages.push({role: 'user', content: expanded});
        await autoCompact(this.conversationMessages);

        const activeModel = readAiConfig().model || this.model;
        const activeKey = (readAiConfig().apiKey as string) || this.apiKey;
        const activeProvider = this.resolveProvider(activeKey);

        let finalResponse = '';

        for (let loop = 0; loop < 15; loop++) {
            let fullText = '';

            const result: BrainStreamResult | null = await fetchBrainStream(
                loop === 0 ? expanded : this.conversationMessages[this.conversationMessages.length - 1].content as string,
                {
                    onToken: (delta: string) => {
                        if (delta === '\x1b[RETRY]') {fullText = ''; ui?.setStreaming(''); return;}
                        fullText += delta;
                        const clean = fullText
                            .replace(/<memory>[\s\S]*?<\/memory>/g, '')
                            .replace(/<cmd>[\s\S]*?<\/cmd>/g, '')
                            .replace(/\n{3,}/g, '\n\n').trim();
                        ui?.setStreaming(clean);
                    },
                    conversationHistory: this.conversationMessages.slice(0, -1),
                    provider: activeProvider, model: activeModel, apiKey: activeKey,
                    cliContext: this.cliContext,
                },
            );

            if (!result) {finalResponse = 'No internet connection. Check your network and try again.'; break;}
            if ((result as any).error) {finalResponse = (result as any).error; break;}
            if (!result.code) {finalResponse = fullText || 'No response. Try again.'; break;}

            if (result.usage) {
                const pt = result.usage.prompt_tokens || 0;
                const ct = result.usage.completion_tokens || 0;
                this.usage.promptTokens += pt; this.usage.completionTokens += ct;
                this.usage.totalTokens += pt + ct; this.usage.requests++;
                this.usage.cost += estimateCost(activeModel, pt, ct);
            }

            const {cleaned} = extractMemoryTags(stripCommandTags(result.code));
            const commands = extractCommands(result.code);

            if (cleaned) this.conversationMessages.push({role: 'assistant', content: cleaned});

            if (commands.length === 0) {finalResponse = cleaned || fullText; break;}

            if (cleaned) ui?.addMessage(cleaned);

            // Execute commands and collect results
            const cmdResults: {command: string; stdout: string; stderr: string; exitCode: number}[] = [];
            for (const cmd of commands) {
                const preview = cmd.split('\n')[0].slice(0, 80);
                ui?.addMessage(`$ ${preview}${cmd.includes('\n') ? ' ...' : ''}`, true);
                const r = await executeShellCommand(cmd);
                cmdResults.push({command: cmd, stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.exitCode});

                // Display result (truncated for UI, full for AI)
                if (r.exitCode === 0 && r.stdout?.trim()) {
                    const lines = r.stdout.trim().split('\n');
                    if (lines.length <= 15) {
                        ui?.addMessage(lines.join('\n'), true);
                    } else {
                        ui?.addMessage(
                            `${lines.slice(0, 5).join('\n')}\n... (${lines.length - 10} lines hidden)\n${lines.slice(-5).join('\n')}`,
                            true,
                        );
                    }
                } else if (r.exitCode !== 0) {
                    ui?.addMessage(`exit ${r.exitCode}: ${(r.stderr || '').slice(0, 200)}`, true);
                } else {
                    ui?.addMessage('done', true);
                }
            }

            // Send full results to AI (not truncated for display)
            const summary = cmdResults.map(r => {
                let out = `$ ${r.command}\n`;
                if (r.exitCode === 0) out += (r.stdout || '(no output)').slice(0, 5000);
                else { out += `Exit: ${r.exitCode}\n`; if (r.stderr) out += r.stderr.slice(0, 2000); }
                return out;
            }).join('\n\n');
            this.conversationMessages.push({role: 'user', content: `[Results]\n${summary}`});
            ui?.setStreaming('');
            finalResponse = '';
        }

        saveSession(this.sessionId, this.sessionName, this.conversationMessages, this.usage);
        return finalResponse;
    }
}

// ── Entry ──
interface InkReplOptions {autoAccept?: boolean; devMode?: boolean}

export async function startInkREPL(
    initialPrompt: string | null,
    resumeSessionId: string | null,
    opts: InkReplOptions = {},
): Promise<void> {
    const engine = new ReplEngine(resumeSessionId, opts);
    const {waitUntilExit} = render(<ChatApp engine={engine} />);

    (global as any).__rpExit = () => engine.exit();

    if (initialPrompt) {
        await new Promise(r => setTimeout(r, 200));
        engine.ui?.addMessage(`❯ ${initialPrompt}`);
        engine.ui?.setLoading(true);
        try {
            const response = await engine.handleAIMessage(initialPrompt);
            if (response) engine.ui?.addMessage(response);
        } finally {
            engine.ui?.setLoading(false);
            engine.updateStatus();
        }
    }

    await waitUntilExit();
    engine.exit();
}
