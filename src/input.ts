/**
 * RobinPath CLI — Custom multi-line input handler (replaces readline).
 *
 * Uses raw mode on stdin for full keypress control.
 * Supports multi-line input, history, tab completion, paste detection.
 * Eliminates all readline-vs-raw-mode conflicts.
 */
import { color } from './utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface InputOptions {
    prompt?: string;
    continuation?: string;
    history?: string[];
    completer?: (line: string) => [string[], string];
    hint?: string;
}

interface InputState {
    lines: string[];
    cursorRow: number;
    cursorCol: number;
    historyIndex: number;
    savedInput: string;
    renderedLineCount: number;
}

const PROMPT_DEFAULT = color.cyan('\u276f ');
const CONTINUATION_DEFAULT = color.dim('\u00b7 ');

/**
 * Collect user input with multi-line support.
 * Returns the input string, or null if user wants to exit (Ctrl+C on empty).
 */
export async function collectInput(opts: InputOptions = {}): Promise<string | null> {
    const prompt = opts.prompt ?? PROMPT_DEFAULT;
    const continuation = opts.continuation ?? CONTINUATION_DEFAULT;
    const history = opts.history ?? [];
    const completer = opts.completer ?? null;
    const hint = opts.hint ?? '';

    // Non-TTY fallback — read a line from stdin
    if (!process.stdin.isTTY) {
        return new Promise<string | null>((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf-8');
            const onData = (chunk: string): void => { data += chunk; };
            const onEnd = (): void => {
                process.stdin.removeListener('data', onData);
                process.stdin.removeListener('end', onEnd);
                resolve(data.trim() || null);
            };
            process.stdin.on('data', onData);
            process.stdin.on('end', onEnd);
        });
    }

    const state: InputState = {
        lines: [''],
        cursorRow: 0,
        cursorCol: 0,
        historyIndex: -1,
        savedInput: '',
        renderedLineCount: 0,
    };

    const cols = process.stdout.columns || 80;

    // ── Rendering ──

    function clearRendered(): void {
        for (let i = 0; i < state.renderedLineCount; i++) {
            process.stdout.write('\x1b[1A\x1b[2K');
        }
        process.stdout.write('\x1b[2K\r');
        state.renderedLineCount = 0;
    }

    function render(): void {
        clearRendered();
        const isEmpty = state.lines.length === 1 && state.lines[0] === '';
        let lineCount = 0;

        for (let i = 0; i < state.lines.length; i++) {
            const prefix = i === 0 ? prompt : continuation;
            const lineText = state.lines[i];
            // Show hint on empty first line
            const display = (i === 0 && isEmpty && hint) ? color.dim(hint) : lineText;
            process.stdout.write(prefix + display);
            if (i < state.lines.length - 1) {
                process.stdout.write('\n');
            }
            lineCount++;
        }

        // Position cursor correctly
        // Move cursor to the right line
        const linesFromBottom = state.lines.length - 1 - state.cursorRow;
        if (linesFromBottom > 0) {
            process.stdout.write(`\x1b[${linesFromBottom}A`);
        }
        // Move cursor to the right column
        const prefixLen = state.cursorRow === 0 ? stripAnsi(prompt).length : stripAnsi(continuation).length;
        process.stdout.write(`\r\x1b[${prefixLen + state.cursorCol}C`);

        state.renderedLineCount = lineCount - 1; // lines below the first line
    }

    function stripAnsi(s: string): string {
        return s.replace(/\x1b\[[0-9;]*m/g, '');
    }

    function getInputText(): string {
        return state.lines.join('\n');
    }

    function isEmpty(): boolean {
        return state.lines.length === 1 && state.lines[0] === '';
    }

    // ── Key actions ──

    function insertChar(ch: string): void {
        const line = state.lines[state.cursorRow];
        state.lines[state.cursorRow] = line.slice(0, state.cursorCol) + ch + line.slice(state.cursorCol);
        state.cursorCol += ch.length;
    }

    function insertNewLine(): void {
        const line = state.lines[state.cursorRow];
        const before = line.slice(0, state.cursorCol);
        const after = line.slice(state.cursorCol);
        state.lines[state.cursorRow] = before;
        state.lines.splice(state.cursorRow + 1, 0, after);
        state.cursorRow++;
        state.cursorCol = 0;
    }

    function backspace(): void {
        if (state.cursorCol > 0) {
            const line = state.lines[state.cursorRow];
            state.lines[state.cursorRow] = line.slice(0, state.cursorCol - 1) + line.slice(state.cursorCol);
            state.cursorCol--;
        } else if (state.cursorRow > 0) {
            // Join with previous line
            const currentLine = state.lines[state.cursorRow];
            const prevLine = state.lines[state.cursorRow - 1];
            state.cursorCol = prevLine.length;
            state.lines[state.cursorRow - 1] = prevLine + currentLine;
            state.lines.splice(state.cursorRow, 1);
            state.cursorRow--;
        }
    }

    function deleteChar(): void {
        const line = state.lines[state.cursorRow];
        if (state.cursorCol < line.length) {
            state.lines[state.cursorRow] = line.slice(0, state.cursorCol) + line.slice(state.cursorCol + 1);
        } else if (state.cursorRow < state.lines.length - 1) {
            // Join with next line
            state.lines[state.cursorRow] = line + state.lines[state.cursorRow + 1];
            state.lines.splice(state.cursorRow + 1, 1);
        }
    }

    function moveLeft(): void {
        if (state.cursorCol > 0) {
            state.cursorCol--;
        } else if (state.cursorRow > 0) {
            state.cursorRow--;
            state.cursorCol = state.lines[state.cursorRow].length;
        }
    }

    function moveRight(): void {
        if (state.cursorCol < state.lines[state.cursorRow].length) {
            state.cursorCol++;
        } else if (state.cursorRow < state.lines.length - 1) {
            state.cursorRow++;
            state.cursorCol = 0;
        }
    }

    function moveUp(): void {
        if (state.lines.length > 1 && state.cursorRow > 0) {
            // Multi-line: move cursor up
            state.cursorRow--;
            state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorRow].length);
        } else {
            // Single-line or at top: navigate history
            navigateHistory(-1);
        }
    }

    function moveDown(): void {
        if (state.lines.length > 1 && state.cursorRow < state.lines.length - 1) {
            // Multi-line: move cursor down
            state.cursorRow++;
            state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorRow].length);
        } else {
            // Single-line or at bottom: navigate history
            navigateHistory(1);
        }
    }

    function navigateHistory(direction: number): void {
        if (history.length === 0) return;

        if (state.historyIndex === -1) {
            state.savedInput = getInputText();
        }

        const newIndex = state.historyIndex + direction;
        if (newIndex < -1 || newIndex >= history.length) return;

        state.historyIndex = newIndex;
        const text = newIndex === -1 ? state.savedInput : history[history.length - 1 - newIndex];
        state.lines = text.split('\n');
        state.cursorRow = state.lines.length - 1;
        state.cursorCol = state.lines[state.cursorRow].length;
    }

    function clearInput(): void {
        state.lines = [''];
        state.cursorRow = 0;
        state.cursorCol = 0;
        state.historyIndex = -1;
    }

    function handleTab(): void {
        if (!completer) return;
        const currentLine = state.lines[state.cursorRow];
        const [matches, partial] = completer(currentLine);
        if (matches.length === 1) {
            // Single match — auto-complete
            state.lines[state.cursorRow] = matches[0] + ' ';
            state.cursorCol = state.lines[state.cursorRow].length;
        } else if (matches.length > 1) {
            // Multiple matches — show them below
            process.stdout.write('\n');
            process.stdout.write(matches.map(m => color.cyan(m)).join('  '));
            process.stdout.write('\n');
            state.renderedLineCount += 2;
        }
    }

    // ── Paste detection ──

    function handlePaste(data: string): void {
        // Insert pasted content, preserving newlines
        const chars = data.split('');
        for (const ch of chars) {
            if (ch === '\n' || ch === '\r') {
                insertNewLine();
            } else if (ch.charCodeAt(0) >= 32) {
                insertChar(ch);
            }
        }
    }

    // ── Main input loop ──

    return new Promise<string | null>((resolve) => {
        let resolved = false;
        let escapeTimeout: ReturnType<typeof setTimeout> | null = null;
        let escapeBuffer = '';

        render();

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');

        function done(value: string | null): void {
            if (resolved) return;
            resolved = true;
            process.stdin.removeListener('data', onData);
            try { process.stdin.setRawMode(false); } catch {}
            process.stdin.pause();
            // Move cursor to end and add newline
            const linesBelow = state.lines.length - 1 - state.cursorRow;
            if (linesBelow > 0) process.stdout.write(`\x1b[${linesBelow}B`);
            process.stdout.write('\n');
            resolve(value);
        }

        function onData(data: string): void {
            if (resolved) return;

            // Handle escape sequence disambiguation
            if (escapeBuffer) {
                if (escapeTimeout) clearTimeout(escapeTimeout);
                escapeBuffer += data;
                processEscapeSequence(escapeBuffer);
                escapeBuffer = '';
                render();
                return;
            }

            // Paste detection: multi-char data with newlines
            if (data.length > 3 && data.includes('\n')) {
                handlePaste(data);
                render();
                return;
            }

            // Single escape — start disambiguation
            if (data === '\x1b') {
                escapeBuffer = '\x1b';
                escapeTimeout = setTimeout(() => {
                    // Standalone Escape — clear input
                    escapeBuffer = '';
                    clearInput();
                    render();
                }, 50);
                return;
            }

            // Process each byte/sequence
            processKey(data);
            render();
        }

        function processEscapeSequence(seq: string): void {
            if (seq === '\x1b[A') { moveUp(); return; }
            if (seq === '\x1b[B') { moveDown(); return; }
            if (seq === '\x1b[C') { moveRight(); return; }
            if (seq === '\x1b[D') { moveLeft(); return; }
            if (seq === '\x1b[3~') { deleteChar(); return; }
            if (seq === '\x1b[H' || seq === '\x1b[1~') { state.cursorCol = 0; return; } // Home
            if (seq === '\x1b[F' || seq === '\x1b[4~') { state.cursorCol = state.lines[state.cursorRow].length; return; } // End
            // Unknown escape sequence — ignore
        }

        function processKey(key: string): void {
            // Enter — submit or continue with backslash
            if (key === '\r' || key === '\n') {
                const currentLine = state.lines[state.cursorRow];
                if (currentLine.endsWith('\\')) {
                    // Backslash continuation
                    state.lines[state.cursorRow] = currentLine.slice(0, -1);
                    state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorRow].length);
                    insertNewLine();
                } else {
                    // Submit
                    const text = getInputText().trim();
                    done(text || null);
                }
                return;
            }

            // Ctrl+J — insert new line
            if (key === '\x0A') {
                insertNewLine();
                return;
            }

            // Ctrl+C — cancel/exit
            if (key === '\x03') {
                if (isEmpty()) {
                    done(null);
                } else {
                    clearInput();
                }
                return;
            }

            // Backspace
            if (key === '\x7f' || key === '\b') {
                backspace();
                return;
            }

            // Tab
            if (key === '\x09') {
                handleTab();
                return;
            }

            // Ctrl+A — start of line
            if (key === '\x01') {
                state.cursorCol = 0;
                return;
            }

            // Ctrl+E — end of line
            if (key === '\x05') {
                state.cursorCol = state.lines[state.cursorRow].length;
                return;
            }

            // Ctrl+K — kill to end of line
            if (key === '\x0B') {
                state.lines[state.cursorRow] = state.lines[state.cursorRow].slice(0, state.cursorCol);
                return;
            }

            // Ctrl+U — kill to start of line
            if (key === '\x15') {
                state.lines[state.cursorRow] = state.lines[state.cursorRow].slice(state.cursorCol);
                state.cursorCol = 0;
                return;
            }

            // Ctrl+W — delete word backward
            if (key === '\x17') {
                const line = state.lines[state.cursorRow];
                const before = line.slice(0, state.cursorCol);
                const trimmed = before.replace(/\S+\s*$/, '');
                state.lines[state.cursorRow] = trimmed + line.slice(state.cursorCol);
                state.cursorCol = trimmed.length;
                return;
            }

            // Printable characters
            if (key.length === 1 && key.charCodeAt(0) >= 32) {
                insertChar(key);
                return;
            }

            // Multi-byte UTF-8 characters (emoji, etc.)
            if (key.length > 1 && key.charCodeAt(0) >= 32 && !key.startsWith('\x1b')) {
                insertChar(key);
                return;
            }
        }

        process.stdin.on('data', onData);
    });
}

/**
 * Simple single-line input (for /model, /resume prompts).
 * Uses the same raw-mode approach but submits on Enter, no multi-line.
 */
export async function collectLine(promptText: string): Promise<string> {
    const result = await collectInput({
        prompt: promptText,
        hint: '',
    });
    return result ?? '';
}
