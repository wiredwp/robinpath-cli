/**
 * RobinPath CLI — Shell command execution, file diff, command extraction
 */
import { spawn as spawnChild } from 'node:child_process';
import { getShellConfig, color, log } from './utils';

// ============================================================================
// Interfaces
// ============================================================================

export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

// ============================================================================
// Shell command execution
// ============================================================================

/** Execute a shell command with live streaming output. Returns {stdout, stderr, exitCode}. */
export function executeShellCommand(command: string, timeout: number = 30000): Promise<ShellResult> {
    const { shell } = getShellConfig();
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;

        const child = spawnChild(command, {
            shell,
            cwd: process.cwd(),
            timeout,
            env: { ...process.env, LANG: 'en_US.UTF-8' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString();
            stdout += chunk;
            // Stream output live (dim, indented)
            const lines = chunk.replace(/\n$/, '').split('\n');
            for (const line of lines) {
                if (line.trim()) process.stdout.write(color.dim(`    ${line}\n`));
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('close', (code: number | null) => {
            if (settled) return;
            settled = true;
            resolve({
                stdout: stdout.slice(0, 50000),
                stderr: stderr.slice(0, 10000),
                exitCode: code || 0,
            });
        });

        child.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            resolve({
                stdout: stdout.slice(0, 50000),
                stderr: stderr.slice(0, 10000),
                exitCode: 1,
                error: err.message.slice(0, 500),
            });
        });

        // Timeout fallback
        setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGTERM'); } catch {}
            resolve({
                stdout: stdout.slice(0, 50000),
                stderr: 'Command timed out',
                exitCode: 124,
            });
        }, timeout);
    });
}

// ============================================================================
// File write detection & diff
// ============================================================================

/** Detect if a command writes to a file (redirect or heredoc). Returns the target file path or null. */
export function detectFileWrite(cmd: string): string | null {
    // Match: ... > file.txt (but not >>)
    const redirect = cmd.match(/(?<![>])>\s*([^\s|&;>]+)\s*$/);
    if (redirect) return redirect[1];
    // Match: cat << 'EOF' > file.txt (heredoc with redirect in the middle)
    const heredoc = cmd.match(/>\s*([^\s|&;>]+)\s*$/m);
    if (heredoc && cmd.includes('<<')) return heredoc[1];
    return null;
}

/** Show a simple diff between old and new content. */
export function showFileDiff(filePath: string, oldContent: string, newContent: string): void {
    if (!oldContent && newContent) {
        log(color.green(`  + New file: ${filePath} (${newContent.split('\n').length} lines)`));
        return;
    }
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    let changes = 0;
    const maxShow = 10;
    log(color.dim(`  Diff: ${filePath}`));
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
        if (oldLines[i] !== newLines[i]) {
            changes++;
            if (changes <= maxShow) {
                if (i < oldLines.length && oldLines[i] !== undefined) {
                    log(color.red(`  - ${oldLines[i]}`));
                }
                if (i < newLines.length && newLines[i] !== undefined) {
                    log(color.green(`  + ${newLines[i]}`));
                }
            }
        }
    }
    if (changes > maxShow) {
        log(color.dim(`  ... and ${changes - maxShow} more changes`));
    }
    if (changes === 0) {
        log(color.dim(`  (no changes)`));
    }
}

// ============================================================================
// Command extraction from AI responses
// ============================================================================

// Extract <cmd>...</cmd> blocks from AI response text
export function extractCommands(text: string): string[] {
    const commands: string[] = [];
    const regex = /<cmd>([\s\S]*?)<\/cmd>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const cmd = match[1].trim();
        if (cmd) commands.push(cmd);
    }
    return commands;
}

// Strip <cmd> tags from displayed text (they're invisible to user)
export function stripCommandTags(text: string): string {
    return text.replace(/<cmd>[\s\S]*?<\/cmd>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
