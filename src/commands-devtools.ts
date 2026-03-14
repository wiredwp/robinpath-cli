/**
 * RobinPath CLI — Developer tools commands
 * Extracted from cli-entry.js and converted to TypeScript.
 */
import { createInterface } from 'node:readline';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, watch, appendFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

import {
    CLI_VERSION,
    FLAG_VERBOSE,
    log,
    logVerbose,
    color,
    getRobinPathHome,
} from './utils';

import {
    createRobinPath,
    resolveScriptPath,
    displayError,
} from './commands-core';

import { RobinPath, ROBINPATH_VERSION, Parser, Printer, LineIndexImpl, formatErrorWithContext } from './runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RobinPathThread {
    id: string;
    executeScript(script: string): Promise<void>;
    needsMoreInput(script: string): Promise<{ needsMore: boolean }>;
    getCurrentModule(): string | null;
    getAvailableCommands(): string[];
}

// ---------------------------------------------------------------------------
// AST / Printer types
// ---------------------------------------------------------------------------

interface ASTNode {
    type: string;
    isSet?: boolean;
    hasAs?: boolean;
    isImplicit?: boolean;
    hasThen?: boolean;
    modulePrefix?: string;
    codePos?: unknown;
    bodyPos?: unknown;
    openPos?: unknown;
    closePos?: unknown;
    headerPos?: unknown;
    keywordPos?: unknown;
    elseKeywordPos?: unknown;
    thenBranch?: ASTNode[];
    elseBranch?: ASTNode[];
    elseifBranches?: ElseIfBranch[];
    body?: ASTNode[];
    command?: ASTNode;
    [key: string]: unknown;
}

interface ElseIfBranch {
    hasThen?: boolean;
    body?: ASTNode[];
    [key: string]: unknown;
}

interface PrinterContext {
    indentLevel: number;
    lineIndex: LineIndexImpl;
}

// ============================================================================
// Commands
// ============================================================================

/**
 * robinpath check <file> — Syntax checker
 */
export async function handleCheck(args: string[]): Promise<void> {
    const jsonOutput: boolean = args.includes('--json');
    const fileArg: string | undefined = args.find(a => !a.startsWith('-'));
    if (!fileArg) {
        console.error(color.red('Error:') + ' check requires a file argument');
        console.error('Usage: robinpath check <file> [--json]');
        process.exit(2);
    }

    const filePath: string | null = resolveScriptPath(fileArg);
    if (!filePath) {
        if (jsonOutput) {
            console.log(JSON.stringify({ ok: false, file: fileArg, error: `File not found: ${fileArg}` }));
        } else {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        }
        process.exit(2);
    }

    const script: string = readFileSync(filePath, 'utf-8');
    const startTime: number = FLAG_VERBOSE ? performance.now() : 0;

    try {
        const parser = new Parser(script);
        await parser.parse();
        if (FLAG_VERBOSE) {
            const elapsed: string = (performance.now() - startTime).toFixed(1);
            logVerbose(`Parsed in ${elapsed}ms`);
        }
        if (jsonOutput) {
            console.log(JSON.stringify({ ok: true, file: fileArg }));
        } else {
            log(color.green('OK') + ` ${fileArg} — no syntax errors`);
        }
        process.exit(0);
    } catch (error: unknown) {
        const err = error as { message: string };
        if (jsonOutput) {
            // Extract line/column from error message if possible
            const lineMatch: RegExpMatchArray | null = err.message.match(/line (\d+)/i);
            const colMatch: RegExpMatchArray | null = err.message.match(/column (\d+)/i);
            console.log(JSON.stringify({
                ok: false,
                file: fileArg,
                error: err.message,
                line: lineMatch ? parseInt(lineMatch[1]) : null,
                column: colMatch ? parseInt(colMatch[1]) : null,
            }));
        } else {
            try {
                const formatted: string = formatErrorWithContext({ message: err.message, code: script });
                console.error(color.red('Syntax error') + ` in ${fileArg}:\n${formatted}`);
            } catch {
                console.error(color.red('Syntax error') + ` in ${fileArg}: ${err.message}`);
            }
        }
        process.exit(2);
    }
}

/**
 * robinpath ast <file> — AST dump
 */
export async function handleAST(args: string[]): Promise<void> {
    const compact: boolean = args.includes('--compact');
    const fileArg: string | undefined = args.find(a => !a.startsWith('-'));
    if (!fileArg) {
        console.error(color.red('Error:') + ' ast requires a file argument');
        console.error('Usage: robinpath ast <file> [--compact]');
        process.exit(2);
    }

    const filePath: string | null = resolveScriptPath(fileArg);
    if (!filePath) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(2);
    }

    const script: string = readFileSync(filePath, 'utf-8');
    const rp: RobinPath = await createRobinPath();
    const startTime: number = FLAG_VERBOSE ? performance.now() : 0;

    try {
        const ast: ASTNode[] = await rp.getAST(script);
        if (FLAG_VERBOSE) {
            const elapsed: string = (performance.now() - startTime).toFixed(1);
            logVerbose(`Parsed in ${elapsed}ms, ${ast.length} top-level nodes`);
        }
        console.log(compact ? JSON.stringify(ast) : JSON.stringify(ast, null, 2));
    } catch (error: unknown) {
        displayError(error as { message: string }, script);
        process.exit(2);
    }
}

/**
 * robinpath fmt <file|dir> — Code formatter
 */
export async function handleFmt(args: string[]): Promise<void> {
    const writeInPlace: boolean = args.includes('--write') || args.includes('-w');
    const checkOnly: boolean = args.includes('--check');
    const diffMode: boolean = args.includes('--diff');
    const fileArg: string | undefined = args.find(a => !a.startsWith('-'));

    if (!fileArg) {
        console.error(color.red('Error:') + ' fmt requires a file or directory argument');
        console.error('Usage: robinpath fmt <file|dir> [--write] [--check] [--diff]');
        process.exit(2);
    }

    // Collect files to format
    const files: string[] = collectRPFiles(fileArg);
    if (files.length === 0) {
        console.error(color.red('Error:') + ` No .rp or .robin files found: ${fileArg}`);
        process.exit(2);
    }

    let hasUnformatted: boolean = false;

    for (const filePath of files) {
        const script: string = readFileSync(filePath, 'utf-8');
        const startTime: number = FLAG_VERBOSE ? performance.now() : 0;

        try {
            const formatted: string = await formatScript(script);
            if (FLAG_VERBOSE) {
                const elapsed: string = (performance.now() - startTime).toFixed(1);
                logVerbose(`Formatted ${relative(process.cwd(), filePath)} in ${elapsed}ms`);
            }

            if (checkOnly) {
                if (formatted !== script) {
                    console.error(relative(process.cwd(), filePath) + ' — ' + color.red('not formatted'));
                    hasUnformatted = true;
                } else {
                    log(relative(process.cwd(), filePath) + ' — ' + color.green('OK'));
                }
            } else if (diffMode) {
                if (formatted !== script) {
                    const relPath: string = relative(process.cwd(), filePath);
                    console.log(simpleDiff(relPath, script, formatted));
                    hasUnformatted = true;
                }
            } else if (writeInPlace) {
                if (formatted !== script) {
                    writeFileSync(filePath, formatted, 'utf-8');
                    log(color.green('formatted') + ' ' + relative(process.cwd(), filePath));
                } else {
                    log(color.dim('unchanged') + ' ' + relative(process.cwd(), filePath));
                }
            } else {
                // Print to stdout
                process.stdout.write(formatted);
            }
        } catch (error: unknown) {
            const err = error as { message: string };
            console.error(color.red('Error') + ` formatting ${relative(process.cwd(), filePath)}: ${err.message}`);
            hasUnformatted = true;
        }
    }

    if ((checkOnly || diffMode) && hasUnformatted) {
        process.exit(1);
    }
}

/**
 * Simple unified diff output (no external dependency)
 */
export function simpleDiff(filePath: string, original: string, formatted: string): string {
    const origLines: string[] = original.split('\n');
    const fmtLines: string[] = formatted.split('\n');
    const lines: string[] = [`--- ${filePath}`, `+++ ${filePath} (formatted)`];

    let i: number = 0, j: number = 0;
    while (i < origLines.length || j < fmtLines.length) {
        if (i < origLines.length && j < fmtLines.length && origLines[i] === fmtLines[j]) {
            i++; j++;
            continue;
        }
        // Find the changed region
        const startI: number = i, startJ: number = j;
        // Simple: advance both until they match again or end
        let matchFound: boolean = false;
        for (let look: number = 1; look < 10 && !matchFound; look++) {
            // Check if original[i+look] matches formatted[j]
            if (i + look < origLines.length && j < fmtLines.length && origLines[i + look] === fmtLines[j]) {
                matchFound = true; break;
            }
            // Check if original[i] matches formatted[j+look]
            if (j + look < fmtLines.length && i < origLines.length && origLines[i] === fmtLines[j + look]) {
                matchFound = true; break;
            }
        }
        if (!matchFound) {
            // Emit one line from each
            if (i < origLines.length) lines.push(color.red(`- ${origLines[i]}`));
            if (j < fmtLines.length) lines.push(color.green(`+ ${fmtLines[j]}`));
            i++; j++;
        } else {
            // Emit removed lines until match
            while (i < origLines.length && (j >= fmtLines.length || origLines[i] !== fmtLines[j])) {
                lines.push(color.red(`- ${origLines[i]}`));
                i++;
            }
            // Emit added lines until match
            while (j < fmtLines.length && (i >= origLines.length || origLines[i] !== fmtLines[j])) {
                lines.push(color.green(`+ ${fmtLines[j]}`));
                j++;
            }
        }
    }

    return lines.join('\n');
}

/**
 * Format a RobinPath script to canonical style (normalized, no flavor preservation)
 */
export async function formatScript(script: string): Promise<string> {
    const parser = new Parser(script);
    const statements: ASTNode[] = await parser.parse();

    // Create a dummy LineIndex (no original script = forces normalization)
    const dummyLineIndex: LineIndexImpl = new LineIndexImpl('');

    const ctx: PrinterContext = {
        indentLevel: 0,
        lineIndex: dummyLineIndex,
        // No originalScript = forces normalized output
    };

    // Strip flavor/preservation flags so Printer uses canonical forms
    const normalized: ASTNode[] = statements.map(s => stripFlavorFlags(s));

    const parts: string[] = [];
    for (let i: number = 0; i < normalized.length; i++) {
        const code: string = Printer.printNode(normalized[i], ctx);
        if (i > 0 && code.trim()) {
            // For normalized output, add blank line between blocks and other statements
            const prevType: string = normalized[i - 1].type;
            const currType: string = normalized[i].type;
            const blockTypes: string[] = ['ifBlock', 'define', 'do', 'together', 'forLoop', 'onBlock', 'cell'];
            if (blockTypes.includes(prevType) || blockTypes.includes(currType)) {
                parts.push('\n');
            }
        }
        parts.push(code);
    }

    let result: string = parts.join('');
    // Ensure single trailing newline
    result = result.replace(/\n*$/, '\n');
    return result;
}

/**
 * Recursively strip flavor-preservation flags from AST nodes
 * so the Printer outputs canonical/normalized form.
 */
export function stripFlavorFlags(node: unknown): ASTNode {
    if (!node || typeof node !== 'object') return node as ASTNode;
    if (Array.isArray(node)) return node.map(n => stripFlavorFlags(n)) as unknown as ASTNode;

    const clone: ASTNode = { ...(node as ASTNode) };

    // Assignment: force canonical $x = value form
    if (clone.type === 'assignment') {
        delete clone.isSet;
        delete clone.hasAs;
        delete clone.isImplicit;
    }

    // If block: remove hasThen (for elseif branches)
    if (clone.type === 'ifBlock') {
        delete clone.hasThen;
        if (clone.thenBranch) clone.thenBranch = clone.thenBranch.map(s => stripFlavorFlags(s));
        if (clone.elseBranch) clone.elseBranch = clone.elseBranch.map(s => stripFlavorFlags(s));
        if (clone.elseifBranches) {
            clone.elseifBranches = clone.elseifBranches.map(b => ({
                ...b,
                hasThen: undefined,
                body: b.body ? b.body.map(s => stripFlavorFlags(s)) : b.body,
            }));
        }
    }

    // Command: remove module prefix tracking (force full qualified names)
    if (clone.type === 'command') {
        delete clone.modulePrefix;
    }

    // Strip codePos so Printer doesn't try to extract original code
    delete clone.codePos;
    delete clone.bodyPos;
    delete clone.openPos;
    delete clone.closePos;
    delete clone.headerPos;
    delete clone.keywordPos;
    delete clone.elseKeywordPos;

    // Recurse into body arrays
    if (clone.body && Array.isArray(clone.body)) {
        clone.body = clone.body.map(s => stripFlavorFlags(s));
    }
    if (clone.command && typeof clone.command === 'object') {
        clone.command = stripFlavorFlags(clone.command);
    }

    return clone;
}

/**
 * Collect .rp and .robin files from a path (file or directory)
 */
export function collectRPFiles(pathArg: string): string[] {
    const fullPath: string = resolve(pathArg);

    if (!existsSync(fullPath)) {
        // Try resolving with extensions
        const resolved: string | null = resolveScriptPath(pathArg);
        if (resolved) return [resolved];
        return [];
    }

    const stat = statSync(fullPath);
    if (stat.isFile()) {
        return [fullPath];
    }

    if (stat.isDirectory()) {
        return collectRPFilesRecursive(fullPath);
    }

    return [];
}

export function collectRPFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    const entries: string[] = readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const fullPath: string = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectRPFilesRecursive(fullPath));
        } else if (entry.endsWith('.rp') || entry.endsWith('.robin')) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * robinpath test [dir|file] — Test runner
 */
export async function handleTest(args: string[]): Promise<void> {
    const jsonOutput: boolean = args.includes('--json');
    const targetArg: string | undefined = args.find(a => !a.startsWith('-'));
    const searchPath: string = targetArg || '.';

    // Collect test files
    let testFiles: string[];
    const fullPath: string = resolve(searchPath);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        testFiles = [fullPath];
    } else {
        testFiles = collectTestFiles(searchPath);
    }

    if (testFiles.length === 0) {
        if (jsonOutput) {
            console.log(JSON.stringify({ passed: 0, failed: 0, total: 0, results: [] }));
        } else {
            log(color.yellow('No *.test.rp files found') + (targetArg ? ` in ${targetArg}` : ''));
        }
        process.exit(0);
    }

    let passed: number = 0;
    let failed: number = 0;
    const results: Array<{ file: string; status: string; error?: string }> = [];
    const startTime: number = performance.now();

    for (const filePath of testFiles) {
        const relPath: string = relative(process.cwd(), filePath);
        const script: string = readFileSync(filePath, 'utf-8');
        const rp: RobinPath = await createRobinPath();

        try {
            await rp.executeScript(script);
            passed++;
            results.push({ file: relPath, status: 'pass' });
            if (!jsonOutput) log(color.green('PASS') + '  ' + relPath);
        } catch (error: unknown) {
            const err = error as { message: string; __formattedMessage?: string };
            failed++;
            results.push({ file: relPath, status: 'fail', error: err.message });
            if (!jsonOutput) {
                log(color.red('FAIL') + '  ' + relPath);
                let detail: string = '  ' + err.message;
                if (err.__formattedMessage) {
                    detail = '  ' + err.__formattedMessage.split('\n').join('\n  ');
                }
                log(color.dim(detail));
            }
        }
    }

    const total: number = passed + failed;
    const elapsed: string = (performance.now() - startTime).toFixed(0);

    if (jsonOutput) {
        console.log(JSON.stringify({ passed, failed, total, duration_ms: parseInt(elapsed), results }));
    } else {
        log('');
        const summary: string = `${total} test${total !== 1 ? 's' : ''}: ${passed} passed, ${failed} failed`;
        if (failed > 0) {
            log(color.red(summary) + color.dim(` (${elapsed}ms)`));
        } else {
            log(color.green(summary) + color.dim(` (${elapsed}ms)`));
        }
    }

    process.exit(failed > 0 ? 1 : 0);
}

/**
 * Collect *.test.rp files recursively
 */
export function collectTestFiles(searchPath: string): string[] {
    const fullPath: string = resolve(searchPath);
    if (!existsSync(fullPath)) {
        return [];
    }

    const stat = statSync(fullPath);
    if (!stat.isDirectory()) {
        if (fullPath.endsWith('.test.rp')) return [fullPath];
        return [];
    }

    return collectTestFilesRecursive(fullPath);
}

export function collectTestFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    const entries: string[] = readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const fullPath: string = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectTestFilesRecursive(fullPath));
        } else if (entry.endsWith('.test.rp')) {
            results.push(fullPath);
        }
    }
    return results.sort();
}

/**
 * --watch flag: Re-run script on file changes
 */
export async function handleWatch(filePath: string, script: string): Promise<void> {
    log(color.dim(`Watching ${relative(process.cwd(), filePath)} for changes...`));
    log('');

    // Initial run
    await runWatchIteration(filePath);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    watch(filePath, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            // Clear screen
            process.stdout.write('\x1b[2J\x1b[H');
            await runWatchIteration(filePath);
        }, 200);
    });
}

export async function runWatchIteration(filePath: string): Promise<void> {
    const timestamp: string = new Date().toLocaleTimeString();
    log(color.dim(`[${timestamp}]`) + ` Running ${relative(process.cwd(), filePath)}`);
    log(color.dim('\u2500'.repeat(50)));

    const script: string = readFileSync(filePath, 'utf-8');
    const rp: RobinPath = await createRobinPath();
    try {
        await rp.executeScript(script);
    } catch (error: unknown) {
        displayError(error as { message: string }, script);
    }
    log('');
    log(color.dim('Waiting for changes...'));
}

// ============================================================================
// REPL
// ============================================================================

/**
 * Get REPL history file path
 */
export function getHistoryPath(): string {
    return join(getRobinPathHome(), 'history');
}

/**
 * Load REPL history from file
 */
export function loadHistory(): string[] {
    const historyPath: string = getHistoryPath();
    try {
        if (existsSync(historyPath)) {
            const content: string = readFileSync(historyPath, 'utf-8');
            return content.split('\n').filter(line => line.trim()).reverse();
        }
    } catch {
        // Ignore errors reading history
    }
    return [];
}

/**
 * Append a line to REPL history file
 */
export function appendHistory(line: string): void {
    const historyPath: string = getHistoryPath();
    try {
        const dir: string = getRobinPathHome();
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        appendFileSync(historyPath, line + '\n', 'utf-8');

        // Trim history file if it exceeds 1000 lines
        try {
            const content: string = readFileSync(historyPath, 'utf-8');
            const lines: string[] = content.split('\n').filter(l => l.trim());
            if (lines.length > 1000) {
                const trimmed: string[] = lines.slice(lines.length - 1000);
                writeFileSync(historyPath, trimmed.join('\n') + '\n', 'utf-8');
            }
        } catch {
            // Ignore trim errors
        }
    } catch {
        // Ignore errors writing history
    }
}

export async function startREPL(): Promise<void> {
    const rp: RobinPath = await createRobinPath({ threadControl: true });
    rp.createThread('default');

    const sessionLines: string[] = []; // Track session lines for .save

    function getPrompt(): string {
        const thread: RobinPathThread | null = rp.getCurrentThread();
        if (!thread) return '> ';
        const currentModule: string | null = thread.getCurrentModule();
        if (currentModule) {
            return `${thread.id}@${currentModule}> `;
        }
        return `${thread.id}> `;
    }

    function endsWithBackslash(line: string): boolean {
        return line.trimEnd().endsWith('\\');
    }

    let accumulatedLines: string[] = [];

    // Load history
    const history: string[] = loadHistory();

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getPrompt(),
        history: history,
        historySize: 1000,
    });

    log(`RobinPath v${CLI_VERSION}`);
    log('Type "help" for commands, "exit" to quit');
    log('');

    rl.prompt();

    rl.on('line', async (line: string) => {
        const trimmed: string = line.trim();

        if (!trimmed && accumulatedLines.length === 0) {
            rl.prompt();
            return;
        }

        if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit') {
            log('Goodbye!');
            process.exit(0);
        }

        if (accumulatedLines.length === 0 && (trimmed === 'help' || trimmed === '.help')) {
            log('');
            log('RobinPath REPL Commands:');
            log('  exit, quit     Exit the REPL');
            log('  help           Show this help');
            log('  clear          Clear the screen');
            log('  ..             Show all available commands');
            log('  .load <file>   Load and execute a script file');
            log('  .save <file>   Save session to file');
            log('');
            log('Write RobinPath code and press Enter to execute.');
            log('Multi-line blocks (if/def/for/do) are supported.');
            log('Use \\ at end of line for line continuation.');
            log('');
            rl.prompt();
            return;
        }

        if (accumulatedLines.length === 0 && (trimmed === 'clear' || trimmed === '.clear')) {
            console.clear();
            rl.prompt();
            return;
        }

        // ".." command — show available commands
        if (accumulatedLines.length === 0 && trimmed === '..') {
            const thread: RobinPathThread | null = rp.getCurrentThread();
            const commands: string[] = thread ? thread.getAvailableCommands() : rp.getAvailableCommands();
            log(JSON.stringify(commands, null, 2));
            rl.prompt();
            return;
        }

        // .load <file> — load and execute a script file
        if (accumulatedLines.length === 0 && trimmed.startsWith('.load ')) {
            const fileArg: string = trimmed.slice(6).trim();
            if (!fileArg) {
                console.error(color.red('Error:') + ' .load requires a file argument');
                rl.prompt();
                return;
            }
            const loadPath: string | null = resolveScriptPath(fileArg);
            if (!loadPath) {
                console.error(color.red('Error:') + ` File not found: ${fileArg}`);
                rl.prompt();
                return;
            }
            try {
                const script: string = readFileSync(loadPath, 'utf-8');
                log(color.dim(`Loading ${fileArg}...`));
                const thread: RobinPathThread | null = rp.getCurrentThread();
                if (thread) {
                    await thread.executeScript(script);
                } else {
                    await rp.executeScript(script);
                }
                log(color.green('Loaded') + ` ${fileArg}`);
            } catch (error: unknown) {
                displayError(error as { message: string }, null as unknown as string);
            }
            rl.setPrompt(getPrompt());
            rl.prompt();
            return;
        }

        // .save <file> — save session lines to a file
        if (accumulatedLines.length === 0 && trimmed.startsWith('.save ')) {
            const fileArg: string = trimmed.slice(6).trim();
            if (!fileArg) {
                console.error(color.red('Error:') + ' .save requires a file argument');
                rl.prompt();
                return;
            }
            try {
                const content: string = sessionLines.join('\n') + '\n';
                writeFileSync(resolve(fileArg), content, 'utf-8');
                log(color.green('Saved') + ` ${sessionLines.length} lines to ${fileArg}`);
            } catch (error: unknown) {
                const err = error as { message: string };
                console.error(color.red('Error:') + ` Could not save: ${err.message}`);
            }
            rl.prompt();
            return;
        }

        // Backslash continuation
        if (endsWithBackslash(line)) {
            accumulatedLines.push(line);
            rl.setPrompt('... ');
            rl.prompt();
            return;
        }

        // If we have accumulated lines, add this one
        if (accumulatedLines.length > 0) {
            accumulatedLines.push(line);
        }

        // Determine the full script to check/execute
        const scriptToCheck: string = accumulatedLines.length > 0
            ? accumulatedLines.join('\n')
            : line;

        try {
            const thread: RobinPathThread | null = rp.getCurrentThread();
            let needsMore: { needsMore: boolean };
            if (thread) {
                needsMore = await thread.needsMoreInput(scriptToCheck);
            } else {
                needsMore = await rp.needsMoreInput(scriptToCheck);
            }

            if (needsMore.needsMore) {
                if (accumulatedLines.length === 0) {
                    accumulatedLines.push(line);
                }
                rl.setPrompt('... ');
                rl.prompt();
                return;
            }

            // Block is complete — execute
            const finalScript: string = accumulatedLines.length > 0
                ? accumulatedLines.join('\n')
                : line;
            accumulatedLines = [];

            // Save to history and session
            appendHistory(finalScript);
            sessionLines.push(finalScript);

            if (thread) {
                await thread.executeScript(finalScript);
            } else {
                await rp.executeScript(finalScript);
            }

            rl.setPrompt(getPrompt());
        } catch (error: unknown) {
            displayError(error as { message: string }, null as unknown as string);
            accumulatedLines = [];
            rl.setPrompt(getPrompt());
        }

        rl.prompt();
    });

    rl.on('close', () => {
        log('\nGoodbye!');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        if (accumulatedLines.length > 0) {
            log('\nBlock cancelled.');
            accumulatedLines = [];
            rl.setPrompt(getPrompt());
            rl.prompt();
        } else {
            log('\nGoodbye!');
            process.exit(0);
        }
    });
}
