/**
 * Ink-based AI REPL — follows Ink's own chat example pattern exactly.
 *
 * Simple layout: messages as text, input as text. No bordered boxes.
 * Uses Static for completed messages, state for streaming + input.
 */
import React, {useState, useCallback, useEffect} from 'react';
import {render, Box, Text, Static, useInput, useApp} from 'ink';
import InkSpinner from 'ink-spinner';
import {color, getShellConfig, getAvailableShells, setShellOverride, getRobinPathHome, CLI_VERSION, setFlags, logVerbose} from './utils';
import {readAiConfig, writeAiConfig, AI_BRAIN_URL} from './config';
import type {AiConfig} from './config';
import {AI_MODELS, createUsageTracker, estimateCost} from './models';
import type {UsageTracker, ModelInfo} from './models';
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
interface ChatMsg {
    id: number;
    text: string;
}

let nextId = 0;

// ── The App — follows Ink's chat example pattern ──
function ChatApp({onMessage}: {onMessage: (text: string) => Promise<string>}) {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState('');
    const [loading, setLoading] = useState(false);
    const {exit} = useApp();

    // Expose setters for the engine
    useEffect(() => {
        (global as any).__rpUI = {
            setStreaming,
            setLoading,
            addMessage: (text: string) => setMessages(prev => [...prev, {id: ++nextId, text}]),
        };
    }, []);

    useInput((character, key) => {
        if (loading) return;

        if (key.return) {
            if (!input.trim()) return;

            if (input.endsWith('\\')) {
                setInput(prev => prev.slice(0, -1) + '\n');
                return;
            }

            const text = input.trim();
            setInput('');

            if (text === 'exit' || text === 'quit') {
                exit();
                return;
            }

            // Add user message and start loading
            setMessages(prev => [...prev, {id: ++nextId, text: `❯ ${text}`}]);
            setLoading(true);
            setStreaming('');

            onMessage(text).then(response => {
                if (response) {
                    setMessages(prev => [...prev, {id: ++nextId, text: response}]);
                }
                setLoading(false);
                setStreaming('');
            }).catch(err => {
                setMessages(prev => [...prev, {id: ++nextId, text: `Error: ${err.message}`}]);
                setLoading(false);
                setStreaming('');
            });

            return;
        }

        if (input.length > 0 && (key.backspace || key.delete)) {
            setInput(prev => prev.slice(0, -1));
            return;
        }

        if (key.escape) {
            setInput('');
            return;
        }

        if (key.tab) return;

        if (character && !key.ctrl && !key.meta) {
            setInput(prev => prev + character);
        }
    });

    const lines = input.split('\n');

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Text>
                <Text color="cyan" bold>◆</Text> <Text bold>RobinPath</Text> <Text dimColor>v{CLI_VERSION}</Text>
            </Text>
            <Text dimColor> </Text>

            {/* Completed messages */}
            <Static items={messages}>
                {msg => <Text key={msg.id} wrap="wrap">{msg.text}</Text>}
            </Static>

            {/* Streaming response */}
            {loading && streaming ? (
                <Text wrap="wrap">{streaming}</Text>
            ) : null}

            {/* Spinner */}
            {loading && !streaming ? (
                <Text dimColor><InkSpinner type="dots" /> Thinking</Text>
            ) : null}

            {/* Input — simple, like Ink's chat example */}
            {!loading ? (
                <Box marginTop={1}>
                    <Text>
                        <Text color="cyan" bold>❯ </Text>
                        {input === '' ? (
                            <Text dimColor>{messages.length === 0 ? 'What do you want to automate?' : 'Ask anything...'}</Text>
                        ) : (
                            <Text>{input}<Text color="cyan">▎</Text></Text>
                        )}
                    </Text>
                </Box>
            ) : null}
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

    async function handleMessage(text: string): Promise<string> {
        const ui = (global as any).__rpUI;

        // Slash commands
        if (text === '/' || text === '/help') return '/model  /auto  /clear  /save  /usage  /memory  exit';
        if (text === '/clear') {conversationMessages.length = 0; return 'Cleared.';}
        if (text === '/usage') {
            const c = usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : '$0 (free)';
            return `${usage.totalTokens.toLocaleString()} tokens · ${usage.requests} requests · ${c}`;
        }
        if (text === '/auto') {autoAccept = !autoAccept; return `Auto-accept: ${autoAccept ? 'ON' : 'OFF'}`;}
        if (text === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            return models.map((m, i) => `${i + 1}. ${m.name} — ${m.desc}`).join('\n');
        }
        if (text.match(/^\/model \d+$/)) {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            const idx = parseInt(text.split(' ')[1], 10) - 1;
            if (idx >= 0 && idx < models.length) {config.model = models[idx].id; writeAiConfig(config); return `Model: ${models[idx].id}`;}
            return 'Invalid number.';
        }
        if (text === '/memory') {const m = loadMemory(); return m.facts.length ? m.facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n') : 'No memories.';}
        if (text.startsWith('/save')) {
            if (text.length > 5) sessionName = text.slice(5).trim();
            saveSession(sessionId, sessionName, conversationMessages, usage);
            return `Saved: ${sessionName}`;
        }
        if (text.startsWith('/')) return `Unknown: ${text}. Type / for help.`;

        // AI message
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
                    provider: activeProvider, model: activeModel, apiKey: activeKey,
                    cliContext,
                },
            );

            if (!result) {
                finalResponse = 'No internet connection. Check your network and try again.';
                break;
            }
            if ((result as any).error) {
                finalResponse = (result as any).error;
                break;
            }
            if (!result.code) {
                finalResponse = fullText || 'No response from AI. Try again.';
                break;
            }

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

            if (commands.length === 0) {
                finalResponse = cleaned || fullText;
                break;
            }

            // Show response, then execute commands
            if (cleaned) ui?.addMessage(cleaned);

            for (const cmd of commands) {
                const preview = cmd.split('\n')[0].slice(0, 80);
                ui?.addMessage(`$ ${preview}${cmd.includes('\n') ? ' ...' : ''}`);
                const r = await executeShellCommand(cmd);
                if (r.exitCode === 0 && r.stdout?.trim()) {
                    ui?.addMessage(r.stdout.trim().split('\n').slice(0, 5).join('\n'));
                } else if (r.exitCode !== 0) {
                    ui?.addMessage(`exit ${r.exitCode}: ${(r.stderr || '').slice(0, 100)}`);
                }
            }

            const summary = commands.map((cmd, i) => `$ ${cmd}\n(executed)`).join('\n');
            conversationMessages.push({role: 'user', content: `[Results]\n${summary}`});
            ui?.setStreaming('');
            finalResponse = '';
        }

        saveSession(sessionId, sessionName, conversationMessages, usage);
        return finalResponse;
    }

    const {waitUntilExit} = render(<ChatApp onMessage={handleMessage} />);

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
