/**
 * RobinPath CLI — Utility functions, flags, colors, logging
 */
import { join, basename } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';

// Injected by esbuild at build time via --define, fallback for dev mode
declare const __CLI_VERSION__: string;
export const CLI_VERSION: string = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '1.91.0';

// ============================================================================
// Global flags
// ============================================================================
export let FLAG_QUIET: boolean = false;
export let FLAG_VERBOSE: boolean = false;
export let FLAG_AUTO_ACCEPT: boolean = false;
export let FLAG_DEV_MODE: boolean = false;

/** Update mutable flags from main() after argument parsing. */
export function setFlags(flags: { quiet?: boolean; verbose?: boolean; autoAccept?: boolean; devMode?: boolean }): void {
    if (flags.quiet !== undefined) FLAG_QUIET = flags.quiet;
    if (flags.verbose !== undefined) FLAG_VERBOSE = flags.verbose;
    if (flags.autoAccept !== undefined) FLAG_AUTO_ACCEPT = flags.autoAccept;
    if (flags.devMode !== undefined) FLAG_DEV_MODE = flags.devMode;
}

export function log(...args: unknown[]): void {
    if (!FLAG_QUIET) console.log(...args);
}

export function logVerbose(...args: unknown[]): void {
    if (FLAG_VERBOSE) console.error('[verbose]', ...args);
}

// ============================================================================
// ANSI colors (only when stderr is a TTY)
// ============================================================================
const isTTY: boolean = !!(process.stdout.isTTY || process.stderr.isTTY);
export const color: Record<string, (s: string) => string> = {
    red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
    green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
    yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
    dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
    cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

// ============================================================================
// Utility functions
// ============================================================================

/** Get the install directory for robinpath */
export function getInstallDir(): string {
    return join(homedir(), '.robinpath', 'bin');
}

/** Get the robinpath home directory */
export function getRobinPathHome(): string {
    return join(homedir(), '.robinpath');
}

// Shell command execution — detect user's shell
export interface ShellConfig {
    shell: string;
    name: string;
    isUnix: boolean;
}

// Preferred shell order per platform
const SHELL_SEARCH: Record<string, { path: string; name: string; isUnix: boolean }[]> = {
    win32: [
        { path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', name: 'pwsh', isUnix: false },
        { path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', name: 'powershell', isUnix: false },
        { path: 'C:\\Program Files\\Git\\bin\\bash.exe', name: 'bash', isUnix: true },
        { path: 'cmd.exe', name: 'cmd', isUnix: false },
    ],
    darwin: [
        { path: '/bin/zsh', name: 'zsh', isUnix: true },
        { path: '/bin/bash', name: 'bash', isUnix: true },
        { path: '/usr/local/bin/fish', name: 'fish', isUnix: true },
    ],
    linux: [
        { path: '/bin/bash', name: 'bash', isUnix: true },
        { path: '/usr/bin/zsh', name: 'zsh', isUnix: true },
        { path: '/usr/bin/fish', name: 'fish', isUnix: true },
        { path: '/bin/sh', name: 'sh', isUnix: true },
    ],
};

// User override via config or env
let _shellOverride: string | null = null;
export function setShellOverride(name: string | null): void { _shellOverride = name; }

export function getShellConfig(): ShellConfig {
    const p = platform();

    // User override: ROBINPATH_SHELL env or /shell command
    if (_shellOverride) {
        const candidates = SHELL_SEARCH[p] || SHELL_SEARCH.linux;
        const match = candidates.find(c => c.name === _shellOverride);
        if (match && (match.name === 'cmd' || existsSync(match.path))) {
            return { shell: match.path, name: match.name, isUnix: match.isUnix };
        }
    }

    // Env override
    const envShell = process.env.ROBINPATH_SHELL;
    if (envShell) {
        const candidates = SHELL_SEARCH[p] || SHELL_SEARCH.linux;
        const match = candidates.find(c => c.name === envShell);
        if (match && (match.name === 'cmd' || existsSync(match.path))) {
            return { shell: match.path, name: match.name, isUnix: match.isUnix };
        }
    }

    // On non-Windows, respect $SHELL
    if (p !== 'win32') {
        const userShell = process.env.SHELL;
        if (userShell && existsSync(userShell)) {
            const name = basename(userShell);
            return { shell: userShell, name, isUnix: true };
        }
    }

    // Auto-detect: try each shell in platform priority order
    const candidates = SHELL_SEARCH[p] || SHELL_SEARCH.linux;
    for (const c of candidates) {
        if (c.name === 'cmd' || existsSync(c.path)) {
            return { shell: c.path, name: c.name, isUnix: c.isUnix };
        }
    }

    // Fallback
    return p === 'win32'
        ? { shell: 'cmd.exe', name: 'cmd', isUnix: false }
        : { shell: '/bin/sh', name: 'sh', isUnix: true };
}

/** List all available shells on this platform */
export function getAvailableShells(): { name: string; available: boolean; current: boolean }[] {
    const p = platform();
    const candidates = SHELL_SEARCH[p] || SHELL_SEARCH.linux;
    const current = getShellConfig().name;
    return candidates.map(c => ({
        name: c.name,
        available: c.name === 'cmd' || existsSync(c.path),
        current: c.name === current,
    }));
}

// Spinner animation for "thinking" state
export interface Spinner {
    stop(clearLine?: boolean): void;
}

export function createSpinner(text: string): Spinner {
    const frames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
    let i = 0;
    let stopped = false;
    const interval = setInterval(() => {
        process.stdout.write(`\r${color.cyan(frames[i % frames.length])} ${color.dim(text)}`);
        i++;
    }, 80);
    return {
        stop(clearLine: boolean = true) {
            if (stopped) return; // Only erase once — prevents cursor reset on every token
            stopped = true;
            clearInterval(interval);
            if (clearLine) process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
        },
    };
}
