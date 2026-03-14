/**
 * RobinPath CLI — Module management commands
 * Extracted from cli-entry.js and converted to TypeScript.
 */
import { createInterface } from 'node:readline';
import {
    readFileSync,
    existsSync,
    mkdirSync,
    copyFileSync,
    rmSync,
    writeFileSync,
    readdirSync,
    statSync,
    unlinkSync,
} from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir, platform, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { CLI_VERSION, FLAG_QUIET, color, log, logVerbose, getRobinPathHome, getInstallDir } from './utils';

import {
    readModulesManifest,
    writeModulesManifest,
    getModulePath,
    parsePackageSpec,
    loadInstalledModules,
    createRobinPath,
    requireAuth,
    platformFetch,
    toTarPath,
    MODULES_DIR,
    CACHE_DIR,
    MODULES_MANIFEST,
    getAuthToken,
    readAuth,
    getAuthPath,
} from './commands-core';

import { nativeModules, ROBINPATH_VERSION } from './runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NativeModule {
    name: string;
    functions: Record<string, (...args: any[]) => any>;
    functionMetadata?: Record<string, unknown>;
    moduleMetadata?: { description?: string; [key: string]: unknown };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_URL: string = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';
const isTTY: boolean = !!(process.stdout.isTTY || process.stderr.isTTY);

const VALID_CATEGORIES: string[] = [
    'utilities',
    'devops',
    'productivity',
    'web',
    'sales',
    'marketing',
    'data',
    'communication',
    'ai',
];
const VALID_SORTS: string[] = ['downloads', 'stars', 'updated', 'created', 'name'];

// ---------------------------------------------------------------------------
// handleAdd
// ---------------------------------------------------------------------------

/**
 * robinpath add <pkg>[@version] — Install a module from the registry
 */
export async function handleAdd(args: string[]): Promise<void> {
    const spec: string | undefined = args.find((a) => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath add <module>[@version]');
        console.error('  Example: robinpath add @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.name) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { scope, name, fullName, version } = parsed;
    if (!scope) {
        console.error(color.red('Error:') + ' Module must be scoped (e.g. @robinpath/slack)');
        process.exit(2);
    }

    const token: string = requireAuth();

    // Check if already installed
    const manifest = readModulesManifest();
    if (manifest[fullName] && !args.includes('--force')) {
        const current: string = manifest[fullName].version;
        if (version && version === current) {
            log(`${fullName}@${current} is already installed.`);
            return;
        }
        if (!version) {
            log(color.dim(`Reinstalling ${fullName} (currently ${current})...`));
        }
    }

    // Resolve version if not specified
    let resolvedVersion: string | null = version;
    if (!resolvedVersion) {
        try {
            const infoRes: Response = await platformFetch(`/v1/registry/${scope}/${name}`);
            if (!infoRes.ok) {
                console.error(color.red('Error:') + ` Module not found: ${fullName}`);
                process.exit(1);
            }
            const info = (await infoRes.json()) as { data?: { latestVersion?: string; version?: string } };
            resolvedVersion = info.data?.latestVersion || info.data?.version || null;
            if (!resolvedVersion) {
                console.error(color.red('Error:') + ` No versions available for ${fullName}`);
                process.exit(1);
            }
        } catch (err: unknown) {
            console.error(color.red('Error:') + ` Could not reach registry: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    log(`Installing ${fullName}@${resolvedVersion}...`);

    // Download tarball from registry
    let tarballBuffer: Buffer;
    try {
        const res: Response = await platformFetch(`/v1/registry/${scope}/${name}/${resolvedVersion}/tarball`);

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Module or version not found: ${fullName}@${resolvedVersion}`);
            } else if (res.status === 401 || res.status === 403) {
                console.error(
                    color.red('Error:') + ' Access denied. You may not have permission to install this module.',
                );
            } else {
                const body = (await res.json().catch(() => ({}) as Record<string, unknown>)) as {
                    error?: { message?: string };
                };
                console.error(
                    color.red('Error:') + ` Failed to download: ${body?.error?.message || 'HTTP ' + res.status}`,
                );
            }
            process.exit(1);
        }

        tarballBuffer = Buffer.from(await res.arrayBuffer());
    } catch (err: unknown) {
        console.error(color.red('Error:') + ` Could not reach registry: ${(err as Error).message}`);
        process.exit(1);
    }

    // Compute integrity hash
    const integrity: string = 'sha256-' + createHash('sha256').update(tarballBuffer!).digest('hex');

    // Cache tarball
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cacheFile: string = join(CACHE_DIR, `${scope}-${name}-${resolvedVersion}.tar.gz`);
    writeFileSync(cacheFile, tarballBuffer!);

    // Extract to modules dir
    const modDir: string = getModulePath(fullName);
    if (existsSync(modDir)) {
        rmSync(modDir, { recursive: true, force: true });
    }
    mkdirSync(modDir, { recursive: true });

    // Write tarball to temp, extract
    const tmpFile: string = join(tmpdir(), `robinpath-add-${Date.now()}.tar.gz`);
    writeFileSync(tmpFile, tarballBuffer!);

    try {
        execSync(`tar xzf "${toTarPath(tmpFile)}" --strip-components=1 -C "${toTarPath(modDir)}"`, { stdio: 'pipe' });
    } catch (err: unknown) {
        // Clean up on failure
        rmSync(modDir, { recursive: true, force: true });
        try {
            unlinkSync(tmpFile);
        } catch {
            /* ignore */
        }
        console.error(color.red('Error:') + ` Failed to extract module: ${(err as Error).message}`);
        process.exit(1);
    }

    try {
        unlinkSync(tmpFile);
    } catch {
        /* ignore */
    }

    // Build if dist/ is missing but src/ exists (module published without build)
    const distDir: string = join(modDir, 'dist');
    const srcDir: string = join(modDir, 'src');
    if (!existsSync(distDir) && existsSync(srcDir) && existsSync(join(srcDir, 'index.ts'))) {
        log(color.dim('  Compiling module...'));
        mkdirSync(distDir, { recursive: true });
        // Strip TypeScript types using Node 22's built-in --experimental-strip-types
        // Each .ts file → .js file with types removed
        const tsFiles: string[] = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
        for (const file of tsFiles) {
            const srcFile: string = join(srcDir, file);
            const outFile: string = join(distDir, file.replace('.ts', '.js'));
            try {
                // Use node's module.stripTypeScriptTypes (Node 22.6+)
                const stripScript: string = `
                    const fs = require('fs');
                    const { stripTypeScriptTypes } = require('module');
                    const src = fs.readFileSync(${JSON.stringify(srcFile)}, 'utf-8');
                    const js = stripTypeScriptTypes(src, { mode: 'transform', sourceMap: false });
                    fs.writeFileSync(${JSON.stringify(outFile)}, js);
                `;
                execSync(`node -e "${stripScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
            } catch {
                // Fallback: copy as-is (may fail to load)
                copyFileSync(srcFile, outFile);
            }
        }
    }

    // Read extracted package.json for version info
    let installedVersion: string = resolvedVersion!;
    const pkgJsonPath: string = join(modDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version?: string };
            installedVersion = pkg.version || installedVersion;
        } catch {
            /* ignore */
        }
    }

    // Check for module dependencies
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { robinpath?: { depends?: string[] } };
            const depends: string[] = pkg.robinpath?.depends || [];
            for (const dep of depends) {
                if (!manifest[dep]) {
                    log(color.dim(`  Installing dependency: ${dep}`));
                    await handleAdd([dep]);
                }
            }
        } catch {
            /* ignore dependency errors */
        }
    }

    // Update manifest
    const updatedManifest = readModulesManifest();
    updatedManifest[fullName] = {
        version: installedVersion,
        integrity,
        installedAt: new Date().toISOString(),
    };
    writeModulesManifest(updatedManifest);

    // Update robinpath.json if it exists in cwd
    const projectFile: string = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8')) as { modules?: Record<string, string> };
            if (!config.modules) config.modules = {};
            config.modules[fullName] = `^${installedVersion}`;
            writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        } catch {
            /* ignore project file errors */
        }
    }

    log(color.green('Installed') + ` ${fullName}@${installedVersion}`);
}

// ---------------------------------------------------------------------------
// handleRemove
// ---------------------------------------------------------------------------

/**
 * robinpath remove <pkg> — Uninstall a module
 */
export async function handleRemove(args: string[]): Promise<void> {
    const spec: string | undefined = args.find((a) => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath remove <module>');
        console.error('  Example: robinpath remove @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.fullName) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { fullName } = parsed;
    const manifest = readModulesManifest();

    if (!manifest[fullName]) {
        console.error(color.red('Error:') + ` Module not installed: ${fullName}`);
        process.exit(1);
    }

    // Remove module directory
    const modDir: string = getModulePath(fullName);
    if (existsSync(modDir)) {
        rmSync(modDir, { recursive: true, force: true });
    }

    // Clean up empty parent scope directory
    const scopeDir: string = dirname(modDir);
    try {
        const remaining: string[] = readdirSync(scopeDir);
        if (remaining.length === 0) {
            rmSync(scopeDir, { recursive: true, force: true });
        }
    } catch {
        /* ignore */
    }

    // Update manifest
    delete manifest[fullName];
    writeModulesManifest(manifest);

    // Update robinpath.json if it exists in cwd
    const projectFile: string = resolve('robinpath.json');
    if (existsSync(projectFile)) {
        try {
            const config = JSON.parse(readFileSync(projectFile, 'utf-8')) as { modules?: Record<string, string> };
            if (config.modules && config.modules[fullName]) {
                delete config.modules[fullName];
                writeFileSync(projectFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            }
        } catch {
            /* ignore project file errors */
        }
    }

    log(color.green('Removed') + ` ${fullName}`);
}

// ---------------------------------------------------------------------------
// handleUpgrade
// ---------------------------------------------------------------------------

/**
 * robinpath upgrade <pkg> — Upgrade a single module to the latest version
 */
export async function handleUpgrade(args: string[]): Promise<void> {
    const spec: string | undefined = args.find((a) => !a.startsWith('-'));
    if (!spec) {
        console.error(color.red('Error:') + ' Usage: robinpath upgrade <module>');
        console.error('  Example: robinpath upgrade @robinpath/slack');
        process.exit(2);
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.fullName || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { fullName, scope, name } = parsed;
    const manifest = readModulesManifest();

    if (!manifest[fullName]) {
        console.error(
            color.red('Error:') +
                ` Module not installed: ${fullName}. Use ${color.cyan('robinpath add ' + fullName)} first.`,
        );
        process.exit(1);
    }

    const currentVersion: string = manifest[fullName].version;
    log(`Checking for updates to ${fullName}@${currentVersion}...`);

    // Check latest version from registry
    try {
        const token: string = requireAuth();
        const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            console.error(color.red('Error:') + ` Could not check registry (HTTP ${res.status})`);
            process.exit(1);
        }

        const body = (await res.json()) as {
            data?: { latestVersion?: string; version?: string };
            latestVersion?: string;
            version?: string;
        };
        const data = body.data || body;
        const latestVersion: string | undefined = data.latestVersion || data.version;

        if (latestVersion === currentVersion) {
            log(color.green('Already up to date') + ` ${fullName}@${currentVersion}`);
            return;
        }

        log(`Upgrading ${fullName}: ${currentVersion} → ${latestVersion}`);
        await handleAdd([fullName, '--force']);
    } catch (err: unknown) {
        console.error(color.red('Error:') + ` Upgrade failed: ${(err as Error).message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// handleModulesList
// ---------------------------------------------------------------------------

/**
 * robinpath modules list — List installed modules
 */
export async function handleModulesList(): Promise<void> {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed.');
        log(`Run ${color.cyan('robinpath add <module>')} to install your first module.`);
        return;
    }

    log(color.bold('  Name'.padEnd(40) + 'Version'.padEnd(14) + 'Installed'));
    log(color.dim('  ' + '─'.repeat(62)));

    for (const [name, info] of entries) {
        const date: string = info.installedAt ? (info.installedAt as string).split('T')[0] : '-';
        log(`  ${name.padEnd(38)}${(info.version || '-').padEnd(14)}${date}`);
    }

    log('');
    log(color.dim(`${entries.length} module${entries.length !== 1 ? 's' : ''} installed`));
}

// ---------------------------------------------------------------------------
// handleModulesUpgradeAll
// ---------------------------------------------------------------------------

/**
 * robinpath modules upgrade — Upgrade all installed modules
 */
export async function handleModulesUpgradeAll(): Promise<void> {
    const manifest = readModulesManifest();
    const entries = Object.entries(manifest);

    if (entries.length === 0) {
        log('No modules installed.');
        return;
    }

    log(`Checking ${entries.length} module${entries.length !== 1 ? 's' : ''} for updates...\n`);

    let upgraded: number = 0;
    let upToDate: number = 0;
    let failed: number = 0;

    for (const [fullName, info] of entries) {
        const parsed = parsePackageSpec(fullName);
        if (!parsed || !parsed.scope) {
            failed++;
            continue;
        }

        try {
            const token: string | null = getAuthToken();
            if (!token) {
                console.error(color.red('Error:') + ' Not logged in. Run ' + color.cyan('robinpath login'));
                process.exit(1);
            }

            const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/${parsed.scope}/${parsed.name}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) {
                log(color.yellow('Skip') + `  ${fullName} (registry error)`);
                failed++;
                continue;
            }

            const body = (await res.json()) as {
                data?: { latestVersion?: string; version?: string };
                latestVersion?: string;
                version?: string;
            };
            const data = body.data || body;
            const latestVersion: string | undefined = data.latestVersion || data.version;

            if (latestVersion === info.version) {
                log(color.green('  ✓') + `  ${fullName}@${info.version} (up to date)`);
                upToDate++;
            } else {
                log(color.cyan('  ↑') + `  ${fullName}: ${info.version} → ${latestVersion}`);
                await handleAdd([fullName, '--force']);
                upgraded++;
            }
        } catch (err: unknown) {
            log(color.yellow('Skip') + `  ${fullName} (${(err as Error).message})`);
            failed++;
        }
    }

    log('');
    const parts: string[] = [];
    if (upgraded > 0) parts.push(color.green(`${upgraded} upgraded`));
    if (upToDate > 0) parts.push(`${upToDate} up to date`);
    if (failed > 0) parts.push(color.yellow(`${failed} failed`));
    log(parts.join(', '));
}

// ---------------------------------------------------------------------------
// handleModulesInit
// ---------------------------------------------------------------------------

/**
 * robinpath modules init — Scaffold a new RobinPath module
 */
export async function handleModulesInit(): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def?: string): Promise<string> =>
        new Promise((resolve) => {
            const prompt: string = def ? `${q} (${def}): ` : `${q}: `;
            rl.question(prompt, (answer) => resolve(answer.trim() || def || ''));
        });

    log('');
    log(color.bold('  Create a new RobinPath module'));
    log(color.dim('  ' + '─'.repeat(35)));
    log('');

    const rawName: string = await ask('  Module name');
    if (!rawName) {
        console.error(color.red('Error:') + ' Module name is required');
        rl.close();
        process.exit(2);
    }

    // Slugify: "My First Module" → "my-first-module"
    const moduleName: string = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    if (!moduleName) {
        console.error(color.red('Error:') + ' Invalid module name');
        rl.close();
        process.exit(2);
    }

    if (moduleName !== rawName) {
        log(color.dim(`  → ${moduleName}`));
    }

    const defaultDisplay: string = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const displayName: string = await ask('  Display name', defaultDisplay);
    const description: string = await ask('  Description', `${displayName} integration for RobinPath`);

    log('');
    log(color.dim('  Categories: api, messaging, crm, ai, database, storage, analytics, dev-tools, utilities'));
    const category: string = await ask('  Category', 'utilities');

    // Auto-fill author from auth
    const auth = readAuth();
    const defaultAuthor: string = (auth as { email?: string })?.email || '';
    const author: string = await ask('  Author', defaultAuthor);
    const license: string = await ask('  License', 'MIT');

    const defaultScope: string = (auth as { email?: string })?.email?.split('@')[0] || 'robinpath';
    const scope: string = await ask('  Scope', defaultScope);

    rl.close();

    const fullName: string = `@${scope}/${moduleName}`;
    const pascalName: string = moduleName.replace(/(^|[-_])(\w)/g, (_: string, __: string, c: string) =>
        c.toUpperCase(),
    );
    const targetDir: string = resolve(moduleName);

    log('');
    log(`Creating ${color.cyan(fullName)}...`);

    if (existsSync(targetDir)) {
        console.error(color.red('Error:') + ` Directory already exists: ${moduleName}/`);
        process.exit(1);
    }

    // Create directories
    mkdirSync(join(targetDir, 'src'), { recursive: true });
    mkdirSync(join(targetDir, 'tests'), { recursive: true });

    // package.json
    writeFileSync(
        join(targetDir, 'package.json'),
        JSON.stringify(
            {
                name: fullName,
                version: '0.1.0',
                description,
                author,
                license,
                type: 'module',
                main: 'dist/index.js',
                types: 'dist/index.d.ts',
                exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
                files: ['dist'],
                scripts: { build: 'tsc', test: `robinpath test tests/` },
                robinpath: { category, displayName },
                peerDependencies: { '@wiredwp/robinpath': '>=1.30.0' },
                devDependencies: { '@wiredwp/robinpath': '^0.30.1', typescript: '^5.6.0' },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );

    // src/index.ts
    writeFileSync(
        join(targetDir, 'src', 'index.ts'),
        `import type { ModuleAdapter } from "@wiredwp/robinpath";
import {
  ${pascalName}Functions,
  ${pascalName}FunctionMetadata,
  ${pascalName}ModuleMetadata,
} from "./${moduleName}.js";

const ${pascalName}Module: ModuleAdapter = {
  name: "${moduleName}",
  functions: ${pascalName}Functions,
  functionMetadata: ${pascalName}FunctionMetadata,
  moduleMetadata: ${pascalName}ModuleMetadata,
  global: false,
};

export default ${pascalName}Module;
export { ${pascalName}Module };
`,
        'utf-8',
    );

    // src/<name>.ts
    writeFileSync(
        join(targetDir, 'src', `${moduleName}.ts`),
        `import type {
  BuiltinHandler,
  FunctionMetadata,
  ModuleMetadata,
} from "@wiredwp/robinpath";

// ─── Functions ─────────────────────────────────────────

const hello: BuiltinHandler = (args) => {
  const name = String(args[0] ?? "world");
  return \`Hello from ${moduleName}: \${name}\`;
};

const configure: BuiltinHandler = (args) => {
  const apiKey = String(args[0] ?? "");
  if (!apiKey) throw new Error("API key is required");
  return { configured: true };
};

// ─── Exports ───────────────────────────────────────────

export const ${pascalName}Functions: Record<string, BuiltinHandler> = {
  hello,
  configure,
};

export const ${pascalName}FunctionMetadata: Record<string, FunctionMetadata> = {
  hello: {
    description: "Say hello",
    parameters: [
      {
        name: "name",
        dataType: "string",
        description: "Name to greet",
        formInputType: "text",
        required: false,
        defaultValue: "world",
      },
    ],
    returnType: "string",
    returnDescription: "Greeting message",
    example: '${moduleName}.hello "Alice"',
  },
  configure: {
    description: "Configure API credentials",
    parameters: [
      {
        name: "apiKey",
        dataType: "string",
        description: "Your API key",
        formInputType: "password",
        required: true,
      },
    ],
    returnType: "object",
    returnDescription: "{ configured: true }",
    example: '${moduleName}.configure "your-api-key"',
  },
};

export const ${pascalName}ModuleMetadata: ModuleMetadata = {
  description: "${description}",
  methods: ["hello", "configure"],
  author: "${author}",
  category: "${category}",
};
`,
        'utf-8',
    );

    // tsconfig.json
    writeFileSync(
        join(targetDir, 'tsconfig.json'),
        JSON.stringify(
            {
                compilerOptions: {
                    target: 'ES2022',
                    module: 'ES2022',
                    moduleResolution: 'node16',
                    declaration: true,
                    declarationMap: true,
                    sourceMap: true,
                    outDir: 'dist',
                    rootDir: 'src',
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true,
                },
                include: ['src'],
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );

    // tests/<name>.test.rp
    writeFileSync(
        join(targetDir, 'tests', `${moduleName}.test.rp`),
        `# ${displayName} module tests
# Run: robinpath test tests/

@desc "hello returns greeting"
do
  ${moduleName}.hello "Alice" into $result
  test.assertContains $result "Alice"
enddo

@desc "hello defaults to world"
do
  ${moduleName}.hello into $result
  test.assertContains $result "world"
enddo
`,
        'utf-8',
    );

    // README.md
    writeFileSync(
        join(targetDir, 'README.md'),
        `# ${fullName}

${description}

## Install

\`\`\`bash
robinpath add ${fullName}
\`\`\`

## Usage

\`\`\`robinpath
# Configure credentials
${moduleName}.configure "your-api-key"

# Say hello
${moduleName}.hello "Alice"
log $
\`\`\`

## Functions

| Function | Description |
|----------|-------------|
| \`configure\` | Configure API credentials |
| \`hello\` | Say hello |

## Development

\`\`\`bash
npm install
npm run build
robinpath test tests/
\`\`\`

## License

${license}
`,
        'utf-8',
    );

    // .gitignore
    writeFileSync(
        join(targetDir, '.gitignore'),
        `node_modules/
dist/
*.tgz
`,
        'utf-8',
    );

    log('');
    log(color.green('Generated:'));
    log(`  ${moduleName}/`);
    log(`  ├── package.json`);
    log(`  ├── src/`);
    log(`  │   ├── index.ts`);
    log(`  │   └── ${moduleName}.ts`);
    log(`  ├── tests/`);
    log(`  │   └── ${moduleName}.test.rp`);
    log(`  ├── tsconfig.json`);
    log(`  ├── README.md`);
    log(`  └── .gitignore`);
    log('');
    log(color.bold('Next steps:'));
    log(`  1. cd ${moduleName}`);
    log(`  2. Edit src/${moduleName}.ts — add your functions`);
    log(`  3. npm install && npm run build`);
    log(`  4. robinpath publish`);
    log('');
}

// ---------------------------------------------------------------------------
// handlePack
// ---------------------------------------------------------------------------

/**
 * robinpath pack — Create tarball locally without publishing
 */
export async function handlePack(args: string[]): Promise<void> {
    const targetArg: string = args.find((a) => !a.startsWith('-')) || '.';
    const targetDir: string = resolve(targetArg);

    const pkgPath: string = join(targetDir, 'package.json');
    if (!existsSync(pkgPath)) {
        console.error(color.red('Error:') + ` No package.json found in ${targetDir}`);
        process.exit(2);
    }

    let pkg: { name?: string; version?: string };
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; version?: string };
    } catch (err: unknown) {
        console.error(color.red('Error:') + ` Invalid package.json: ${(err as Error).message}`);
        process.exit(2);
    }

    if (!pkg!.name || !pkg!.version) {
        console.error(color.red('Error:') + ' package.json must have "name" and "version" fields');
        process.exit(2);
    }

    const safeName: string = pkg!.name!.replace(/^@/, '').replace(/\//g, '-');
    const outputFile: string = `${safeName}-${pkg!.version}.tar.gz`;
    const outputPath: string = resolve(outputFile);
    const parentDir: string = dirname(targetDir);
    const dirName: string = basename(targetDir);

    log(`Packing ${pkg!.name}@${pkg!.version}...`);

    try {
        execSync(
            `tar czf "${toTarPath(outputPath)}" --exclude=node_modules --exclude=.git --exclude=dist --exclude="*.tar.gz" -C "${toTarPath(parentDir)}" "${dirName}"`,
            { stdio: 'pipe' },
        );
    } catch (err: unknown) {
        // tar may exit 1 with "file changed as we read it" — check if tarball was created
        if (!existsSync(outputPath)) {
            console.error(color.red('Error:') + ` Failed to create tarball: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    const size: number = statSync(outputPath).size;
    log(color.green('Created') + ` ${outputFile} (${(size / 1024).toFixed(1)}KB)`);
}

// ---------------------------------------------------------------------------
// formatCompactNumber
// ---------------------------------------------------------------------------

/**
 * Format a number with K/M suffixes for compact display
 */
export function formatCompactNumber(n: number | null | undefined): string {
    if (n == null) return '-';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

// ---------------------------------------------------------------------------
// formatTimeAgo
// ---------------------------------------------------------------------------

/**
 * Format a relative time string (e.g. "3 days ago")
 */
export function formatTimeAgo(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const diff: number = Date.now() - new Date(dateStr).getTime();
    const secs: number = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins: number = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours: number = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days: number = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months: number = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// handleSearch
// ---------------------------------------------------------------------------

/**
 * robinpath search [query] — Search the module registry
 */
export async function handleSearch(args: string[]): Promise<void> {
    const query: string = args.filter((a) => !a.startsWith('-')).join(' ');
    const category: string | undefined = args.find((a) => a.startsWith('--category='))?.split('=')[1];
    const sort: string | undefined = args.find((a) => a.startsWith('--sort='))?.split('=')[1];
    const page: string | undefined = args.find((a) => a.startsWith('--page='))?.split('=')[1];
    const limit: string | undefined = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
    const jsonOutput: boolean = args.includes('--json');

    if (!query && !category) {
        console.error(color.red('Error:') + ' Usage: robinpath search <query> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --category=<cat>   Filter by category (' + VALID_CATEGORIES.join(', ') + ')');
        console.error('    --sort=<key>       Sort by: ' + VALID_SORTS.join(', ') + ' (default: downloads)');
        console.error('    --page=<n>         Page number (default: 1)');
        console.error('    --limit=<n>        Results per page (default: 20)');
        console.error('    --json             Machine-readable JSON output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath search slack');
        console.error('    robinpath search --category=ai');
        console.error('    robinpath search crm --category=sales --sort=stars');
        process.exit(2);
    }

    if (category && !VALID_CATEGORIES.includes(category)) {
        console.error(color.red('Error:') + ` Invalid category: ${category}`);
        console.error('  Valid categories: ' + VALID_CATEGORIES.join(', '));
        process.exit(2);
    }

    if (sort && !VALID_SORTS.includes(sort)) {
        console.error(color.red('Error:') + ` Invalid sort: ${sort}`);
        console.error('  Valid sorts: ' + VALID_SORTS.join(', '));
        process.exit(2);
    }

    const token: string | null = getAuthToken();

    const searchLabel: string = query ? `"${query}"` : `category: ${category}`;
    log(`Searching for ${searchLabel}...\n`);

    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (category) params.set('category', category);
        if (sort) params.set('sort', sort);
        if (page) params.set('page', page);
        if (limit) params.set('limit', limit);

        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/search?${params}`, { headers });
        if (!res.ok) {
            console.error(color.red('Error:') + ` Search failed (HTTP ${res.status})`);
            process.exit(1);
        }

        const body = (await res.json()) as {
            data?: unknown[];
            modules?: unknown[];
            pagination?: { page: number; pages: number; total: number } | null;
        };
        const modules: Record<string, unknown>[] = (body.data || body.modules || []) as Record<string, unknown>[];
        const pagination = body.pagination || null;

        if (jsonOutput) {
            console.log(JSON.stringify({ modules, pagination }, null, 2));
            return;
        }

        if (modules.length === 0) {
            log('No modules found.');
            return;
        }

        // Rich table output
        const nameW: number = 30;
        const verW: number = 10;
        const dlW: number = 10;
        const starW: number = 7;
        const updW: number = 10;
        log(
            color.bold(
                '  ' +
                    'Name'.padEnd(nameW) +
                    'Version'.padEnd(verW) +
                    'Downloads'.padEnd(dlW) +
                    'Stars'.padEnd(starW) +
                    'Updated'.padEnd(updW) +
                    'Description',
            ),
        );
        log(color.dim('  ' + '─'.repeat(nameW + verW + dlW + starW + updW + 25)));

        for (const mod of modules) {
            const modName: string =
                (mod.scope ? `@${mod.scope}/${mod.name}` : (mod.name as string)) || (mod.id as string) || '?';
            const ver: string = (mod.version || mod.latestVersion || '-') as string;
            const dl: string = formatCompactNumber(
                (mod.downloadsTotal ?? mod.downloadsWeekly ?? mod.downloads ?? mod.downloadCount) as number | null,
            );
            const stars: string = formatCompactNumber(mod.stars as number | null);
            const updated: string = formatTimeAgo(mod.updatedAt as string | null);
            const desc: string = ((mod.description || '') as string).slice(0, 25);
            const badges: string[] = [];
            if (mod.isOfficial) badges.push(color.cyan('●'));
            if (mod.isVerified) badges.push(color.green('✓'));
            const badgeStr: string = badges.length ? ' ' + badges.join('') : '';

            log(
                `  ${(modName + badgeStr).padEnd(nameW + (badgeStr.length - badges.length))}${ver.padEnd(verW)}${dl.padEnd(dlW)}${('★ ' + stars).padEnd(starW)}${color.dim(updated.padEnd(updW))}${color.dim(desc)}`,
            );
        }

        log('');
        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${modules.length} result${modules.length !== 1 ? 's' : ''}`));
        }
    } catch (err: unknown) {
        console.error(color.red('Error:') + ` Search failed: ${(err as Error).message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// handleInfo
// ---------------------------------------------------------------------------

/**
 * robinpath info <pkg> — Show module details
 */
export async function handleInfo(args: string[]): Promise<void> {
    const spec: string | undefined = args.find((a) => !a.startsWith('-'));
    const jsonOutput: boolean = args.includes('--json');
    if (!spec) {
        // Collect native module info
        const modulesInfo: Record<
            string,
            { functions: string[]; description: string | null; function_metadata: Record<string, unknown> | null }
        > = {};
        for (const mod of nativeModules) {
            modulesInfo[mod.name] = {
                functions: Object.keys(mod.functions),
                description: mod.moduleMetadata?.description || null,
                function_metadata: mod.functionMetadata || null,
            };
        }

        // Collect installed (external) module info from manifest
        const installedModulesInfo: Record<string, Record<string, unknown>> = {};
        const manifest = readModulesManifest();
        for (const [packageName, mInfo] of Object.entries(manifest)) {
            const entry: Record<string, unknown> = {
                version: mInfo.version,
                installed_at: (mInfo as Record<string, unknown>).installedAt || null,
                path: getModulePath(packageName),
            };
            // Try to read module's package.json for description & functions
            try {
                const pkgPath: string = join(getModulePath(packageName), 'package.json');
                if (existsSync(pkgPath)) {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
                        description?: string;
                        keywords?: string[];
                    };
                    if (pkg.description) entry.description = pkg.description;
                    if (pkg.keywords) entry.keywords = pkg.keywords;
                }
            } catch {
                /* ignore */
            }
            installedModulesInfo[packageName] = entry;
        }

        // No args — show system/environment info for external tools and AI agents
        const info = {
            ok: true,
            version: CLI_VERSION,
            lang_version: ROBINPATH_VERSION,
            platform: platform(),
            arch: process.arch,
            node_version: process.version,
            executable: process.execPath,
            pid: process.pid,
            paths: {
                home: getRobinPathHome(),
                bin: getInstallDir(),
                modules: MODULES_DIR,
                modules_manifest: MODULES_MANIFEST,
                cache: CACHE_DIR,
                auth: getAuthPath(),
                history: join(homedir(), '.robinpath', 'history'),
                env: join(homedir(), '.robinpath', 'env'),
                docs: join(getRobinPathHome(), 'DOCUMENTATION.md'),
            },
            native_modules: modulesInfo,
            installed_modules: installedModulesInfo,
            docs: {
                overview:
                    'RobinPath is a scripting language for automation and data processing. It can be used as a CLI tool, an embedded SDK for JavaScript apps, or an HTTP server for integration with any programming language.',
                install: {
                    unix: 'curl -fsSL https://dev.robinpath.com/install.sh | bash',
                    windows: 'irm https://dev.robinpath.com/install.ps1 | iex',
                },
                cli_commands: {
                    run_file: 'robinpath <file.rp>',
                    run_inline: 'robinpath -e \'log "hello"\'',
                    run_stdin: "echo 'log 1' | robinpath",
                    fmt: 'robinpath fmt <file|dir> [--write] [--check] [--diff]',
                    check: 'robinpath check <file> [--json]',
                    ast: 'robinpath ast <file> [--compact]',
                    test: 'robinpath test [dir|file] [--json]',
                    add_module: 'robinpath add <@scope/name>[@version]',
                    remove_module: 'robinpath remove <@scope/name>',
                    upgrade_module: 'robinpath upgrade <@scope/name>',
                    list_modules: 'robinpath modules list',
                    upgrade_all: 'robinpath modules upgrade',
                    scaffold_module: 'robinpath modules init',
                    search: 'robinpath search [query] [--category=<cat>] [--sort=<key>] [--page=<n>] [--limit=<n>] [--json]',
                    info_system: 'robinpath info [--json]',
                    info_module: 'robinpath info <@scope/name>',
                    audit: 'robinpath audit',
                    init_project: 'robinpath init [--force]',
                    install_deps: 'robinpath install',
                    doctor: 'robinpath doctor',
                    env_set: 'robinpath env set <KEY> <value>',
                    env_list: 'robinpath env list',
                    env_remove: 'robinpath env remove <KEY>',
                    cache_list: 'robinpath cache list',
                    cache_clean: 'robinpath cache clean',
                    install_system: 'robinpath install',
                    uninstall: 'robinpath uninstall',
                    update: 'robinpath update',
                    login: 'robinpath login',
                    logout: 'robinpath logout',
                    whoami: 'robinpath whoami',
                    publish:
                        'robinpath publish [dir] [--public|--private] [--org <name>] [--patch|--minor|--major] [--dry-run]',
                    pack: 'robinpath pack [dir]',
                    deprecate: 'robinpath deprecate <@scope/name> "reason"',
                    sync: 'robinpath sync',
                    start_server:
                        'robinpath start [-p port] [-s session] [--host addr] [--timeout ms] [--max-concurrent n] [--cors-origin origin] [--log-file path] [--max-body bytes]',
                    server_status: 'robinpath status [-p port]',
                    watch: 'robinpath --watch <file.rp>',
                    repl: 'robinpath (no arguments)',
                },
                global_flags: {
                    '-q, --quiet': 'Suppress non-error output',
                    '--verbose': 'Show timing and debug info',
                    '-v, --version': 'Show version',
                    '-h, --help': 'Show help',
                    '-w, --watch': 'Re-run on file changes',
                },
                http_server: {
                    description:
                        'Start an HTTP server that exposes the RobinPath engine via REST API. One server handles all requests. Variables persist across requests (conversational execution). Designed for integration with any language (Rust, Python, Go, PHP, Ruby, C#, Java, etc.).',
                    start: 'robinpath start -p <port> -s <session-secret>',
                    startup_output: `{"ok":true,"port":6372,"host":"127.0.0.1","session":"<uuid>","version":"${CLI_VERSION}"}`,
                    auth_header: 'x-robinpath-session: <session-token> (required on all endpoints except /v1/health)',
                    defaults: {
                        port: 6372,
                        host: '127.0.0.1',
                        timeout_ms: 30000,
                        max_concurrent: 5,
                        max_body_bytes: 5000000,
                        cors_origin: '*',
                    },
                    endpoints: {
                        'GET /v1/health': {
                            auth: false,
                            description: 'Health check',
                            response: '{"ok":true,"version":"...","uptime_ms":...}',
                        },
                        'POST /v1/execute': {
                            auth: true,
                            description: 'Execute script',
                            body: '{"code":"log 1"} or Content-Type: text/plain with raw code',
                            response: '{"ok":true,"jobId":"...","status":"completed","output":"1\\n","duration":12}',
                            notes: 'Add Accept: text/event-stream for SSE streaming. Add webhook/webhook_secret for fire-and-forget callback.',
                        },
                        'POST /v1/execute/file': {
                            auth: true,
                            description: 'Execute script file',
                            body: '{"file":"./script.rp"}',
                            response: 'Same as /v1/execute',
                        },
                        'POST /v1/check': {
                            auth: true,
                            description: 'Syntax check without executing',
                            body: '{"script":"log 1"}',
                            response: '{"ok":true,"message":"No syntax errors"}',
                        },
                        'POST /v1/fmt': {
                            auth: true,
                            description: 'Format code',
                            body: '{"script":"set $x as 1"}',
                            response: '{"ok":true,"formatted":"$x = 1\\n"}',
                        },
                        'GET /v1/jobs': {
                            auth: true,
                            description: 'List jobs',
                            query: '?status=running&limit=10',
                            response: '{"ok":true,"jobs":[...]}',
                        },
                        'GET /v1/jobs/:id': {
                            auth: true,
                            description: 'Get job details',
                            response: 'Single job object with output',
                        },
                        'GET /v1/jobs/:id/stream': {
                            auth: true,
                            description: 'SSE stream for job progress',
                            notes: 'Returns event: started, output, completed, job.failed, done',
                        },
                        'POST /v1/jobs/:id/cancel': {
                            auth: true,
                            description: 'Cancel running job',
                            response: '{"ok":true,"jobId":"...","status":"cancelled"}',
                        },
                        'GET /v1/modules': { auth: true, description: 'List all loaded modules and functions' },
                        'GET /v1/info': {
                            auth: true,
                            description: 'Server runtime info (uptime, memory, config, job counts)',
                        },
                        'GET /v1/metrics': { auth: true, description: 'Prometheus-style metrics (text/plain)' },
                        'GET /v1/openapi.json': { auth: true, description: 'OpenAPI 3.1 specification' },
                        'POST /v1/stop': {
                            auth: true,
                            description: 'Graceful shutdown (waits for active jobs)',
                            response: '{"ok":true,"message":"Server stopping","active_jobs":[]}',
                        },
                    },
                    optional_headers: {
                        'x-request-id': 'Client request ID (auto-generated UUID if missing)',
                        'x-idempotency-key': 'Prevent duplicate execution on retry (5-min TTL)',
                        'Accept: text/event-stream': 'Request SSE streaming on /v1/execute and /v1/jobs/:id/stream',
                        'Content-Type: text/plain': 'Send raw code in body without JSON wrapping',
                    },
                    response_headers: {
                        'x-processing-ms': 'Processing time in milliseconds',
                        'x-request-id': 'Echo of request ID',
                        'x-rate-limit-limit': 'Rate limit quota',
                        'x-rate-limit-remaining': 'Requests remaining',
                        'x-rate-limit-reset': 'When limit resets',
                    },
                    sse_events: ['started', 'output', 'completed', 'job.failed', 'job.cancelled', 'done'],
                    webhook: {
                        description:
                            'Add webhook URL to /v1/execute for fire-and-forget execution. Returns 202 immediately.',
                        body_fields: 'webhook (URL), webhook_secret (for HMAC-SHA256 signature)',
                        signature_header: 'X-Webhook-Signature: sha256=<hmac-hex>',
                    },
                    features: [
                        'Session gatekeeper',
                        'API versioning (/v1/)',
                        'SSE streaming',
                        'Webhook callbacks with HMAC-SHA256',
                        'Idempotency keys',
                        'Rate limiting',
                        'Job queue with cancel',
                        'Structured JSON logging',
                        'Prometheus metrics',
                        'OpenAPI spec',
                        'Graceful shutdown',
                        'Persistent runtime state',
                        'Plain text body support',
                        'PID file management',
                    ],
                },
                sdk: {
                    description:
                        'For JavaScript/TypeScript apps (React, Next.js, Vue, Angular, Express, Node.js). Direct in-process execution, no HTTP server needed.',
                    install: 'npm install @robinpath/sdk',
                    usage: [
                        'import { createRuntime } from "@robinpath/sdk";',
                        'const rp = createRuntime();',
                        'const result = await rp.run("log math.add 1 2");',
                        '// result: { ok, output, value, logs, variables, error, stats }',
                    ].join('\n'),
                    options: {
                        timeout: 'Max execution time in ms (0 = no limit)',
                        permissions:
                            '"all" | "none" | { fs, net, child, env, crypto } — restrict what scripts can access',
                        modules: 'Whitelist of allowed module names (undefined = all)',
                        customBuiltins: 'Record<string, handler> — add custom functions',
                        customModules: '[{ name, functions }] — add custom modules',
                    },
                    context: 'await rp.run("log $name", { name: "Robin" }) — pass variables into scripts',
                    streaming: 'rp.stream(code).on("log", handler).on("done", handler)',
                    state: 'Variables persist across run() calls on the same runtime instance',
                    engine_access: 'rp.engine — access underlying RobinPath instance for advanced use',
                },
                integration: {
                    description:
                        'For non-JS languages (Rust, Python, Go, PHP, Ruby, C#, Java), use robinpath start HTTP server.',
                    pattern: [
                        '1. Spawn: robinpath start -p <port> [-s <secret>]',
                        '2. Parse startup JSON from stdout to get session token',
                        '3. Send HTTP requests with x-robinpath-session header',
                        '4. Stop: POST /v1/stop or send SIGTERM',
                    ],
                    rust_example:
                        'let child = Command::new("robinpath").args(["start","-p","6372"]).stdout(Stdio::piped()).spawn()?;\n// Read first line for session, then use reqwest to POST /v1/execute',
                    python_example:
                        'proc = subprocess.Popen(["robinpath","start","-p","6372"], stdout=subprocess.PIPE)\nstartup = json.loads(proc.stdout.readline())\nsession = startup["session"]\nrequests.post(f"http://127.0.0.1:6372/v1/execute", headers={"x-robinpath-session": session}, json={"code": "log 1"})',
                    js_note: 'For JavaScript apps, prefer @robinpath/sdk (direct, no server needed) over HTTP.',
                },
                language_syntax: {
                    variables: 'set $x = 1  OR  $x = 1',
                    log: 'log "hello"  OR  log $x',
                    module_call: 'set $r = math.add 1 2  OR  math.add 1 2',
                    string_concat: 'set $s = "hello " + $name',
                    if_block: 'if $x > 5\n  log "big"\nendif',
                    for_loop: 'for $i in array.create 1 2 3\n  log $i\nendfor',
                    function_def: 'def greet $name\n  log "Hello " + $name\nenddef',
                    events: 'on "myEvent" $data\n  log $data\nendon',
                    comments: '# This is a comment',
                    file_extensions: '.rp, .robin (both recognized)',
                },
                file_structure: {
                    '~/.robinpath/': 'Home directory',
                    '~/.robinpath/bin/': 'Binary installation',
                    '~/.robinpath/modules/': 'Installed modules',
                    '~/.robinpath/modules/modules.json': 'Module manifest',
                    '~/.robinpath/cache/': 'Download cache',
                    '~/.robinpath/auth.json': 'Auth credentials',
                    '~/.robinpath/history': 'REPL history',
                    '~/.robinpath/env': 'Environment secrets',
                    '~/.robinpath/server-<port>.pid': 'Server PID file',
                    'robinpath.json': 'Project config',
                    'robinpath-lock.json': 'Lock file',
                },
            },
        };
        if (jsonOutput || !isTTY) {
            console.log(JSON.stringify(info, null, 2));
        } else {
            console.log(`RobinPath v${CLI_VERSION} (lang v${ROBINPATH_VERSION})`);
            console.log('');
            console.log(`  Platform:     ${info.platform} (${info.arch})`);
            console.log(`  Node:         ${info.node_version}`);
            console.log(`  Executable:   ${info.executable}`);
            console.log('');
            console.log('Paths:');
            console.log(`  Home:         ${info.paths.home}`);
            console.log(`  Binary:       ${info.paths.bin}`);
            console.log(`  Modules:      ${info.paths.modules}`);
            console.log(`  Manifest:     ${info.paths.modules_manifest}`);
            console.log(`  Cache:        ${info.paths.cache}`);
            console.log(`  Auth:         ${info.paths.auth}`);
            console.log(`  History:      ${info.paths.history}`);
            console.log(`  Env:          ${info.paths.env}`);
            console.log(`  Docs:         ${info.paths.docs}`);
            console.log('');
            console.log(`Native Modules (${Object.keys(modulesInfo).length}): ${Object.keys(modulesInfo).join(', ')}`);
            console.log('');
            const installedNames: string[] = Object.keys(installedModulesInfo);
            if (installedNames.length > 0) {
                console.log(`Installed Modules (${installedNames.length}): ${installedNames.join(', ')}`);
            } else {
                console.log('Installed Modules: (none)');
            }
            console.log('');
            console.log(color.dim('Use --json for machine-readable output (includes full docs for AI agents)'));
        }
        return;
    }

    const parsed = parsePackageSpec(spec);
    if (!parsed || !parsed.scope) {
        console.error(color.red('Error:') + ` Invalid package name: ${spec}`);
        process.exit(2);
    }

    const { scope, name, fullName } = parsed;
    const token: string | null = getAuthToken();

    try {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        // Fetch module info and versions in parallel
        const [res, versionsRes] = await Promise.all([
            fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, { headers }),
            fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}/versions`, { headers }).catch(() => null),
        ]);

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Module not found: ${fullName}`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch info (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body = (await res.json()) as { data?: Record<string, unknown> };
        const data: Record<string, unknown> = body.data || (body as Record<string, unknown>);

        if (jsonOutput) {
            let versionsData: unknown = null;
            if (versionsRes?.ok) {
                const vBody = (await versionsRes.json()) as { data?: unknown };
                versionsData = vBody.data || vBody;
            }
            console.log(JSON.stringify({ module: data, versions: versionsData }, null, 2));
            return;
        }

        // Header
        log('');
        const badges: string[] = [];
        if (data.isOfficial) badges.push(color.cyan(' official'));
        if (data.isVerified) badges.push(color.green(' verified'));
        log(
            `  ${color.bold(fullName)} ${color.cyan('v' + ((data.latestVersion || data.version || '-') as string))}${badges.join('')}`,
        );
        if (data.description) log(`  ${data.description}`);
        log('');

        // Metadata
        if (data.author || (data.publisher as Record<string, unknown> | undefined)?.name)
            log(
                `  Author:       ${data.author || (data.publisher as Record<string, unknown> | undefined)?.name || '-'}`,
            );
        if (data.license) log(`  License:      ${data.license}`);
        if (data.category) log(`  Category:     ${data.category}`);
        const visibility: string = (data.visibility || (data.isPublic === false ? 'private' : 'public')) as string;
        log(`  Visibility:   ${visibility}`);
        log('');

        // Stats
        const dlWeekly = (data.downloadsWeekly ?? data.downloads ?? data.downloadCount) as number | undefined;
        const dlTotal = data.downloadsTotal as number | undefined;
        const stars = data.stars as number | undefined;
        if (dlWeekly !== undefined || dlTotal !== undefined || stars !== undefined) {
            const parts: string[] = [];
            if (dlTotal !== undefined) parts.push(`${formatCompactNumber(dlTotal)} total downloads`);
            if (dlWeekly !== undefined) parts.push(`${formatCompactNumber(dlWeekly)} weekly`);
            if (stars !== undefined) parts.push(`★ ${formatCompactNumber(stars)}`);
            log(`  Stats:        ${parts.join('  │  ')}`);
        }

        if (data.createdAt) log(`  Created:      ${formatTimeAgo(data.createdAt as string)}`);
        if (data.updatedAt) log(`  Updated:      ${formatTimeAgo(data.updatedAt as string)}`);

        let parsedKeywords = data.keywords as string[] | string | null;
        if (typeof parsedKeywords === 'string') {
            try {
                parsedKeywords = JSON.parse(parsedKeywords) as string[];
            } catch {
                parsedKeywords = null;
            }
        }
        if (parsedKeywords && (parsedKeywords as string[]).length)
            log(`  Keywords:     ${(parsedKeywords as string[]).join(', ')}`);
        log('');

        // Version history
        if (versionsRes?.ok) {
            const vBody = (await versionsRes.json()) as { data?: Record<string, unknown> };
            const vData: Record<string, unknown> = vBody.data || (vBody as Record<string, unknown>);
            const versions = (vData.versions || vData) as Record<string, unknown>[];
            const distTags = (vData.distTags || vData.dist_tags || []) as Array<{ tag: string; version: string }>;

            if (Array.isArray(versions) && versions.length > 0) {
                const tagMap: Record<string, string[]> = {};
                if (Array.isArray(distTags)) {
                    for (const dt of distTags) {
                        tagMap[dt.version] = tagMap[dt.version] || [];
                        tagMap[dt.version].push(dt.tag);
                    }
                }

                log(color.bold('  Versions'));
                log(color.dim('  ' + '─'.repeat(55)));
                const shown = versions.slice(0, 10);
                for (const v of shown) {
                    const tags: string[] | undefined = tagMap[v.version as string];
                    const tagStr: string = tags ? ` ${color.cyan(tags.join(', '))}` : '';
                    const size: string = v.tarballSize ? ` (${((v.tarballSize as number) / 1024).toFixed(1)}KB)` : '';
                    const deprecated: string = v.deprecated ? color.red(' DEPRECATED') : '';
                    const published: string = formatTimeAgo(v.createdAt as string);
                    log(
                        `  ${('v' + v.version).padEnd(14)}${color.dim(published.padEnd(12))}${color.dim(size)}${tagStr}${deprecated}`,
                    );
                }
                if (versions.length > 10) {
                    log(
                        color.dim(
                            `  ... and ${versions.length - 10} more version${versions.length - 10 !== 1 ? 's' : ''}`,
                        ),
                    );
                }
                log('');
            }
        }

        // Install status
        const manifest = readModulesManifest();
        if (manifest[fullName]) {
            log(`  ${color.green('Installed')} v${manifest[fullName].version}`);
        } else {
            log(`  ${color.cyan('robinpath add ' + fullName)}`);
        }
        log('');
    } catch (err: unknown) {
        console.error(color.red('Error:') + ` Failed to fetch info: ${(err as Error).message}`);
        process.exit(1);
    }
}
