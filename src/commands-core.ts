/**
 * RobinPath CLI — Core commands and utilities
 * Extracted from cli-entry.js and converted to TypeScript.
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

import {
    CLI_VERSION,
    FLAG_QUIET,
    FLAG_VERBOSE,
    log,
    logVerbose,
    color,
    getInstallDir,
    getRobinPathHome,
} from './utils';
import { RobinPath, ROBINPATH_VERSION, nativeModules, formatErrorWithContext } from './runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NativeModule {
    name: string;
    functions: Record<string, Function>;
    functionMetadata?: Record<string, unknown>;
    moduleMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODULES_DIR: string = join(homedir(), '.robinpath', 'modules');
export const MODULES_MANIFEST: string = join(MODULES_DIR, 'modules.json');
export const CACHE_DIR: string = join(homedir(), '.robinpath', 'cache');

const CLOUD_URL: string = process.env.ROBINPATH_CLOUD_URL || 'https://dev.robinpath.com';
const PLATFORM_URL: string = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';

// ---------------------------------------------------------------------------
// toTarPath
// ---------------------------------------------------------------------------

/** Convert Windows path to POSIX for tar commands */
export function toTarPath(p: string): string {
    if (process.platform !== 'win32') return p;
    // C:\Users\foo → /c/Users/foo
    return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => '/' + d.toLowerCase());
}

// ---------------------------------------------------------------------------
// Update utilities
// ---------------------------------------------------------------------------

/** Check for newer versions on GitHub */
export async function checkForUpdates(): Promise<void> {
    try {
        const res = await fetch('https://api.github.com/repos/wiredwp/robinpath-cli/releases/latest');
        const data = await res.json() as { tag_name: string };
        const latest: string = data.tag_name.replace('v', '');
        if (latest !== CLI_VERSION) {
            console.log(`\n${color.yellow('⚡')} New version available: ${color.green('v' + latest)} (you have v${CLI_VERSION})`);
            console.log(`   Run ${color.cyan('robinpath update')} to upgrade\n`);
        }
    } catch {
        // silently ignore update check failures
    }
}

/** Update: re-run the install script for the current platform */
export function handleUpdate(): void {
    const isWindows: boolean = platform() === 'win32';
    const env = { ...process.env, ROBINPATH_CURRENT_VERSION: CLI_VERSION };
    try {
        if (isWindows) {
            execSync('powershell -NoProfile -Command "irm https://dev.robinpath.com/install.ps1 | iex"', { stdio: 'inherit', env });
        } else {
            execSync('curl -fsSL https://dev.robinpath.com/install.sh | sh', { stdio: 'inherit', env });
        }
    } catch (err: unknown) {
        console.error(color.red('Update failed:') + ` ${(err as Error).message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Install / Uninstall
// ---------------------------------------------------------------------------

/** Install: copy this exe to ~/.robinpath/bin and add to PATH */
export function handleInstall(): void {
    const installDir: string = getInstallDir();
    const isWindows: boolean = platform() === 'win32';
    const exeName: string = isWindows ? 'robinpath.exe' : 'robinpath';
    const rpName: string = isWindows ? 'rp.exe' : 'rp';
    const dest: string = join(installDir, exeName);
    const rpDest: string = join(installDir, rpName);
    const src: string = process.execPath;

    // Already installed in the right place?
    if (resolve(src) === resolve(dest)) {
        log(`robinpath v${CLI_VERSION} is already installed.`);
        return;
    }

    // Create directory
    mkdirSync(installDir, { recursive: true });

    // Copy binary
    copyFileSync(src, dest);

    // Copy alias binary (rp)
    copyFileSync(src, rpDest);

    // Make executable on Unix
    if (!isWindows) {
        try {
            chmodSync(dest, 0o755);
            chmodSync(rpDest, 0o755);
        } catch {
            // ignore chmod failures
        }
    }

    // Add to PATH
    if (isWindows) {
        try {
            const checkPath: string = execSync(
                `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`,
                { encoding: 'utf-8' }
            ).trim();

            if (!checkPath.includes(installDir)) {
                execSync(
                    `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${installDir};' + [Environment]::GetEnvironmentVariable('Path','User'),'User')"`,
                    { encoding: 'utf-8' }
                );
            }
        } catch {
            log(`Could not update PATH automatically.`);
            log(`Add this to your PATH manually: ${installDir}`);
        }
    } else {
        // Unix: suggest adding to shell profile
        const shellProfile: string = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
        const exportLine: string = `export PATH="${installDir}:$PATH"`;
        log(`Add to ${shellProfile}:`);
        log(`  ${exportLine}`);
    }

    log('');
    log(`Installed robinpath v${CLI_VERSION}`);
    log(`Location: ${dest}`);
    log(`Alias:    ${rpDest} (use "rp" as shorthand)`);
    log('');
    log('Restart your terminal, then run:');
    log('  robinpath --version');
}

/** Uninstall: remove ~/.robinpath and clean PATH */
export function handleUninstall(): void {
    const installDir: string = getInstallDir();
    const robinpathHome: string = getRobinPathHome();
    const isWindows: boolean = platform() === 'win32';

    // Remove the directory
    if (existsSync(robinpathHome)) {
        rmSync(robinpathHome, { recursive: true, force: true });
        log(`Removed ${robinpathHome}`);
    } else {
        log('Nothing to remove.');
    }

    // Clean PATH
    if (isWindows) {
        try {
            execSync(
                `powershell -NoProfile -Command "$p = [Environment]::GetEnvironmentVariable('Path','User'); $clean = ($p -split ';' | Where-Object { $_ -notlike '*\\.robinpath\\bin*' }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$clean,'User')"`,
                { encoding: 'utf-8' }
            );
            log('Removed from PATH');
        } catch {
            log(`Could not update PATH automatically.`);
            log(`Remove "${installDir}" from your PATH manually.`);
        }
    } else {
        log(`Remove the robinpath PATH line from your shell profile.`);
    }

    log('');
    log('RobinPath uninstalled. Restart your terminal.');
}

// ---------------------------------------------------------------------------
// Script execution
// ---------------------------------------------------------------------------

/** Resolve a script file path, auto-adding .rp or .robin extension if needed */
export function resolveScriptPath(fileArg: string): string | null {
    const filePath: string = resolve(fileArg);
    if (existsSync(filePath)) return filePath;

    if (!extname(filePath)) {
        const rpPath: string = filePath + '.rp';
        if (existsSync(rpPath)) return rpPath;

        const robinPath: string = filePath + '.robin';
        if (existsSync(robinPath)) return robinPath;
    }

    return null;
}

/** Display a rich error with context */
export function displayError(error: { message: string; __formattedMessage?: string }, script?: string): void {
    // Check for pre-formatted error message
    if (error.__formattedMessage) {
        console.error(color.red('Error:') + ' ' + error.__formattedMessage);
        return;
    }

    // Try to use formatErrorWithContext for rich error display
    if (script) {
        try {
            const formatted: string = formatErrorWithContext({ message: error.message, code: script });
            if (formatted && formatted !== error.message) {
                console.error(color.red('Error:') + ' ' + formatted);
                return;
            }
        } catch {
            // Fall through to simple error
        }
    }

    console.error(color.red('Error:') + ' ' + error.message);
}

/** Execute a script and exit with proper code */
export async function runScript(script: string, filePath?: string): Promise<void> {
    const rp: RobinPath = await createRobinPath();
    const startTime: number = FLAG_VERBOSE ? performance.now() : 0;

    try {
        await rp.executeScript(script);
        if (FLAG_VERBOSE) {
            const elapsed: string = (performance.now() - startTime).toFixed(1);
            const mem: string = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            logVerbose(`Executed in ${elapsed}ms, heap: ${mem}MB`);
        }
    } catch (error: unknown) {
        displayError(error as { message: string; __formattedMessage?: string }, script);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Cloud / Auth utilities
// ---------------------------------------------------------------------------

export function getAuthPath(): string {
    return join(homedir(), '.robinpath', 'auth.json');
}

interface AuthData {
    token: string;
    expiresAt?: number;
    [key: string]: unknown;
}

export function readAuth(): AuthData | null {
    try {
        const authPath: string = getAuthPath();
        if (!existsSync(authPath)) return null;
        const data: AuthData = JSON.parse(readFileSync(authPath, 'utf-8'));
        if (!data.token) return null;
        return data;
    } catch {
        return null;
    }
}

export function writeAuth(data: AuthData): void {
    const authPath: string = getAuthPath();
    const dir: string = dirname(authPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf-8');
    // Restrict permissions on Unix
    if (platform() !== 'win32') {
        try { chmodSync(authPath, 0o600); } catch { /* ignore */ }
    }
}

export function removeAuth(): void {
    const authPath: string = getAuthPath();
    if (existsSync(authPath)) {
        unlinkSync(authPath);
    }
}

export function getAuthToken(): string | null {
    const auth: AuthData | null = readAuth();
    if (!auth) return null;
    // Check expiry
    if (auth.expiresAt && Date.now() >= auth.expiresAt * 1000) {
        return null;
    }
    return auth.token;
}

export function requireAuth(): string {
    const token: string | null = getAuthToken();
    if (!token) {
        console.error(color.red('Error:') + ' Not logged in. Run ' + color.cyan('robinpath login') + ' to sign in.');
        process.exit(1);
    }
    return token;
}

export async function platformFetch(path: string, opts: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const token: string = requireAuth();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...opts.headers };
    const url: string = `${PLATFORM_URL}${path}`;
    const res: Response = await fetch(url, { ...opts, headers });
    return res;
}

// ---------------------------------------------------------------------------
// Module management utilities
// ---------------------------------------------------------------------------

interface ModulesManifest {
    [packageName: string]: { version: string; [key: string]: unknown };
}

export function readModulesManifest(): ModulesManifest {
    try {
        if (!existsSync(MODULES_MANIFEST)) return {};
        return JSON.parse(readFileSync(MODULES_MANIFEST, 'utf-8')) as ModulesManifest;
    } catch {
        return {};
    }
}

export function writeModulesManifest(manifest: ModulesManifest): void {
    if (!existsSync(MODULES_DIR)) {
        mkdirSync(MODULES_DIR, { recursive: true });
    }
    writeFileSync(MODULES_MANIFEST, JSON.stringify(manifest, null, 2), 'utf-8');
}

export function getModulePath(packageName: string): string {
    // @robinpath/slack → ~/.robinpath/modules/@robinpath/slack
    return join(MODULES_DIR, ...packageName.split('/'));
}

export interface PackageSpec {
    scope: string | null;
    name: string;
    fullName: string;
    version: string | null;
}

export function parsePackageSpec(spec: string): PackageSpec | null {
    if (!spec) return null;
    // Handle @scope/name@version or @scope/name or name@version or name
    let fullName: string;
    let version: string | null = null;

    if (spec.startsWith('@')) {
        // Scoped: @scope/name@version
        const lastAt: number = spec.lastIndexOf('@');
        if (lastAt > 0 && spec.indexOf('/') < lastAt) {
            fullName = spec.slice(0, lastAt);
            version = spec.slice(lastAt + 1);
        } else {
            fullName = spec;
        }
    } else {
        // Unscoped: name@version
        const atIdx: number = spec.indexOf('@');
        if (atIdx > 0) {
            fullName = spec.slice(0, atIdx);
            version = spec.slice(atIdx + 1);
        } else {
            fullName = spec;
        }
    }

    // Parse scope and name
    let scope: string | null;
    let name: string;
    if (fullName.startsWith('@') && fullName.includes('/')) {
        const parts: string[] = fullName.slice(1).split('/');
        scope = parts[0];
        name = parts.slice(1).join('/');
    } else {
        scope = null;
        name = fullName;
    }

    return { scope, name, fullName, version };
}

/** Load all installed modules from ~/.robinpath/modules/ into a RobinPath instance */
export async function loadInstalledModules(rp: RobinPath): Promise<void> {
    const manifest: ModulesManifest = readModulesManifest();
    const entries: [string, { version: string; [key: string]: unknown }][] = Object.entries(manifest);
    if (entries.length === 0) return;

    for (const [packageName, info] of entries) {
        try {
            const modDir: string = getModulePath(packageName);
            // Read package.json to find entry point
            let entryPoint: string = 'dist/index.js';
            const pkgJsonPath: string = join(modDir, 'package.json');
            if (existsSync(pkgJsonPath)) {
                try {
                    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { main?: string };
                    if (pkg.main) entryPoint = pkg.main;
                } catch { /* use default */ }
            }

            const modulePath: string = join(modDir, entryPoint);
            if (!existsSync(modulePath)) {
                if (FLAG_VERBOSE) logVerbose(`Module ${packageName}: entry not found at ${entryPoint}, skipping`);
                continue;
            }

            const mod = await import(pathToFileURL(modulePath).href) as { default?: NativeModule & { global?: boolean } };
            const adapter = mod.default;

            if (!adapter || !adapter.name || !adapter.functions) {
                if (FLAG_VERBOSE) logVerbose(`Module ${packageName}: invalid ModuleAdapter, skipping`);
                continue;
            }

            // Register module using public API
            rp.registerModule(adapter.name, adapter.functions);
            if (adapter.functionMetadata) {
                rp.registerModuleMeta(adapter.name, adapter.functionMetadata);
            }
            if (adapter.moduleMetadata) {
                rp.registerModuleInfo(adapter.name, adapter.moduleMetadata);
            }

            // If global, also register functions without module prefix
            if (adapter.global === true) {
                for (const [funcName, handler] of Object.entries(adapter.functions)) {
                    rp.registerBuiltin(funcName, handler);
                }
            }

            if (FLAG_VERBOSE) logVerbose(`Loaded module: ${packageName}@${info.version}`);
        } catch (err: unknown) {
            // Never fatal — warn and continue
            console.error(color.yellow('Warning:') + ` Failed to load module ${packageName}: ${(err as Error).message}`);
        }
    }
}

/** Create a RobinPath instance with all installed modules loaded */
export async function createRobinPath(opts?: Record<string, unknown>): Promise<RobinPath> {
    const rp: RobinPath = new RobinPath(opts);

    // Register native modules (bundled in binary, always available)
    for (const mod of nativeModules) {
        rp.registerModule(mod.name, mod.functions);
        if (mod.functionMetadata) {
            rp.registerModuleMeta(mod.name, mod.functionMetadata);
        }
        if (mod.moduleMetadata) {
            rp.registerModuleInfo(mod.name, mod.moduleMetadata);
        }
    }

    // Load user-installed external modules (can override natives)
    await loadInstalledModules(rp);
    return rp;
}

export function openBrowser(url: string): void {
    const plat: string = platform();
    try {
        if (plat === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (plat === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        log(color.yellow('Could not open browser automatically.'));
        log(`Open this URL manually: ${url}`);
    }
}

/** Decode a JWT payload (no verification — just base64url decode the claims). */
export function decodeJWTPayload(token: string): Record<string, unknown> | null {
    try {
        const parts: string[] = token.split('.');
        if (parts.length !== 3) return null;
        const payload: string = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded: string = payload + '='.repeat((4 - payload.length % 4) % 4);
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}
