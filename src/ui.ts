/**
 * RobinPath CLI — Interactive pickers, command permissions, response formatting
 */
import { color, log } from './utils';
import { AI_MODELS } from './models';
import type { ModelInfo } from './models';
import { listSessions } from './sessions';
import type { SessionInfo } from './sessions';

// ============================================================================
// Interfaces
// ============================================================================

export type PickerKeyResult = 'render' | string | null | undefined;

export interface PickerOptions {
    renderFn: (out: (text: string) => void) => void;
    onKeyFn: (key: string) => PickerKeyResult;
}

export type ConfirmResult = 'yes' | 'no' | 'auto' | 'edit';

// ============================================================================
// Interactive picker infrastructure
// ============================================================================

// Single reusable raw-keypress handler that properly manages TTY state.
// Prevents the bugs from mixing readline + raw mode on the same stdin.
export function createInteractivePicker({ renderFn, onKeyFn }: PickerOptions): Promise<string | null> {
    if (!process.stdin.isTTY) return Promise.resolve(null);

    return new Promise((resolve) => {
        let renderedLines = 0;
        let resolved = false;

        function clearRendered(): void {
            for (let i = 0; i < renderedLines; i++) {
                process.stdout.write('\x1b[1A\x1b[2K');
            }
            renderedLines = 0;
        }

        function render(): void {
            clearRendered();
            let count = 0;
            const out = (text: string): void => {
                process.stdout.write(text + '\n');
                count++;
            };
            renderFn(out);
            renderedLines = count;
        }

        function done(value: string | null): void {
            if (resolved) return;
            resolved = true;
            process.stdin.removeListener('data', onKey);
            try {
                process.stdin.setRawMode(false);
            } catch {}
            process.stdin.pause();
            clearRendered();
            resolve(value);
        }

        function onKey(buf: Buffer): void {
            const key = buf.toString();
            // Always handle Ctrl+C
            if (key === '\x03') {
                done(null);
                return;
            }
            const result = onKeyFn(key);
            if (result === 'render') {
                render();
            } else if (result !== undefined) {
                done(result);
            }
        }

        render();
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onKey);
    });
}

// ============================================================================
// Model picker
// ============================================================================

/** Interactive arrow-key model selector. Returns selected model ID or null if cancelled. */
export function selectModelInteractive(currentModelId: string): Promise<string | null> {
    const models: ModelInfo[] = AI_MODELS;
    let cursor = Math.max(
        0,
        models.findIndex((m) => m.id === currentModelId),
    );

    return createInteractivePicker({
        renderFn: (out) => {
            out('');
            out(color.bold('  Select AI Model'));
            out(color.dim('  \u2191\u2193 navigate  Enter select  Esc cancel'));
            out('');
            let lastGroup = '';
            let itemIdx = 0;
            for (const m of models) {
                if (m.group !== lastGroup) {
                    out(color.dim(`  \u2500\u2500 ${m.group} \u2500\u2500`));
                    lastGroup = m.group;
                }
                const sel = itemIdx === cursor;
                const marker = sel ? color.cyan('\u276f') : ' ';
                const name = sel ? color.cyan(color.bold(m.name)) : m.name;
                const desc = color.dim(`\u2014 ${m.desc}`);
                const cur = m.id === currentModelId ? color.green(' \u2713') : '';
                out(`  ${marker} ${name} ${desc}${cur}`);
                out(`      ${color.dim(m.id)}`);
                itemIdx++;
            }
            out('');
        },
        onKeyFn: (key) => {
            if (key === '\x1b') return null;
            if (key === '\r' || key === '\n') return models[cursor].id;
            if (key === '\x1b[A' || key === 'k') {
                cursor = Math.max(0, cursor - 1);
                return 'render';
            }
            if (key === '\x1b[B' || key === 'j') {
                cursor = Math.min(models.length - 1, cursor + 1);
                return 'render';
            }
        },
    });
}

// ============================================================================
// Session picker
// ============================================================================

/** Interactive arrow-key session picker. Returns session ID or null. */
export function selectSessionInteractive(): Promise<string | null> {
    const sessions: SessionInfo[] = listSessions();
    if (sessions.length === 0) {
        log(color.dim('  No saved sessions.'));
        return Promise.resolve(null);
    }

    let cursor = 0;

    function timeAgo(dateStr: string): string {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    return createInteractivePicker({
        renderFn: (out) => {
            out('');
            out(color.bold('  Select Session'));
            out(color.dim('  \u2191\u2193 navigate  Enter select  Esc cancel'));
            out('');
            for (let i = 0; i < sessions.length; i++) {
                const s = sessions[i];
                const marker = i === cursor ? color.cyan('\u276f') : ' ';
                const name = i === cursor ? color.cyan(color.bold(s.name)) : s.name;
                const meta = color.dim(`${timeAgo(s.updated || s.created)}, ${s.messages} msgs`);
                out(`  ${marker} ${name}  ${meta}`);
                out(color.dim(`      id: ${s.id}`));
            }
            out('');
        },
        onKeyFn: (key) => {
            if (key === '\x1b') return null;
            if (key === '\r' || key === '\n') return sessions[cursor].id;
            if (key === '\x1b[A' || key === 'k') {
                cursor = Math.max(0, cursor - 1);
                return 'render';
            }
            if (key === '\x1b[B' || key === 'j') {
                cursor = Math.min(sessions.length - 1, cursor + 1);
                return 'render';
            }
        },
    });
}

// ============================================================================
// Command permission system
// ============================================================================

export const DANGEROUS_PATTERNS: RegExp[] = [
    /\brm\s+/i,
    /\brmdir\s+/i,
    /\bdel\s+/i,
    /\brd\s+/i,
    /\bkill\s+/i,
    /\bpkill\s+/i,
    /\btaskkill\s+/i,
    /\bchmod\s+/i,
    /\bchown\s+/i,
    /\bcurl\b.*-X\s*(DELETE|PUT|POST)/i,
    /\bgit\s+push\b/i,
    /\bgit\s+reset\s+--hard/i,
    /\bgit\s+clean\b/i,
    /\bgit\s+checkout\s+\.\s*$/i,
    /\bgit\s+restore\s+\.\s*$/i,
    /\bnpm\s+publish\b/i,
    /\bsudo\s+/i,
    /\bsu\s+/i,
    /\bdd\s+if=/i,
    /\bmkfs\b/i,
    /\bformat\s+[a-zA-Z]:/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
];

export function isDangerousCommand(cmd: string): boolean {
    return DANGEROUS_PATTERNS.some((p) => p.test(cmd));
}

/** Single-keypress command confirmation. Returns 'yes'|'no'|'auto'|'edit'. */
export function confirmCommand(cmd: string, autoAccept: boolean): Promise<ConfirmResult> {
    // Auto-accept safe commands
    if (autoAccept && !isDangerousCommand(cmd)) {
        const preview = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
        log(color.dim(`  $ ${preview}`));
        return Promise.resolve('yes');
    }

    const dangerous = isDangerousCommand(cmd);

    // Non-interactive — auto-accept safe, reject dangerous
    if (!process.stdin.isTTY) {
        const preview = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
        log(color.dim(`  $ ${preview}`));
        return Promise.resolve(dangerous ? 'no' : 'yes');
    }

    return new Promise((resolve) => {
        // Show first line of command for readability
        const firstLine = cmd.split('\n')[0];
        const preview = firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine;
        const multiline = cmd.includes('\n') ? color.dim(` (+${cmd.split('\n').length - 1} lines)`) : '';
        let resolved = false;

        log('');
        if (dangerous) {
            log(color.red('  ! dangerous command'));
        }
        log(`  ${color.dim('$')} ${preview}${multiline}`);
        const opts = dangerous
            ? `  ${color.green('[y]')} run  ${color.red('[n]')} skip  ${color.cyan('[e]')} edit  `
            : `  ${color.green('[y]')} run  ${color.red('[n]')} skip  ${color.cyan('[a]')} always  ${color.cyan('[e]')} edit  `;
        process.stdout.write(opts);

        process.stdin.setRawMode(true);
        process.stdin.resume();

        const onKey = (buf: Buffer): void => {
            if (resolved) return;
            resolved = true;
            const key = buf.toString().toLowerCase();
            process.stdin.removeListener('data', onKey);
            try {
                process.stdin.setRawMode(false);
            } catch {}
            process.stdin.pause();
            process.stdout.write('\n');

            if (key === 'y' || key === '\r' || key === '\n') {
                resolve('yes');
            } else if (key === 'a' && !dangerous) {
                resolve('auto');
            } else if (key === 'e') {
                resolve('edit');
            } else {
                resolve('no');
            }
        };

        process.stdin.on('data', onKey);
    });
}

// ============================================================================
// Response formatting
// ============================================================================

// Format AI response with basic markdown rendering
export function formatAiResponse(text: string): string {
    const lines = text.split('\n');
    let inCodeBlock = false;
    const formatted: string[] = [];

    for (const line of lines) {
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            if (inCodeBlock) {
                formatted.push(color.dim('\u2500'.repeat(Math.min(process.stdout.columns || 60, 60))));
            } else {
                formatted.push(color.dim('\u2500'.repeat(Math.min(process.stdout.columns || 60, 60))));
            }
            continue;
        }

        if (inCodeBlock) {
            formatted.push('  ' + color.cyan(line));
            continue;
        }

        // Bold: **text**
        let formatted_line = line.replace(/\*\*(.+?)\*\*/g, (_: string, t: string) => color.bold(t));
        // Inline code: `text`
        formatted_line = formatted_line.replace(/`([^`]+)`/g, (_: string, t: string) => color.cyan(t));
        // Headers
        if (formatted_line.startsWith('## ')) {
            formatted_line = '\n' + color.bold(formatted_line.slice(3));
        } else if (formatted_line.startsWith('# ')) {
            formatted_line = '\n' + color.bold(formatted_line.slice(2));
        }
        // Bullet points
        if (formatted_line.startsWith('- ')) {
            formatted_line = '  \u2022 ' + formatted_line.slice(2);
        }

        formatted.push(formatted_line);
    }

    return formatted.join('\n');
}
