// ============================================================================
// Cloud commands — login, logout, whoami, publish, sync
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir, hostname } from 'node:os';

import { color, log, logVerbose, CLI_VERSION, getRobinPathHome, getInstallDir } from './utils';
import {
    requireAuth,
    platformFetch,
    readAuth,
    writeAuth,
    removeAuth,
    getAuthToken,
    openBrowser,
    decodeJWTPayload,
    readModulesManifest,
    getModulePath,
    toTarPath,
    MODULES_DIR,
} from './commands-core';

const CLOUD_URL: string = process.env.ROBINPATH_CLOUD_URL || 'https://dev.robinpath.com';
const PLATFORM_URL: string = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';

// ── Auth data shape (mirrors commands-core writeAuth / readAuth) ────────────
interface AuthData {
    token: string;
    email: string;
    name: string;
    expiresAt: number;
}

// ── JWT claims (minimal) ────────────────────────────────────────────────────
interface JWTClaims {
    exp?: number;
    [key: string]: unknown;
}

// ── Package.json shape (minimal) ────────────────────────────────────────────
interface PackageJson {
    name?: string;
    version?: string;
    description?: string;
    keywords?: string[];
    license?: string;
    [key: string]: unknown;
}

// ============================================================================
// handleLogin
// ============================================================================

/**
 * robinpath login — Sign in via browser OAuth
 */
export async function handleLogin(): Promise<void> {
    // Check if already logged in
    const existing: AuthData | null = readAuth();
    if (existing && existing.expiresAt && Date.now() < existing.expiresAt * 1000) {
        log(`Already logged in as ${color.cyan(existing.email)}`);
        log(`Token expires ${new Date(existing.expiresAt * 1000).toLocaleDateString()}`);
        log(`Run ${color.cyan('robinpath logout')} to sign out first.`);
        return;
    }

    return new Promise<void>((resolveLogin) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url!, `http://localhost`);
            if (url.pathname !== '/callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const token: string | null = url.searchParams.get('token');
            const email: string | null = url.searchParams.get('email');
            const name: string | null = url.searchParams.get('name');

            if (!token) {
                res.writeHead(400);
                res.end('Missing token');
                return;
            }

            // Decode JWT to get expiry
            const claims: JWTClaims | null = decodeJWTPayload(token);
            const expiresAt: number = claims?.exp || (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

            // Save auth
            writeAuth({ token, email: email || '', name: name || '', expiresAt });

            // Respond with success page
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head><title>RobinPath CLI</title></head>
<body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center">
<h1 style="font-size:24px;color:#22c55e">Signed in!</h1>
<p style="color:#888">You can close this tab and return to your terminal.</p>
</div>
</body>
</html>`);

            // Close server and resolve
            server.close();
            clearTimeout(timeout);
            log(color.green('Logged in') + ` as ${color.cyan(email || 'unknown')}`);
            resolveLogin();
        });

        server.listen(0, '127.0.0.1', () => {
            const port: number = (server.address() as { port: number }).port;
            const callbackUrl: string = `http://localhost:${port}/callback`;

            // Generate a verification code the user can match in the browser
            const code: string = 'ROBIN-' + Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
            const deviceName: string = hostname();
            const deviceOS: string = process.platform;

            const loginUrl: string = `${CLOUD_URL}/api/auth/cli?callback=${encodeURIComponent(callbackUrl)}&code=${encodeURIComponent(code)}&device=${encodeURIComponent(deviceName)}&os=${encodeURIComponent(deviceOS)}`;

            log('Opening browser to sign in...');
            log('');
            log(`  Verification code: ${color.cyan(code)}`);
            log(`  Device: ${color.dim(deviceName)} (${color.dim(deviceOS)})`);
            log('');
            log(color.dim('Confirm this code matches in your browser.'));
            log('');
            log(color.dim(`If the browser doesn't open, visit:`));
            log(color.cyan(loginUrl));
            log('');

            openBrowser(loginUrl);
        });

        // Timeout after 5 minutes
        const timeout: NodeJS.Timeout = setTimeout(() => {
            server.close();
            console.error(color.red('Error:') + ' Login timed out (5 minutes). Please try again.');
            process.exit(1);
        }, 5 * 60 * 1000);
    });
}

// ============================================================================
// handleLogout
// ============================================================================

/**
 * robinpath logout — Remove stored credentials
 */
export function handleLogout(): void {
    const auth: AuthData | null = readAuth();
    if (auth) {
        removeAuth();
        log('Logged out.');
    } else {
        log('Not logged in.');
    }
}

// ============================================================================
// handleWhoami
// ============================================================================

/**
 * robinpath whoami — Show current user and account info
 */
export async function handleWhoami(): Promise<void> {
    const auth: AuthData | null = readAuth();
    if (!auth) {
        log('Not logged in. Run ' + color.cyan('robinpath login') + ' to sign in.');
        return;
    }

    // Check if token is expired
    if (auth.expiresAt && Date.now() >= auth.expiresAt * 1000) {
        log(color.yellow('Token expired.') + ' Run ' + color.cyan('robinpath login') + ' to refresh.');
        return;
    }

    log(color.bold('Local credentials:'));
    log(`  Email:   ${auth.email || color.dim('(none)')}`);
    log(`  Name:    ${auth.name || color.dim('(none)')}`);

    if (auth.expiresAt) {
        const msLeft: number = auth.expiresAt * 1000 - Date.now();
        const daysLeft: number = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        const hoursLeft: number = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const expiryDate: string = new Date(auth.expiresAt * 1000).toLocaleDateString();
        const remaining: string = daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h remaining` : `${hoursLeft}h remaining`;
        log(`  Expires: ${expiryDate} (${remaining})`);
    } else {
        log(`  Expires: ${color.dim('(unknown)')}`);
    }

    // Try fetching server profile
    try {
        const res: Response = await platformFetch('/v1/me');
        if (res.ok) {
            const body: Record<string, any> = await res.json();
            const user: Record<string, any> = body.data || body;
            log('');
            log(color.bold('Server profile:'));
            if (user.username) log(`  Username: ${user.username}`);
            if (user.tier) log(`  Tier:     ${user.tier}`);
            if (user.role) log(`  Role:     ${user.role}`);
        } else if (res.status === 401) {
            log('');
            log(color.yellow('Token rejected by server.') + ' Run ' + color.cyan('robinpath login') + ' to refresh.');
        }
    } catch (err: any) {
        log('');
        log(color.dim(`Could not reach server: ${err.message}`));
    }
}

// ============================================================================
// handlePublish
// ============================================================================

/**
 * robinpath publish [dir] — Publish a module to the registry
 */
export async function handlePublish(args: string[]): Promise<void> {
    const token: string = requireAuth();
    const isDryRun: boolean = args.includes('--dry-run');
    const targetArg: string = args.find((a: string) => !a.startsWith('-') && !a.startsWith('--org')) || '.';
    const targetDir: string = resolve(targetArg);

    // Read package.json
    const pkgPath: string = join(targetDir, 'package.json');
    if (!existsSync(pkgPath)) {
        console.error(color.red('Error:') + ` No package.json found in ${targetDir}`);
        process.exit(2);
    }

    let pkg: PackageJson;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Invalid package.json: ${err.message}`);
        process.exit(2);
    }

    if (!pkg.name) {
        console.error(color.red('Error:') + ' package.json is missing "name" field');
        process.exit(2);
    }
    if (!pkg.version) {
        console.error(color.red('Error:') + ' package.json is missing "version" field');
        process.exit(2);
    }

    // Auto version bump
    if (args.includes('--patch') || args.includes('--minor') || args.includes('--major')) {
        const [major, minor, patch] = pkg.version!.split('.').map(Number);
        if (args.includes('--major')) pkg.version = `${major + 1}.0.0`;
        else if (args.includes('--minor')) pkg.version = `${major}.${minor + 1}.0`;
        else pkg.version = `${major}.${minor}.${patch + 1}`;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        log(`Bumped version to ${color.cyan(pkg.version)}`);
    }

    // Determine visibility
    let visibility: string = 'public';
    if (args.includes('--private')) {
        visibility = 'private';
    } else if (args.includes('--public')) {
        visibility = 'public';
    } else {
        const orgIdx: number = args.indexOf('--org');
        if (orgIdx !== -1 && args[orgIdx + 1]) {
            visibility = `org:${args[orgIdx + 1]}`;
        }
    }

    // Parse scope and name
    let scope: string;
    let name: string;
    if (pkg.name!.startsWith('@') && pkg.name!.includes('/')) {
        const parts: string[] = pkg.name!.slice(1).split('/');
        scope = parts[0];
        name = parts.slice(1).join('/');
    } else {
        // Use user's email prefix as scope fallback
        const auth: AuthData | null = readAuth();
        const emailPrefix: string = auth?.email?.split('@')[0] || 'unknown';
        scope = emailPrefix;
        name = pkg.name!;
    }

    // Create tarball
    const tmpFile: string = join(tmpdir(), `robinpath-publish-${Date.now()}.tar.gz`);
    const parentDir: string = dirname(targetDir);
    const dirName: string = basename(targetDir);

    log(`Packing @${scope}/${name}@${pkg.version} (${visibility})...`);

    try {
        execSync(
            `tar czf "${toTarPath(tmpFile)}" --exclude=node_modules --exclude=.git --exclude="*.tar.gz" -C "${toTarPath(parentDir)}" "${dirName}"`,
            { stdio: 'pipe' }
        );
    } catch (err: any) {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        console.error(color.red('Error:') + ` Failed to create tarball: ${err.message}`);
        process.exit(1);
    }

    // Read tarball and check size
    const tarball: Buffer = readFileSync(tmpFile);
    const maxSize: number = 50 * 1024 * 1024; // 50MB
    if (tarball.length > maxSize) {
        unlinkSync(tmpFile);
        console.error(color.red('Error:') + ` Package is too large (${(tarball.length / 1024 / 1024).toFixed(1)}MB). Max size is 5MB.`);
        process.exit(1);
    }

    log(color.dim(`Package size: ${(tarball.length / 1024).toFixed(1)}KB`));

    // Dry run — stop here
    if (isDryRun) {
        unlinkSync(tmpFile);
        log('');
        log(color.yellow('Dry run') + ` — would publish @${scope}/${name}@${pkg.version} as ${visibility}`);
        return;
    }

    // Upload
    try {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/gzip',
            'X-Package-Version': pkg.version!,
            'X-Package-Visibility': visibility,
        };
        if (pkg.description) headers['X-Package-Description'] = pkg.description;
        if (pkg.keywords?.length) headers['X-Package-Keywords'] = pkg.keywords.join(',');
        if (pkg.license) headers['X-Package-License'] = pkg.license;

        const res: Response = await fetch(`${PLATFORM_URL}/v1/registry/${scope}/${name}`, {
            method: 'PUT',
            headers,
            body: tarball,
        });

        if (res.ok) {
            log(color.green('Published') + ` @${scope}/${name}@${pkg.version} (${visibility})`);
        } else {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            const msg: string = body?.error?.message || `HTTP ${res.status}`;
            console.error(color.red('Error:') + ` Failed to publish: ${msg}`);
            process.exit(1);
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to publish: ${err.message}`);
        process.exit(1);
    } finally {
        // Clean up temp file
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

// ============================================================================
// handleSync
// ============================================================================

/**
 * robinpath sync — List your published modules
 */
export async function handleSync(): Promise<void> {
    requireAuth();

    // Get username from /v1/me
    let username: string;
    try {
        const meRes: Response = await platformFetch('/v1/me');
        if (!meRes.ok) {
            console.error(color.red('Error:') + ' Could not fetch account info.');
            process.exit(1);
        }
        const meBody: Record<string, any> = await meRes.json();
        const user: Record<string, any> = meBody.data || meBody;
        username = user.username || user.email?.split('@')[0] || 'unknown';
    } catch (err: any) {
        console.error(color.red('Error:') + ` Could not reach server: ${err.message}`);
        process.exit(1);
    }

    log(`Fetching modules for ${color.cyan(username!)}...`);
    log('');

    try {
        const res: Response = await platformFetch(`/v1/registry/search?q=${encodeURIComponent('@' + username! + '/')}`);
        if (!res.ok) {
            console.error(color.red('Error:') + ` Failed to search registry (HTTP ${res.status}).`);
            process.exit(1);
        }

        const body: Record<string, any> = await res.json();
        const modules: any[] = body.data || body.modules || [];

        if (modules.length === 0) {
            log('No published modules found.');
            log(`Run ${color.cyan('robinpath publish')} to publish your first module.`);
            return;
        }

        // Print table header
        log(color.bold('  Name'.padEnd(40) + 'Version'.padEnd(12) + 'Downloads'.padEnd(12) + 'Visibility'));
        log(color.dim('  ' + '\u2500'.repeat(72)));

        for (const mod of modules) {
            const name: string = (mod.scope ? `@${mod.scope}/${mod.name}` : mod.name) || mod.id || '?';
            const version: string = mod.version || mod.latestVersion || '-';
            const downloads: string = String(mod.downloads ?? mod.downloadCount ?? '-');
            const visibility: string = mod.visibility || (mod.isPublic === false ? 'private' : 'public');
            log(`  ${name.padEnd(38)}${version.padEnd(12)}${downloads.padEnd(12)}${visibility}`);
        }

        log('');
        log(color.dim(`${modules.length} module${modules.length !== 1 ? 's' : ''}`));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to list modules: ${err.message}`);
        process.exit(1);
    }
}
