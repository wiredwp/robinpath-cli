/**
 * Ink-based AI REPL
 *
 * Layout: Static messages (grow up) + dynamic area (streaming OR input, never both)
 * Bordered input box only renders when AI is NOT streaming — prevents garbled output.
 */
import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {render, Box, Text, Static, useInput, useApp} from 'ink';
import InkSpinner from 'ink-spinner';
import {getShellConfig, getAvailableShells, setShellOverride, getRobinPathHome, CLI_VERSION, setFlags, logVerbose} from './utils';
import {readAiConfig, writeAiConfig, AI_BRAIN_URL} from './config';
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
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

// ── Types ──
interface ChatMsg { id: number; text: string; dim?: boolean }
let nextId = 0;

// ── Slash commands with descriptions ──
const COMMANDS: Record<string, string> = {
    '/model': 'Switch AI model',
    '/auto': 'Toggle auto-accept',
    '/clear': 'Clear conversation',
    '/save': 'Save session',
    '/sessions': 'List sessions',
    '/memory': 'Show memory',
    '/remember': 'Save a fact',
    '/usage': 'Token usage & cost',
    '/shell': 'Switch shell',
    '/help': 'Show commands',
};

// ── Input Box Component ──
function InputArea({onSubmit, placeholder}: {onSubmit: (v: string) => void; placeholder: string}) {
    const [value, setValue] = useState('');
    const [showHints, setShowHints] = useState(false);
    const {exit} = useApp();

    // Match slash commands for hints
    const matchingCommands = useMemo(() => {
        if (!value.startsWith('/')) return [];
        if (value === '/') return Object.entries(COMMANDS);
        return Object.entries(COMMANDS).filter(([cmd]) => cmd.startsWith(value));
    }, [value]);

    useInput((ch, key) => {
        if (key.return) {
            if (value.endsWith('\\')) {setValue(p => p.slice(0, -1) + '\n'); return;}
            const text = value.trim();
            if (text) {onSubmit(text); setValue(''); setShowHints(false);}
            return;
        }
        if (ch === '\n') {setValue(p => p + '\n'); return;}
        if (key.escape) {setValue(''); setShowHints(false); return;}
        if (ch === '\x03') {if (!value) exit(); else {setValue(''); setShowHints(false);} return;}
        if (key.backspace || key.delete) {setValue(p => p.slice(0, -1)); return;}
        if (key.tab) {
            // Auto-complete first matching command
            if (matchingCommands.length === 1) {
                setValue(matchingCommands[0][0] + ' ');
                setShowHints(false);
            }
            return;
        }
        if (ch === '\x15') {setValue(''); return;}
        if (ch === '\x17') {setValue(p => p.replace(/\S+\s*$/, '')); return;}
        if (ch && !key.ctrl && !key.meta) setValue(p => p + ch);
    });

    // Show hints when typing /
    useEffect(() => {
        setShowHints(value.startsWith('/') && matchingCommands.length > 0);
    }, [value, matchingCommands.length]);

    const lines = value.split('\n');
    const empty = value === '';

    return (
        <Box flexDirection="column" marginTop={1}>
            {/* Slash command hints */}
            {showHints && (
                <Box flexDirection="column" marginX={2} marginBottom={1}>
                    {matchingCommands.slice(0, 6).map(([cmd, desc]) => (
                        <Text key={cmd}>
                            <Text color="cyan">{cmd.padEnd(12)}</Text>
                            <Text dimColor>{desc}</Text>
                        </Text>
                    ))}
                </Box>
            )}

            {/* Bordered input */}
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginX={1}>
                {empty ? (
                    <Text dimColor>{placeholder}</Text>
                ) : (
                    lines.map((line, i) => (
                        <Text key={i}>{line}{i === lines.length - 1 ? <Text color="cyan">█</Text> : null}</Text>
                    ))
                )}
            </Box>

            {/* Hints */}
            <Box marginX={2}>
                <Text dimColor>
                    <Text color="gray">enter</Text>{' send  '}
                    <Text color="gray">\</Text>{' newline  '}
                    <Text color="gray">esc</Text>{' clear  '}
                    <Text color="gray">/</Text>{' commands  '}
                    <Text color="gray">tab</Text>{' complete'}
                </Text>
            </Box>
        </Box>
    );
}

// ── Main App ──
function ChatApp({onMessage, statusText}: {onMessage: (text: string) => Promise<string>; statusText: string}) {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (global as any).__rpUI = {
            setStreaming, setLoading,
            addMessage: (text: string, dim?: boolean) => setMessages(p => [...p, {id: ++nextId, text, dim}]),
        };
    }, []);

    const handleSubmit = useCallback(async (text: string) => {
        if (text === 'exit' || text === 'quit') {
            (global as any).__rpExit?.();
            return;
        }
        setMessages(p => [...p, {id: ++nextId, text: `❯ ${text}`}]);
        setLoading(true);
        setStreaming('');
        try {
            const response = await onMessage(text);
            if (response) setMessages(p => [...p, {id: ++nextId, text: response}]);
        } catch (err: any) {
            setMessages(p => [...p, {id: ++nextId, text: `Error: ${err.message}`, dim: true}]);
        }
        setLoading(false);
        setStreaming('');
    }, [onMessage]);

    const isFirst = messages.length === 0;

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text><Text color="cyan" bold>◆</Text> <Text bold>RobinPath</Text> <Text dimColor>v{CLI_VERSION}</Text></Text>
            </Box>

            {/* Completed messages — Static never re-renders old items */}
            <Static items={messages}>
                {msg => (
                    <Box key={msg.id} paddingX={1} marginBottom={msg.text.startsWith('❯') ? 0 : 1}>
                        {msg.dim ? <Text dimColor wrap="wrap">{msg.text}</Text> : <Text wrap="wrap">{msg.text}</Text>}
                    </Box>
                )}
            </Static>

            {/* Dynamic area: streaming response OR input (never both) */}
            {loading ? (
                <Box flexDirection="column" paddingX={1}>
                    {streaming ? (
                        <Text wrap="wrap">{streaming}<Text color="cyan">▍</Text></Text>
                    ) : (
                        <Text dimColor><InkSpinner type="dots" /> Thinking</Text>
                    )}
                </Box>
            ) : (
                <InputArea
                    onSubmit={handleSubmit}
                    placeholder={isFirst ? 'Anything to automate with RobinPath?' : 'Ask anything...'}
                />
            )}

            {/* Status bar */}
            <Box marginTop={1} paddingX={1}>
                <Text dimColor>{statusText}</Text>
            </Box>
        </Box>
    );
}

// ── Engine ──
interface InkReplOptions {autoAccept?: boolean; devMode?: boolean}

export async function startInkREPL(
    initialPrompt: string | null,
    resumeSessionId: string | null,
    opts: InkReplOptions = {},
): Promise<void> {
    const config: AiConfig = readAiConfig();
    let autoAccept = opts.autoAccept || false;
    const devMode = opts.devMode || false;
    if (devMode) setFlags({verbose: true});

    const resolveProvider = (key: string | null | undefined): string => {
        if (!key) return 'gemini';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return (config.provider as string) || 'gemini';
    };

    const apiKey = (config.apiKey as string) || null;
    const model = apiKey ? config.model || 'anthropic/claude-sonnet-4.6' : 'robinpath-default';
    const modelShort = (m: string) => m === 'robinpath-default' ? 'gemini-free' : m.includes('/') ? m.split('/').pop()! : m;

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

    const mem = buildMemoryContext();
    if (mem.trim()) {
        conversationMessages.push({role: 'user', content: `[Context] ${mem.trim()}`});
        conversationMessages.push({role: 'assistant', content: 'Preferences loaded.'});
    }

    if (resumeSessionId) {
        const session = loadSession(resumeSessionId);
        if (session) {
            sessionName = session.name;
            for (const msg of session.messages) conversationMessages.push(msg);
            if (session.usage) Object.assign(usage, session.usage);
        }
    }

    function getStatusText(): string {
        const m = modelShort(readAiConfig().model || model);
        const cost = usage.cost > 0 ? ` · $${usage.cost.toFixed(4)}` : '';
        const tokens = usage.totalTokens > 0 ? ` · ${usage.totalTokens.toLocaleString()} tok` : '';
        return `${m} · ${getShellConfig().name} · ${autoAccept ? 'auto' : 'confirm'}${tokens}${cost}`;
    }

    async function handleMessage(text: string): Promise<string> {
        const ui = (global as any).__rpUI;

        // ── Slash commands ──
        if (text === '/' || text === '/help') {
            return Object.entries(COMMANDS).map(([cmd, desc]) => `${cmd.padEnd(12)} ${desc}`).join('\n');
        }
        if (text === '/clear') {conversationMessages.length = 0; return 'Conversation cleared.';}
        if (text === '/usage') {
            const c = usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : '$0.00 (free)';
            return `${usage.totalTokens.toLocaleString()} tokens · ${usage.requests} requests · ${c}`;
        }
        if (text === '/auto') {
            autoAccept = !autoAccept;
            return `Auto-accept: ${autoAccept ? 'ON' : 'OFF'}`;
        }
        if (text === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const cur = readAiConfig().model || model;
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
                config.model = models[idx].id;
                writeAiConfig(config);
                return `Model changed to ${models[idx].name}`;
            }
            return 'Invalid number.';
        }
        if (text === '/memory') {
            const m = loadMemory();
            return m.facts.length ? m.facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n') : 'No memories saved.';
        }
        if (text.startsWith('/remember ')) {addMemoryFact(text.slice(10).trim()); return 'Remembered.';}
        if (text.startsWith('/forget ')) {removeMemoryFact(parseInt(text.slice(8).trim(), 10) - 1); return 'Forgotten.';}
        if (text === '/save' || text.startsWith('/save ')) {
            if (text.length > 5) sessionName = text.slice(5).trim();
            saveSession(sessionId, sessionName, conversationMessages, usage);
            return `Session saved: ${sessionName}`;
        }
        if (text === '/sessions') {
            const sessions = listSessions();
            if (sessions.length === 0) return 'No saved sessions.';
            return sessions.map(s => `${s.id}  ${s.name}  (${s.messages} msgs)`).join('\n');
        }
        if (text === '/shell') {
            return getAvailableShells().map(s => {
                const mark = s.current ? ' ✓' : s.available ? '' : ' (not found)';
                return `${s.name}${mark}`;
            }).join('\n') + '\n\nType /shell <name> to switch.';
        }
        if (text.startsWith('/shell ')) {
            setShellOverride(text.slice(7).trim());
            cliContext.shell = getShellConfig().name;
            return `Shell: ${getShellConfig().name}`;
        }
        if (text.startsWith('/')) return `Unknown command: ${text}. Type / for help.`;

        // ── AI message ──
        const {expanded} = expandFileRefs(text);
        conversationMessages.push({role: 'user', content: expanded});
        await autoCompact(conversationMessages);

        const activeModel = readAiConfig().model || model;
        const activeKey = (readAiConfig().apiKey as string) || apiKey;
        const activeProvider = resolveProvider(activeKey);

        let finalResponse = '';

        for (let loop = 0; loop < 15; loop++) {
            let fullText = '';

            const result: BrainStreamResult | null = await fetchBrainStream(
                loop === 0 ? expanded : conversationMessages[conversationMessages.length - 1].content as string,
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
                    conversationHistory: conversationMessages.slice(0, -1),
                    provider: activeProvider, model: activeModel, apiKey: activeKey, cliContext,
                },
            );

            if (!result) {finalResponse = 'No internet connection. Check your network and try again.'; break;}
            if ((result as any).error) {finalResponse = (result as any).error; break;}
            if (!result.code) {finalResponse = fullText || 'No response. Try again.'; break;}

            if (result.usage) {
                const pt = result.usage.prompt_tokens || 0;
                const ct = result.usage.completion_tokens || 0;
                usage.promptTokens += pt; usage.completionTokens += ct;
                usage.totalTokens += pt + ct; usage.requests++;
                usage.cost += estimateCost(activeModel, pt, ct);
            }

            const {cleaned} = extractMemoryTags(stripCommandTags(result.code));
            const commands = extractCommands(result.code);

            if (cleaned) conversationMessages.push({role: 'assistant', content: cleaned});

            if (commands.length === 0) {finalResponse = cleaned || fullText; break;}

            if (cleaned) ui?.addMessage(cleaned);

            // Execute commands
            for (const cmd of commands) {
                const preview = cmd.split('\n')[0].slice(0, 80);
                ui?.addMessage(`$ ${preview}${cmd.includes('\n') ? ' ...' : ''}`, true);
                const r = await executeShellCommand(cmd);
                if (r.exitCode === 0 && r.stdout?.trim()) {
                    ui?.addMessage(r.stdout.trim().split('\n').slice(0, 5).join('\n'), true);
                } else if (r.exitCode !== 0) {
                    ui?.addMessage(`exit ${r.exitCode}: ${(r.stderr || '').slice(0, 100)}`, true);
                }
            }

            const summary = commands.map(cmd => `$ ${cmd}\n(executed)`).join('\n');
            conversationMessages.push({role: 'user', content: `[Results]\n${summary}`});
            ui?.setStreaming('');
            finalResponse = '';
        }

        saveSession(sessionId, sessionName, conversationMessages, usage);
        return finalResponse;
    }

    // ── Render ──
    const {waitUntilExit} = render(
        <ChatApp onMessage={handleMessage} statusText={getStatusText()} />,
    );

    (global as any).__rpExit = () => {
        if (conversationMessages.length > 1) saveSession(sessionId, sessionName, conversationMessages, usage);
        process.exit(0);
    };

    if (initialPrompt) {
        await new Promise(r => setTimeout(r, 200));
        const ui = (global as any).__rpUI;
        ui?.addMessage(`❯ ${initialPrompt}`);
        ui?.setLoading(true);
        try {
            const response = await handleMessage(initialPrompt);
            if (response) ui?.addMessage(response);
        } finally {
            ui?.setLoading(false);
        }
    }

    await waitUntilExit();
    saveSession(sessionId, sessionName, conversationMessages, usage);
}
