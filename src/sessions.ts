/**
 * RobinPath CLI — Session persistence, memory, auto-compaction
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { AI_SESSIONS_DIR, AI_BRAIN_URL } from './config';
import { getRobinPathHome } from './utils';
import type { UsageTracker } from './models';

// ============================================================================
// Interfaces
// ============================================================================

export interface SessionInfo {
    id: string;
    name: string;
    created: string;
    updated: string;
    messages: number;
}

export interface Session {
    id: string;
    name: string;
    created: string;
    updated: string;
    messages: Message[];
    usage?: UsageTracker;
}

export interface Message {
    role: string;
    content: string | unknown;
}

export interface Memory {
    facts: string[];
    updatedAt: string | null;
}

// ============================================================================
// Session persistence
// ============================================================================

export function getSessionPath(sessionId: string): string {
    return join(AI_SESSIONS_DIR, `${sessionId}.json`);
}

export function listSessions(): SessionInfo[] {
    if (!existsSync(AI_SESSIONS_DIR)) return [];
    return readdirSync(AI_SESSIONS_DIR)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string): SessionInfo | null => {
            try {
                const data = JSON.parse(readFileSync(join(AI_SESSIONS_DIR, f), 'utf-8'));
                return { id: data.id, name: data.name, created: data.created, updated: data.updated, messages: data.messages?.length || 0 };
            } catch { return null; }
        })
        .filter((x): x is SessionInfo => x !== null)
        .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
}

export function saveSession(sessionId: string, name: string, messages: Message[], usage?: UsageTracker): void {
    if (!existsSync(AI_SESSIONS_DIR)) mkdirSync(AI_SESSIONS_DIR, { recursive: true });
    const data: Session = {
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

export function loadSession(sessionId: string): Session | null {
    const p = getSessionPath(sessionId);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

export function deleteSession(sessionId: string): boolean {
    const p = getSessionPath(sessionId);
    if (existsSync(p)) { unlinkSync(p); return true; }
    return false;
}

// ============================================================================
// Persistent memory across sessions
// ============================================================================

const AI_MEMORY_PATH: string = join(homedir(), '.robinpath', 'memory.json');

export function loadMemory(): Memory {
    try {
        if (existsSync(AI_MEMORY_PATH)) {
            return JSON.parse(readFileSync(AI_MEMORY_PATH, 'utf-8'));
        }
    } catch { /* ignore */ }
    return { facts: [], updatedAt: null };
}

export function saveMemory(memory: Memory): void {
    try {
        const dir = join(homedir(), '.robinpath');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        memory.updatedAt = new Date().toISOString();
        writeFileSync(AI_MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8');
    } catch { /* ignore */ }
}

export function addMemoryFact(fact: string): boolean {
    const memory = loadMemory();
    // Avoid duplicates
    const lower = fact.toLowerCase().trim();
    if (memory.facts.some((f: string) => f.toLowerCase().trim() === lower)) return false;
    memory.facts.push(fact.trim());
    // Keep max 50 facts
    if (memory.facts.length > 50) memory.facts = memory.facts.slice(-50);
    saveMemory(memory);
    return true;
}

export function removeMemoryFact(index: number): string | null {
    const memory = loadMemory();
    if (index >= 0 && index < memory.facts.length) {
        const removed = memory.facts.splice(index, 1);
        saveMemory(memory);
        return removed[0];
    }
    return null;
}

export function buildMemoryContext(): string {
    const memory = loadMemory();
    if (memory.facts.length === 0) return '';
    return '\n\n## User Memory (persistent across sessions)\n' +
        memory.facts.map((f: string) => `- ${f}`).join('\n') + '\n';
}

/**
 * Extract <memory>...</memory> tags from an AI response.
 * The LLM decides what's worth remembering — no hardcoded patterns.
 * Returns the cleaned response (tags stripped) and any extracted facts.
 */
export function extractMemoryTags(response: string): { cleaned: string; facts: string[] } {
    const facts: string[] = [];
    const cleaned = response.replace(/<memory>([\s\S]*?)<\/memory>/gi, (_: string, fact: string) => {
        const trimmed = fact.trim();
        if (trimmed.length > 3 && trimmed.length < 300) facts.push(trimmed);
        return ''; // strip from displayed output
    }).replace(/\n{3,}/g, '\n\n').trim(); // clean up extra newlines left behind
    return { cleaned, facts };
}

// ============================================================================
// Auto-compaction: summarize old messages when conversation gets long
// ============================================================================

/** Approximate token count (1 token ~ 4 chars). */
export function estimateTokens(messages: Message[]): number {
    return messages.reduce((sum: number, m: Message) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        return sum + Math.ceil(content.length / 4);
    }, 0);
}

/** Max tokens before auto-compaction triggers. */
const COMPACTION_THRESHOLD: number = 30000; // ~30k tokens
/** Keep this many recent messages intact after compaction. */
const KEEP_RECENT: number = 10;

/**
 * Auto-compact conversation if it exceeds the token threshold.
 * Summarizes older messages into a single compact message.
 * Uses the brain to generate the summary.
 */
export async function autoCompact(conversationMessages: Message[]): Promise<boolean> {
    const tokens = estimateTokens(conversationMessages);
    if (tokens < COMPACTION_THRESHOLD || conversationMessages.length <= KEEP_RECENT + 2) {
        return false; // No compaction needed
    }

    const systemMsg = conversationMessages[0];
    const oldMessages = conversationMessages.slice(1, -KEEP_RECENT);
    const recentMessages = conversationMessages.slice(-KEEP_RECENT);

    // Build summary request
    const summaryText = oldMessages
        .map((m: Message) => `${m.role}: ${(typeof m.content === 'string' ? m.content : '').slice(0, 500)}`)
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
        const summary: string = data.code || '';
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
