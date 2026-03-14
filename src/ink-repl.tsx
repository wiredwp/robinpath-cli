/**
 * Ink-based AI REPL — renders React terminal UI.
 * Replaces the old raw-mode collectInput() loop.
 */
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App';
import { color, log, getShellConfig, getRobinPathHome, CLI_VERSION, setFlags } from './utils';
import { readAiConfig, AI_BRAIN_URL } from './config';
import type { AiConfig } from './config';
import { AI_MODELS } from './models';
import { createUsageTracker, estimateCost } from './models';
import type { UsageTracker } from './models';
import {
    saveSession, loadSession, listSessions, buildMemoryContext,
    extractMemoryTags, addMemoryFact, autoCompact,
} from './sessions';
import type { Message } from './sessions';
import { expandFileRefs } from './file-refs';
import { fetchBrainStream } from './brain';
import type { BrainStreamResult } from './brain';
import { executeShellCommand, extractCommands, stripCommandTags, detectFileWrite, showFileDiff } from './shell';
import { isDangerousCommand } from './ui';
import { readModulesManifest } from './commands-core';
import { getNativeModules } from './runtime';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

interface InkReplOptions {
    autoAccept?: boolean;
    devMode?: boolean;
}

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
        platform: platform(),
        shell: getShellConfig().name,
        cwd: process.cwd(),
        cliVersion: CLI_VERSION,
        nativeModules: getNativeModules().map((m: any) => m.name),
        installedModules: Object.keys(readModulesManifest()),
    };

    let sessionId = resumeSessionId || randomUUID().slice(0, 8);
    let sessionName = `session-${new Date().toISOString().slice(0, 10)}`;
    const usage: UsageTracker = createUsageTracker();
    const conversationMessages: Message[] = [];

    // Memory context
    const memContext = buildMemoryContext();
    if (memContext.trim()) {
        conversationMessages.push({ role: 'user', content: `[Context] ${memContext.trim()}` });
        conversationMessages.push({ role: 'assistant', content: 'Got it, I have your preferences loaded.' });
    }

    // Resume session
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
        }
    }

    // Auto-scan project
    let projectInfo = '';
    try {
        const cwd = process.cwd();
        const entries = readdirSync(cwd).filter(e => !e.startsWith('.'));
        let rpCount = 0, dirCount = 0;
        for (const entry of entries.slice(0, 100)) {
            try {
                const s = statSync(join(cwd, entry));
                if (s.isDirectory() && !['node_modules', '__pycache__', 'dist', 'build'].includes(entry)) dirCount++;
                else if (entry.endsWith('.rp') || entry.endsWith('.robin')) rpCount++;
            } catch {}
        }
        if (rpCount > 0 || dirCount > 0) {
            projectInfo = `${rpCount} .rp file(s), ${dirCount} dir(s)`;
        }
    } catch {}

    const modeStr = devMode ? 'dev (auto+verbose)' : autoAccept ? 'auto' : 'confirm';
    const cwdDisplay = process.cwd().replace(homedir(), '~');
    const cwdShort = cwdDisplay.length > 40 ? '...' + cwdDisplay.slice(-37) : cwdDisplay;

    // The message handler — called when user submits text from the InputBox
    async function handleMessage(text: string): Promise<string | null> {
        const ui = (global as any).__rpUI;

        // Slash commands
        if (text === '/help') {
            return 'Commands: /model, /shell, /auto, /clear, /save, /sessions, /resume, /memory, /usage, /scan, /help, exit';
        }
        if (text === 'exit' || text === 'quit') {
            if (conversationMessages.length > 1) {
                saveSession(sessionId, sessionName, conversationMessages, usage);
            }
            process.exit(0);
        }
        if (text === '/model') {
            const hasKey = !!readAiConfig().apiKey;
            const models = hasKey ? AI_MODELS : AI_MODELS.filter(m => !m.requiresKey);
            return models.map((m, i) => `${i + 1}. ${m.name} — ${m.desc}`).join('\n');
        }
        if (text === '/usage') {
            const cost = usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : '$0.00 (free)';
            return `Tokens: ${usage.totalTokens.toLocaleString()} | Requests: ${usage.requests} | Cost: ${cost}`;
        }
        if (text === '/clear') {
            conversationMessages.length = 0;
            return 'Conversation cleared.';
        }
        if (text.startsWith('/')) {
            return `Unknown command: ${text}. Type /help for commands.`;
        }

        // Expand @/ file references
        const { expanded } = expandFileRefs(text);

        // Add to conversation
        conversationMessages.push({ role: 'user', content: expanded });

        // Auto-compact
        await autoCompact(conversationMessages);

        // Stream from brain
        const activeModel = readAiConfig().model || model;
        const activeKey = (readAiConfig().apiKey as string) || apiKey;
        const activeProvider = resolveProvider(activeKey);

        let fullResponse = '';

        for (let loopCount = 0; loopCount < 15; loopCount++) {
            if (ui?.setSpinnerLabel) ui.setSpinnerLabel(loopCount === 0 ? 'Thinking...' : 'Processing...');

            const brainResult: BrainStreamResult | null = await fetchBrainStream(
                loopCount === 0 ? expanded : (conversationMessages[conversationMessages.length - 1].content as string),
                {
                    onToken: (delta: string) => {
                        if (delta === '\x1b[RETRY]') {
                            fullResponse = '';
                            if (ui?.setStreamText) ui.setStreamText('');
                            return;
                        }
                        // Strip tags from display
                        fullResponse += delta;
                        // Simple tag stripping for display
                        const clean = fullResponse
                            .replace(/<memory>[\s\S]*?<\/memory>/g, '')
                            .replace(/<cmd>[\s\S]*?<\/cmd>/g, '')
                            .replace(/\n{3,}/g, '\n\n');
                        if (ui?.setStreamText) ui.setStreamText(clean);
                    },
                    conversationHistory: conversationMessages.slice(0, -1),
                    provider: activeProvider,
                    model: activeModel,
                    apiKey: activeKey,
                    cliContext,
                },
            );

            if (!brainResult || !brainResult.code) {
                return fullResponse || 'Brain returned no response. Check your connection or API key.';
            }

            // Track usage
            if (brainResult.usage) {
                const pt = brainResult.usage.prompt_tokens || 0;
                const ct = brainResult.usage.completion_tokens || 0;
                usage.promptTokens += pt;
                usage.completionTokens += ct;
                usage.totalTokens += pt + ct;
                usage.requests++;
                usage.cost += estimateCost(activeModel, pt, ct);
            }

            const commands = extractCommands(brainResult.code);
            const { cleaned } = extractMemoryTags(stripCommandTags(brainResult.code));

            if (cleaned) {
                conversationMessages.push({ role: 'assistant', content: cleaned });
                fullResponse = cleaned;
            }

            // No commands — done
            if (commands.length === 0) break;

            // Execute commands
            const cmdResults: { command: string; stdout: string; stderr: string; exitCode: number }[] = [];
            for (const cmd of commands) {
                // Auto-accept or confirm (simplified for Ink — always auto in first pass)
                const result = await executeShellCommand(cmd);
                cmdResults.push({
                    command: cmd,
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    exitCode: result.exitCode,
                });
            }

            const summary = cmdResults.map(r => {
                let out = `$ ${r.command}\n`;
                if (r.exitCode === 0) out += r.stdout || '(no output)';
                else { out += `Exit code: ${r.exitCode}\n`; if (r.stderr) out += `stderr: ${r.stderr}`; }
                return out;
            }).join('\n\n');

            conversationMessages.push({ role: 'user', content: `[Command results]\n${summary}` });
            fullResponse = '';
            if (ui?.setStreamText) ui.setStreamText('');
        }

        // Save session
        saveSession(sessionId, sessionName, conversationMessages, usage);

        return null; // Response already added via streaming
    }

    // Render the Ink app
    const { waitUntilExit } = render(
        <App
            model={modelShort}
            mode={modeStr}
            dir={cwdShort}
            shell={getShellConfig().name}
            projectInfo={projectInfo}
            onSubmit={handleMessage}
        />,
    );

    await waitUntilExit();

    // Auto-save on exit
    if (conversationMessages.length > 1) {
        saveSession(sessionId, sessionName, conversationMessages, usage);
    }
}
