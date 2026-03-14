/**
 * RobinPath CLI — Project & Environment commands
 * Extracted from cli-entry.js and converted to TypeScript.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync, chmodSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { platform } from 'node:os';

import { color, log, logVerbose, CLI_VERSION, getRobinPathHome, getInstallDir, FLAG_VERBOSE } from './utils';

import {
    readModulesManifest,
    writeModulesManifest,
    getModulePath,
    parsePackageSpec,
    createRobinPath,
    requireAuth,
    platformFetch,
    MODULES_DIR,
    CACHE_DIR,
    MODULES_MANIFEST,
    loadInstalledModules,
    resolveScriptPath,
    readAuth,
    getAuthToken,
    handleInstall,
} from './commands-core';

import { ROBINPATH_VERSION, nativeModules } from './runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NativeModule {
    name: string;
    functions: Record<string, (...args: any[]) => any>;
    functionMetadata?: Record<string, unknown>;
    moduleMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_URL: string = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';

import { handleAdd } from './commands-modules';

// ============================================================================
// Project & Environment commands
// ============================================================================

/**
 * robinpath init — Create a robinpath.json project config
 */
export async function handleInit(args: string[]): Promise<void> {
    const projectFile: string = resolve('robinpath.json');
    if (existsSync(projectFile) && !args.includes('--force')) {
        console.error(color.red('Error:') + ' robinpath.json already exists. Use --force to overwrite.');
        process.exit(1);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def: string): Promise<string> =>
        new Promise((resolve) => {
            const prompt: string = def ? `${q} (${def}): ` : `${q}: `;
            rl.question(prompt, (answer) => resolve(answer.trim() || def || ''));
        });

    log('');
    log(color.bold('  Create a new RobinPath project'));
    log(color.dim('  ' + '\u2500'.repeat(35)));
    log('');

    const dirName: string = basename(process.cwd());
    const projectName: string = await ask('  Project name', dirName);
    const description: string = await ask('  Description', '');
    const auth = readAuth();
    const author: string = await ask('  Author', (auth?.email as string) || '');
    const mainFile: string = await ask('  Entry file', 'main.rp');

    rl.close();

    const config = {
        name: projectName,
        version: '1.0.0',
        description,
        author,
        main: mainFile,
        modules: {} as Record<string, string>,
        env: {} as Record<string, string>,
    };

    writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    // Create main.rp if it doesn't exist
    const mainPath: string = resolve(mainFile);
    if (!existsSync(mainPath)) {
        writeFileSync(
            mainPath,
            `# ${projectName}
# Run: robinpath ${mainFile}

log "Hello from RobinPath!"
`,
            'utf-8',
        );
    }

    // Create .env if it doesn't exist
    if (!existsSync(resolve('.env'))) {
        writeFileSync(
            resolve('.env'),
            `# Add your secrets here
# SLACK_TOKEN=xoxb-...
# OPENAI_KEY=sk-...
`,
            'utf-8',
        );
    }

    // Create .gitignore if it doesn't exist
    if (!existsSync(resolve('.gitignore'))) {
        writeFileSync(
            resolve('.gitignore'),
            `.env
.robinpath/
node_modules/
`,
            'utf-8',
        );
    }

    log('');
    log(color.green('Created project:'));
    log(`  robinpath.json`);
    if (!existsSync(mainPath)) log(`  ${mainFile}`);
    log(`  .env`);
    log(`  .gitignore`);
    log('');
    log(`Run: ${color.cyan('robinpath ' + mainFile)}`);
    log('');
}

/**
 * robinpath install — Install all modules from robinpath.json
 */
export async function handleProjectInstall(): Promise<void> {
    const projectFile: string = resolve('robinpath.json');
    if (!existsSync(projectFile)) {
        // Fall back to system install if no robinpath.json
        handleInstall();
        return;
    }

    let config: { modules?: Record<string, string> };
    try {
        config = JSON.parse(readFileSync(projectFile, 'utf-8'));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Invalid robinpath.json: ${err.message}`);
        process.exit(2);
    }

    const modules: Record<string, string> = config.modules || {};
    const entries: [string, string][] = Object.entries(modules);

    if (entries.length === 0) {
        log('No modules specified in robinpath.json.');
        log(`Use ${color.cyan('robinpath add <module>')} to add modules.`);
        return;
    }

    log(`Installing ${entries.length} module${entries.length !== 1 ? 's' : ''} from robinpath.json...\n`);

    const manifest = readModulesManifest();
    let installed: number = 0;
    let skipped: number = 0;
    let failed: number = 0;

    for (const [name, versionSpec] of entries) {
        // Check if already installed with matching version
        if (manifest[name]) {
            const current: string = manifest[name].version;
            // Simple check: if version spec starts with ^ or ~, accept if installed
            if (versionSpec.startsWith('^') || versionSpec.startsWith('~')) {
                log(color.green('  \u2713') + `  ${name}@${current} (already installed)`);
                skipped++;
                continue;
            }
            if (current === versionSpec) {
                log(color.green('  \u2713') + `  ${name}@${current} (already installed)`);
                skipped++;
                continue;
            }
        }

        try {
            // Extract exact version from spec (strip ^ or ~)
            const version: string = versionSpec.replace(/^[\^~]/, '');
            await handleAdd([`${name}@${version}`]);
            installed++;
        } catch (err: any) {
            log(color.red('  \u2717') + `  ${name}: ${err.message}`);
            failed++;
        }
    }

    // Generate lock file
    const lockFile: string = resolve('robinpath-lock.json');
    const updatedManifest = readModulesManifest();
    const lockData: Record<string, { version: string; integrity: string }> = {};
    for (const [name] of entries) {
        if (updatedManifest[name]) {
            lockData[name] = {
                version: updatedManifest[name].version,
                integrity: updatedManifest[name].integrity as string,
            };
        }
    }
    writeFileSync(lockFile, JSON.stringify(lockData, null, 2) + '\n', 'utf-8');

    log('');
    const parts: string[] = [];
    if (installed > 0) parts.push(color.green(`${installed} installed`));
    if (skipped > 0) parts.push(`${skipped} already installed`);
    if (failed > 0) parts.push(color.red(`${failed} failed`));
    log(parts.join(', '));
    log(color.dim('Lock file written: robinpath-lock.json'));
}

/**
 * robinpath doctor — Diagnose environment
 */
export async function handleDoctor(): Promise<void> {
    log('');
    log(color.bold('  RobinPath Doctor'));
    log(color.dim('  ' + '\u2500'.repeat(35)));
    log('');

    let issues: number = 0;

    // CLI version
    log(color.green('  \u2713') + ` CLI version ${CLI_VERSION} (lang ${ROBINPATH_VERSION})`);

    // Install location
    const installDir: string = getInstallDir();
    const isWindows: boolean = platform() === 'win32';
    const binaryName: string = isWindows ? 'robinpath.exe' : 'robinpath';
    if (existsSync(join(installDir, binaryName))) {
        log(color.green('  \u2713') + ` Installed: ${installDir}`);
    } else {
        log(color.yellow('  !') + ` Not installed to PATH. Run ${color.cyan('robinpath install')}`);
        issues++;
    }

    // Auth
    const auth = readAuth();
    const token: string | null = getAuthToken();
    if (token) {
        log(color.green('  \u2713') + ` Logged in as ${auth?.email || auth?.name || 'unknown'}`);
        if (auth?.expiresAt) {
            const remaining: number = Math.floor((auth.expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
            if (remaining < 7) {
                log(color.yellow('  !') + ` Session expires in ${remaining} day${remaining !== 1 ? 's' : ''}`);
                issues++;
            }
        }
    } else {
        log(color.yellow('  !') + ` Not logged in. Run ${color.cyan('robinpath login')}`);
        issues++;
    }

    // Modules directory
    const manifest = readModulesManifest();
    const moduleCount: number = Object.keys(manifest).length;
    if (moduleCount > 0) {
        log(color.green('  \u2713') + ` ${moduleCount} module${moduleCount !== 1 ? 's' : ''} installed`);

        // Check each module is valid
        for (const [name, info] of Object.entries(manifest)) {
            const modDir: string = getModulePath(name);
            const pkgPath: string = join(modDir, 'package.json');
            if (!existsSync(modDir)) {
                log(color.red('  \u2717') + `   ${name}: directory missing`);
                issues++;
            } else if (!existsSync(pkgPath)) {
                log(color.red('  \u2717') + `   ${name}: package.json missing`);
                issues++;
            } else {
                // Check entry point exists
                let entryPoint: string = 'dist/index.js';
                try {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    if (pkg.main) entryPoint = pkg.main;
                } catch {
                    /* use default */
                }
                if (!existsSync(join(modDir, entryPoint))) {
                    log(color.red('  \u2717') + `   ${name}: entry point ${entryPoint} missing`);
                    issues++;
                }
            }
        }
    } else {
        log(color.dim('  -') + ` No modules installed`);
    }

    // Project config
    const projectFile: string = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8'));
            log(color.green('  \u2713') + ` Project: ${config.name || 'unnamed'} v${config.version || '?'}`);

            // Check if project modules are all installed
            const projectModules: string[] = Object.keys(config.modules || {});
            for (const mod of projectModules) {
                if (!manifest[mod]) {
                    log(color.red('  \u2717') + `   Missing module: ${mod} (run ${color.cyan('robinpath install')})`);
                    issues++;
                }
            }
        } catch {
            log(color.red('  \u2717') + ' Invalid robinpath.json');
            issues++;
        }
    }

    // Cache
    if (existsSync(CACHE_DIR)) {
        try {
            const cacheFiles: string[] = readdirSync(CACHE_DIR);
            const cacheSize: number = cacheFiles.reduce((total: number, f: string) => {
                try {
                    return total + statSync(join(CACHE_DIR, f)).size;
                } catch {
                    return total;
                }
            }, 0);
            log(color.dim('  -') + ` Cache: ${cacheFiles.length} files (${(cacheSize / 1024).toFixed(0)}KB)`);
        } catch {
            /* ignore */
        }
    }

    log('');
    if (issues === 0) {
        log(color.green('  No issues found.'));
    } else {
        log(color.yellow(`  ${issues} issue${issues !== 1 ? 's' : ''} found.`));
    }
    log('');
}

/**
 * robinpath env set|list|remove — Manage environment secrets
 */
export async function handleEnv(args: string[]): Promise<void> {
    const envPath: string = join(getRobinPathHome(), 'env');
    const sub: string | undefined = args[0];

    function readEnvFile(): Record<string, string> {
        try {
            if (!existsSync(envPath)) return {};
            const lines: string[] = readFileSync(envPath, 'utf-8').split('\n');
            const env: Record<string, string> = {};
            for (const line of lines) {
                const trimmed: string = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx: number = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
                }
            }
            return env;
        } catch {
            return {};
        }
    }

    function writeEnvFile(env: Record<string, string>): void {
        const dir: string = getRobinPathHome();
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const content: string =
            Object.entries(env)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n') + '\n';
        writeFileSync(envPath, content, 'utf-8');
        if (platform() !== 'win32') {
            try {
                chmodSync(envPath, 0o600);
            } catch {
                /* ignore */
            }
        }
    }

    if (sub === 'set') {
        const key: string | undefined = args[1];
        const value: string = args.slice(2).join(' ');
        if (!key) {
            console.error(color.red('Error:') + ' Usage: robinpath env set <KEY> <value>');
            process.exit(2);
        }
        const env = readEnvFile();
        env[key] = value;
        writeEnvFile(env);
        log(color.green('Set') + ` ${key}`);
    } else if (sub === 'list') {
        const env = readEnvFile();
        const entries: [string, string][] = Object.entries(env);
        if (entries.length === 0) {
            log('No environment variables set.');
            log(`Use ${color.cyan('robinpath env set <KEY> <value>')} to add one.`);
            return;
        }
        log('');
        log(color.bold('  Environment variables:'));
        log(color.dim('  ' + '\u2500'.repeat(40)));
        for (const [key, value] of entries) {
            const masked: string =
                value.length > 4
                    ? value.slice(0, 2) + '\u2022'.repeat(Math.min(value.length - 4, 20)) + value.slice(-2)
                    : '\u2022\u2022\u2022\u2022';
            log(`  ${key.padEnd(25)} ${color.dim(masked)}`);
        }
        log('');
        log(color.dim(`${entries.length} variable${entries.length !== 1 ? 's' : ''}`));
        log('');
    } else if (sub === 'remove' || sub === 'delete') {
        const key: string | undefined = args[1];
        if (!key) {
            console.error(color.red('Error:') + ' Usage: robinpath env remove <KEY>');
            process.exit(2);
        }
        const env = readEnvFile();
        if (!env[key]) {
            console.error(color.red('Error:') + ` Variable not found: ${key}`);
            process.exit(1);
        }
        delete env[key];
        writeEnvFile(env);
        log(color.green('Removed') + ` ${key}`);
    } else {
        console.error(color.red('Error:') + ' Usage: robinpath env <set|list|remove>');
        console.error('  robinpath env set SLACK_TOKEN xoxb-...');
        console.error('  robinpath env list');
        console.error('  robinpath env remove SLACK_TOKEN');
        process.exit(2);
    }
}

/**
 * robinpath cache clean|list — Manage download cache
 */
export async function handleCache(args: string[]): Promise<void> {
    const sub: string | undefined = args[0];

    if (sub === 'list') {
        if (!existsSync(CACHE_DIR)) {
            log('Cache is empty.');
            return;
        }
        try {
            const files: string[] = readdirSync(CACHE_DIR);
            if (files.length === 0) {
                log('Cache is empty.');
                return;
            }
            log('');
            log(color.bold('  Cached packages:'));
            log(color.dim('  ' + '\u2500'.repeat(50)));
            let totalSize: number = 0;
            for (const file of files) {
                const size: number = statSync(join(CACHE_DIR, file)).size;
                totalSize += size;
                log(`  ${file.padEnd(45)} ${color.dim((size / 1024).toFixed(1) + 'KB')}`);
            }
            log('');
            log(
                color.dim(
                    `${files.length} file${files.length !== 1 ? 's' : ''}, ${(totalSize / 1024).toFixed(0)}KB total`,
                ),
            );
            log('');
        } catch (err: any) {
            console.error(color.red('Error:') + ` Failed to list cache: ${err.message}`);
            process.exit(1);
        }
    } else if (sub === 'clean') {
        if (!existsSync(CACHE_DIR)) {
            log('Cache is already empty.');
            return;
        }
        try {
            const files: string[] = readdirSync(CACHE_DIR);
            let totalSize: number = 0;
            for (const file of files) {
                totalSize += statSync(join(CACHE_DIR, file)).size;
            }
            rmSync(CACHE_DIR, { recursive: true, force: true });
            log(
                color.green('Cleared') +
                    ` ${files.length} cached file${files.length !== 1 ? 's' : ''} (${(totalSize / 1024).toFixed(0)}KB freed)`,
            );
        } catch (err: any) {
            console.error(color.red('Error:') + ` Failed to clean cache: ${err.message}`);
            process.exit(1);
        }
    } else {
        console.error(color.red('Error:') + ' Usage: robinpath cache <list|clean>');
        process.exit(2);
    }
}

/**
 * robinpath audit — Check installed modules for issues
 */
export async function handleAudit(): Promise<void> {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed. Nothing to audit.');
        return;
    }

    log(`Auditing ${entries.length} module${entries.length !== 1 ? 's' : ''}...\n`);

    let warnings: number = 0;
    let ok: number = 0;
    const token: string | null = getAuthToken();

    for (const [fullName, info] of entries) {
        const parsed = parsePackageSpec(fullName);
        if (!parsed || !parsed.scope) {
            log(color.yellow('  !') + `  ${fullName}: invalid package name`);
            warnings++;
            continue;
        }

        try {
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;

            const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/${parsed.scope}/${parsed.name}`, {
                headers,
            });

            if (!res.ok) {
                log(color.yellow('  !') + `  ${fullName}: could not check registry`);
                warnings++;
                continue;
            }

            const body = (await res.json()) as any;
            const data = body.data || body;

            // Check if deprecated
            if (data.deprecated) {
                log(
                    color.red('  \u2717') +
                        `  ${fullName}@${info.version} \u2014 ${color.red('deprecated')}: ${data.deprecated}`,
                );
                warnings++;
                continue;
            }

            // Check if outdated
            const latest: string | undefined = data.latestVersion || data.version;
            if (latest && latest !== info.version) {
                log(color.yellow('  !') + `  ${fullName}@${info.version} \u2192 ${latest} available`);
                warnings++;
            } else {
                log(color.green('  \u2713') + `  ${fullName}@${info.version}`);
                ok++;
            }
        } catch (err: any) {
            log(color.yellow('  !') + `  ${fullName}: ${err.message}`);
            warnings++;
        }
    }

    log('');
    if (warnings === 0) {
        log(color.green(`No issues found. ${ok} module${ok !== 1 ? 's' : ''} OK.`));
    } else {
        log(`${color.yellow(warnings + ' warning' + (warnings !== 1 ? 's' : ''))}` + (ok > 0 ? `, ${ok} OK` : ''));
    }
    log('');
}

/**
 * robinpath deprecate <pkg> "reason" — Mark a module as deprecated
 */
export async function handleDeprecate(args: string[]): Promise<void> {
    const spec: string | undefined = args.find((a) => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath deprecate <module> "reason"');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const reason: string =
        args.filter((a) => a !== spec && !a.startsWith('-')).join(' ') || 'This module is deprecated';
    const { scope, name, fullName } = parsed;
    const token: string = requireAuth();

    log(`Deprecating ${fullName}...`);

    try {
        const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}/deprecate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: reason }),
        });

        if (res.ok) {
            log(color.yellow('Deprecated') + ` ${fullName}: ${reason}`);
        } else {
            const body = (await res.json().catch(() => ({}))) as any;
            console.error(
                color.red('Error:') + ` Failed to deprecate: ${body?.error?.message || 'HTTP ' + res.status}`,
            );
            process.exit(1);
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to deprecate: ${err.message}`);
        process.exit(1);
    }
}
