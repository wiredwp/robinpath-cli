/**
 * File reference resolver — expands @filename references in prompts.
 *
 * Syntax:
 *   @filename.txt      — include file contents inline
 *   @path/to/file      — relative to cwd
 *   @*.rp              — include all matching files (glob)
 *
 * Example:
 *   "explain @hello.rp and fix the bug"
 *   → "explain\n--- hello.rp ---\nlog \"hello world\"\n---\nand fix the bug"
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { color, log } from './utils';

export interface FileRef {
    pattern: string;
    files: { path: string; content: string; size: number }[];
}

const MAX_FILE_SIZE = 50_000; // 50KB max per file
const MAX_TOTAL_SIZE = 200_000; // 200KB total max

/**
 * Find all @path references in a prompt string.
 */
export function findFileRefs(prompt: string): string[] {
    const refs: string[] = [];
    const regex = /@([\w.\-\/\\*]+)/g;
    let match;
    while ((match = regex.exec(prompt)) !== null) {
        refs.push(match[1]);
    }
    return refs;
}

/**
 * Resolve a single file reference pattern to actual files.
 * Supports exact paths and simple * glob.
 */
function resolvePattern(pattern: string, cwd: string): { path: string; content: string; size: number }[] {
    const results: { path: string; content: string; size: number }[] = [];

    if (pattern.includes('*')) {
        // Simple glob: @*.rp or @src/*.ts
        const dir = pattern.includes('/') ? join(cwd, pattern.split('*')[0].replace(/\/[^/]*$/, '')) : cwd;
        const ext = pattern.split('*').pop() || '';
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (ext && !entry.endsWith(ext)) continue;
                const fullPath = join(dir, entry);
                try {
                    const stat = statSync(fullPath);
                    if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
                        results.push({
                            path: relative(cwd, fullPath),
                            content: readFileSync(fullPath, 'utf-8'),
                            size: stat.size,
                        });
                    }
                } catch {}
            }
        } catch {}
    } else {
        // Exact file
        const fullPath = resolve(cwd, pattern);
        if (existsSync(fullPath)) {
            try {
                const stat = statSync(fullPath);
                if (stat.isFile()) {
                    if (stat.size > MAX_FILE_SIZE) {
                        log(color.yellow(`  Warning: ${pattern} is too large (${(stat.size / 1024).toFixed(0)}KB), skipped`));
                    } else {
                        results.push({
                            path: relative(cwd, fullPath),
                            content: readFileSync(fullPath, 'utf-8'),
                            size: stat.size,
                        });
                    }
                }
            } catch {}
        } else {
            log(color.yellow(`  Warning: ${pattern} not found`));
        }
    }

    return results;
}

/**
 * Expand all @path references in a prompt.
 * Returns the expanded prompt with file contents inlined.
 */
export function expandFileRefs(prompt: string, cwd?: string): { expanded: string; refs: FileRef[] } {
    const workDir = cwd || process.cwd();
    const patterns = findFileRefs(prompt);

    if (patterns.length === 0) {
        return { expanded: prompt, refs: [] };
    }

    const refs: FileRef[] = [];
    let totalSize = 0;
    const fileBlocks: string[] = [];

    for (const pattern of patterns) {
        const files = resolvePattern(pattern, workDir);
        refs.push({ pattern, files });

        for (const f of files) {
            if (totalSize + f.size > MAX_TOTAL_SIZE) {
                log(color.yellow(`  Warning: total file size limit reached, skipping remaining files`));
                break;
            }
            totalSize += f.size;
            fileBlocks.push(`--- ${f.path} ---\n${f.content}\n---`);
        }
    }

    // Remove @references from the prompt text
    let cleaned = prompt;
    for (const pattern of patterns) {
        cleaned = cleaned.replace(`@${pattern}`, '').trim();
    }

    // Build expanded prompt: file contents first, then the user's message
    const expanded = fileBlocks.length > 0
        ? `${fileBlocks.join('\n\n')}\n\n${cleaned}`
        : cleaned;

    return { expanded, refs };
}

/**
 * List files that can be referenced with @ in the current directory.
 * Used for tab completion.
 */
export function listReferenceableFiles(cwd?: string, prefix?: string): string[] {
    const workDir = cwd || process.cwd();
    const results: string[] = [];
    try {
        const entries = readdirSync(workDir);
        for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            try {
                const stat = statSync(join(workDir, entry));
                if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
                    const ref = `@${entry}`;
                    if (!prefix || ref.startsWith(prefix)) {
                        results.push(ref);
                    }
                }
            } catch {}
        }
    } catch {}
    return results;
}
