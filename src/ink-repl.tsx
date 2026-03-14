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
import {existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
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
function InputArea({onSubmit, placeholder, statusText}: {onSubmit: (v: string) => void; placeholder: string; statusText?: string}) {
    const [value, setValue] = useState('');
    const {exit} = useApp();

    const matchingCommands = useMemo(() => {
        if (!value.startsWith('/')) return [];
        if (value === '/') return Object.entries(COMMANDS);
        return Object.entries(COMMANDS).filter(([cmd]) => cmd.startsWith(value));
    }, [value]);

    const showHints = value.startsWith('/') && matchingCommands.length > 0;

    // File picker — show files when @ is typed (like Claude Code)
    const showFiles = useMemo(() => {
        const atMatch = value.match(/@(\S*)$/);
        if (!atMatch) return [];
        const prefix = atMatch[1] || '';
        try {
            const entries = readdirSync(process.cwd());
            return entries
                .filter(e => !e.startsWith('.') && (!prefix || e.toLowerCase().startsWith(prefix.toLowerCase())))
                .slice(0, 10)
                .map(e => {
                    try {
                        const s = statSync(join(process.cwd(), e));
                        return { name: e, isDir: s.isDirectory() };
                    } catch { return { name: e, isDir: false }; }
                });
        } catch { return []; }
    }, [value]);

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
            if (matchingCommands.length === 1) { setValue(matchingCommands[0][0]); return; }
            if (showFiles.length > 0) {
                // Complete first matching file after @
                const atMatch = value.match(/@(\S*)$/);
                if (atMatch) {
                    const before = value.slice(0, value.length - atMatch[0].length);
                    setValue(before + '@' + showFiles[0].name + ' ');
                }
            }
            return;
        }
        if (ch === '\x15') {setValue(''); return;}
        if (ch === '\x17') {setValue(p => p.replace(/\S+\s*$/, '')); return;}
        if (ch && !key.ctrl && !key.meta) setValue(p => p + ch);
    });

    const lines = value.split('\n');
    const empty = value === '';
    const w = Math.min(process.stdout.columns - 4 || 76, 76);

    // Render @filename in cyan/bold if file exists, white if not
    function renderLineWithFileRefs(line: string): React.ReactNode[] {
        const parts: React.ReactNode[] = [];
        const refRegex = /@([\w.\-]+)/g;
        let lastIdx = 0;
        let m;
        let k = 0;
        while ((m = refRegex.exec(line)) !== null) {
            if (m.index > lastIdx) parts.push(<Text key={k++}>{line.slice(lastIdx, m.index)}</Text>);
            const fileName = m[1];
            const fileExists = existsSync(join(process.cwd(), fileName));
            parts.push(<Text key={k++} color={fileExists ? 'cyan' : undefined} bold={fileExists}>@{fileName}</Text>);
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < line.length) parts.push(<Text key={k++}>{line.slice(lastIdx)}</Text>);
        return parts.length > 0 ? parts : [<Text key={0}>{line}</Text>];
    }

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
                                {renderLineWithFileRefs(line)}
                                {i === lines.length - 1 ? <Text color="cyan">▎</Text> : null}
                            </Text>
                        ))
                    )}
                </Box>
                <Text dimColor>{'─'.repeat(Math.max(process.stdout.columns || 80, 40))}</Text>
            </Box>

            {/* File picker — shows when @ is typed */}
            {showFiles.length > 0 && (
                <Box flexDirection="column" paddingX={2} marginTop={1}>
                    {showFiles.map(f => (
                        <Text key={f.name}>
                            <Text color="cyan">+ </Text>
                            <Text bold={f.name.endsWith('.rp') || f.name.endsWith('.robin')}>{f.name}</Text>
                            {f.isDir ? <Text dimColor>/</Text> : null}
                        </Text>
                    ))}
                </Box>
            )}

            <Box paddingX={2} justifyContent="space-between">
                <Text dimColor>/ for commands · @ for files</Text>
                <Text dimColor>{statusText || ''}</Text>
            </Box>
        </Box>
    );
}

// ── Trust Prompt ──
function TrustPrompt({cwd, onAccept, onReject}: {cwd: string; onAccept: () => void; onReject: () => void}) {
    const [selected, setSelected] = useState(0);

    useInput((ch, key) => {
        if (key.upArrow) setSelected(0);
        if (key.downArrow) setSelected(1);
        if (key.return) {
            if (selected === 0) onAccept();
            else onReject();
        }
        if (key.escape) onReject();
        if (ch === '1') { setSelected(0); onAccept(); }
        if (ch === '2') { setSelected(1); onReject(); }
    });

    return (
        <Box flexDirection="column" paddingY={1}>
            <Box marginBottom={1} paddingX={1}>
                <Text><Text color="cyan" bold>◆</Text> <Text bold>RobinPath</Text> <Text dimColor>v{CLI_VERSION}</Text></Text>
            </Box>

            <Text dimColor>{'─'.repeat(Math.max(process.stdout.columns || 80, 40))}</Text>

            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text bold>Workspace:</Text>
                <Text> </Text>
                <Text color="cyan">{cwd}</Text>
                <Text> </Text>
                <Text wrap="wrap" dimColor>
                    RobinPath can read, edit, and execute files in this folder.
                    Make sure this is a project you created or trust.
                </Text>
                <Text> </Text>
                <Text>
                    {selected === 0 ? <Text color="cyan" bold>❯ </Text> : <Text>  </Text>}
                    <Text bold={selected === 0}>Yes, I trust this folder</Text>
                </Text>
                <Text>
                    {selected === 1 ? <Text color="cyan" bold>❯ </Text> : <Text>  </Text>}
                    <Text bold={selected === 1}>No, exit</Text>
                </Text>
            </Box>

            <Text dimColor>{'─'.repeat(Math.max(process.stdout.columns || 80, 40))}</Text>
            <Box paddingX={2}><Text dimColor>↑↓ select · enter confirm · esc cancel</Text></Box>
        </Box>
    );
}

// ── Model Selector ──
function ModelSelector({models, currentId, onSelect, onCancel}: {
    models: {id: string; name: string; desc: string; group: string}[];
    currentId: string;
    onSelect: (id: string) => void;
    onCancel: () => void;
}) {
    const [cursor, setCursor] = useState(() => Math.max(0, models.findIndex(m => m.id === currentId)));

    useInput((ch, key) => {
        if (key.upArrow) setCursor(c => Math.max(0, c - 1));
        if (key.downArrow) setCursor(c => Math.min(models.length - 1, c + 1));
        if (key.return) onSelect(models[cursor].id);
        if (key.escape) onCancel();
    });

    let lastGroup = '';
    return (
        <Box flexDirection="column" paddingX={2} marginY={1}>
            {models.map((m, i) => {
                const showGroup = m.group !== lastGroup;
                lastGroup = m.group;
                const isCurrent = m.id === currentId;
                const isSelected = i === cursor;
                return (
                    <Box key={m.id} flexDirection="column">
                        {showGroup && <Text dimColor>{`── ${m.group} ──`}</Text>}
                        <Text>
                            {isSelected ? <Text color="cyan" bold>{'❯ '}</Text> : <Text>{'  '}</Text>}
                            <Text bold={isSelected}>{m.name.padEnd(22)}</Text>
                            <Text dimColor>{m.desc}</Text>
                            {isCurrent ? <Text color="green">{' ✓'}</Text> : null}
                        </Text>
                    </Box>
                );
            })}
            <Text dimColor>{'\n  ↑↓ select · enter confirm · esc cancel'}</Text>
        </Box>
    );
}

// ── Main App ──
function ChatApp({engine}: {engine: ReplEngine}) {
    const [trusted, setTrusted] = useState(() => {
        // Check if this directory was previously trusted
        try {
            const trustFile = join(getRobinPathHome(), 'trusted-dirs.json');
            if (existsSync(trustFile)) {
                const dirs: string[] = JSON.parse(readFileSync(trustFile, 'utf-8'));
                return dirs.includes(process.cwd());
            }
        } catch {}
        return false;
    });
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [showModelPicker, setShowModelPicker] = useState(false);

    useEffect(() => {
        engine.ui = {
            setStreaming, setLoading, setStatus, setShowModelPicker,
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
        } finally {
            setLoading(false);
            setStreaming('');
            engine.updateStatus();
        }
    }, [engine]);

    // Trust prompt
    if (!trusted) {
        return (
            <TrustPrompt
                cwd={process.cwd()}
                onAccept={() => {
                    setTrusted(true);
                    // Save trust
                    try {
                        const trustFile = join(getRobinPathHome(), 'trusted-dirs.json');
                        let dirs: string[] = [];
                        if (existsSync(trustFile)) dirs = JSON.parse(readFileSync(trustFile, 'utf-8'));
                        if (!dirs.includes(process.cwd())) dirs.push(process.cwd());
                        writeFileSync(trustFile, JSON.stringify(dirs, null, 2));
                    } catch {}
                }}
                onReject={() => process.exit(0)}
            />
        );
    }

    const modelName = engine.model.includes('/') ? engine.model.split('/').pop() : engine.model;
    const cwdShort = process.cwd().replace(homedir(), '~');
    const isFirst = messages.length === 0;

    return (
        <Box flexDirection="column" paddingY={1}>
            {/* Welcome banner — only shows before first message */}
            {isFirst && !loading ? (
                <Box borderStyle="round" borderColor="gray" paddingX={1}>
                    <Box flexDirection="column" width="50%">
                        <Text bold>  Welcome to RobinPath!</Text>
                        <Text>  <Text color="cyan" bold>◆</Text> <Text dimColor>{modelName}</Text></Text>
                        <Text>  <Text dimColor>{cwdShort}</Text></Text>
                    </Box>
                    <Box flexDirection="column" width="50%">
                        <Text dimColor>Type <Text color="cyan">/</Text> to see commands</Text>
                        <Text dimColor>Use <Text color="cyan">@/file</Text> to include files</Text>
                        <Text dimColor>Use <Text color="cyan">\</Text> for multiline</Text>
                    </Box>
                </Box>
            ) : null}

            <Static items={messages}>
                {msg => (
                    <Box key={msg.id} paddingX={1} marginBottom={msg.text.startsWith('❯') ? 0 : 1} flexDirection="column">
                        {msg.text.startsWith('❯') ? (
                            <Text><Text color="cyan" bold>❯</Text><Text bold>{msg.text.slice(1)}</Text></Text>
                        ) : msg.text.includes('⎿') ? (
                            <Text dimColor wrap="wrap">{msg.text}</Text>
                        ) : msg.dim ? (
                            <Text dimColor wrap="wrap">{msg.text}</Text>
                        ) : (
                            <Markdown>{msg.text}</Markdown>
                        )}
                    </Box>
                )}
            </Static>

            {showModelPicker ? (
                <ModelSelector
                    models={AI_MODELS}
                    currentId={readAiConfig().model || engine.model}
                    onSelect={(id) => {
                        engine.config.model = id;
                        engine.model = id;
                        writeAiConfig(engine.config);
                        setMessages(p => [...p, {id: ++nextId, text: `✓ Model: ${id.includes('/') ? id.split('/').pop() : id}`, dim: true}]);
                        setShowModelPicker(false);
                        engine.updateStatus();
                    }}
                    onCancel={() => setShowModelPicker(false)}
                />
            ) : loading ? (
                <Box flexDirection="column" paddingX={1}>
                    {streaming ? (
                        <Text wrap="wrap">{streaming}</Text>
                    ) : (
                        <Text dimColor><InkSpinner type="dots" /> Thinking</Text>
                    )}
                </Box>
            ) : (
                <InputArea
                    onSubmit={handleSubmit}
                    placeholder="Message RobinPath..."
                    statusText={status}
                />
            )}
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
        this.model = this.config.model || 'anthropic/claude-sonnet-4.6';
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
        if (!key) return 'openrouter';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-')) return 'openai';
        return (this.config.provider as string) || 'openrouter';
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
        if (text === '/model' || text.startsWith('/model ')) {
            this.ui?.setShowModelPicker(true);
            return '';
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
        let finalResponse = '';
        try {
        const {expanded} = expandFileRefs(text);
        this.conversationMessages.push({role: 'user', content: expanded});
        await autoCompact(this.conversationMessages);

        const activeModel = readAiConfig().model || this.model;
        const activeKey = (readAiConfig().apiKey as string) || this.apiKey;
        const activeProvider = this.resolveProvider(activeKey);

        for (let loop = 0; loop < 5; loop++) {
            let fullText = '';
            let lastUpdate = 0;

            const result: BrainStreamResult | null = await fetchBrainStream(
                loop === 0 ? expanded : this.conversationMessages[this.conversationMessages.length - 1].content as string,
                {
                    onToken: (delta: string) => {
                        if (delta === '\x1b[RETRY]') {fullText = ''; lastUpdate = 0; ui?.setStreaming(''); return;}
                        fullText += delta;
                        // Throttle UI updates to every 100ms (like Claude Code)
                        const now = Date.now();
                        if (now - lastUpdate < 100) return;
                        lastUpdate = now;
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

            // Final flush of streaming text (throttle may have skipped last tokens)
            if (fullText) {
                const finalClean = fullText
                    .replace(/<memory>[\s\S]*?<\/memory>/g, '')
                    .replace(/<cmd>[\s\S]*?<\/cmd>/g, '')
                    .replace(/\n{3,}/g, '\n\n').trim();
                ui?.setStreaming(finalClean);
            }

            if (!result) {finalResponse = '⚠ No internet connection. Check your network and try again.'; break;}
            if ((result as any).error) {finalResponse = `⚠ ${(result as any).error}`; break;}
            if (!result.code) {
                const model = readAiConfig().model || this.model;
                const hint = 'The AI returned an empty response. Try rephrasing or check your API key with /usage.';
                finalResponse = fullText || `⚠ ${hint}`;
                break;
            }

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

            // Move response text to Static, show "Running" state for commands
            ui?.setStreaming('');
            if (cleaned) ui?.addMessage(cleaned);
            // Yield to React to flush the state change
            await new Promise(r => setTimeout(r, 100));

            // Execute commands and collect results
            const cmdResults: {command: string; stdout: string; stderr: string; exitCode: number}[] = [];
            for (const cmd of commands) {
                const firstLine = cmd.split('\n')[0].slice(0, 70);
                const isMultiline = cmd.includes('\n');
                const r = await executeShellCommand(cmd);
                cmdResults.push({command: cmd, stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.exitCode});

                // Claude Code-style tool result display
                if (r.exitCode === 0) {
                    const output = (r.stdout || '').trim();
                    if (output) {
                        const lines = output.split('\n');
                        const preview = lines.length <= 4
                            ? lines.map(l => `     ${l}`).join('\n')
                            : lines.slice(0, 3).map(l => `     ${l}`).join('\n') + `\n     … ${lines.length - 3} more lines`;
                        ui?.addMessage(`  ⎿  Execute(${firstLine}${isMultiline ? ' …' : ''})\n${preview}`, true);
                    } else {
                        ui?.addMessage(`  ⎿  Execute(${firstLine}${isMultiline ? ' …' : ''})`, true);
                    }
                } else {
                    const errLine = (r.stderr || '').trim().split('\n')[0].slice(0, 70);
                    ui?.addMessage(`  ⎿  Execute(${firstLine}${isMultiline ? ' …' : ''})\n     ✗ ${errLine}`, true);
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
            // Yield to let React flush state before next Brain call
            await new Promise(r => setTimeout(r, 50));
        }

        } catch (err: any) {
            finalResponse = `⚠ Error: ${err.message}`;
        } finally {
            // ALWAYS clear streaming state — prevents stuck cursor
            ui?.setStreaming('');
            ui?.setLoading(false);
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
