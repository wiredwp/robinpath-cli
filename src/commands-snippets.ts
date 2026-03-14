/**
 * RobinPath CLI — Snippet commands
 * Extracted from cli-entry.js and converted to TypeScript.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline';

import { color, log, logVerbose, CLI_VERSION, getRobinPathHome } from './utils';

import {
    requireAuth,
    platformFetch,
    createRobinPath,
    resolveScriptPath,
    runScript,
    getAuthToken,
} from './commands-core';

import { readStdin } from './server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_URL: string = process.env.ROBINPATH_PLATFORM_URL || 'https://api.robinpath.com';

const SNIPPET_CATEGORIES: string[] = [
    'forms',
    'notifications',
    'crm',
    'e-commerce',
    'data-processing',
    'auth',
    'ai',
    'webhooks',
    'utilities',
    'other',
];
const SNIPPET_SORTS: string[] = ['popular', 'stars', 'newest', 'updated'];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SnippetFlags {
    json: boolean;
    force: boolean;
    codeOnly: boolean;
    page?: string;
    limit?: string;
    name?: string;
    description?: string;
    visibility?: string;
    category?: string;
    tags?: string;
    status?: string;
    license?: string;
    version?: string;
    sort?: string;
    code?: string;
    changelog?: string;
    format?: string;
    readme?: string;
    positional: string[];
}

export interface SnippetData {
    id?: string;
    name?: string;
    description?: string;
    code?: string;
    language?: string;
    visibility?: string;
    status?: string;
    category?: string;
    tags?: string | string[];
    version?: string;
    license?: string;
    readme?: string;
    starCount?: number;
    viewCount?: number;
    forkCount?: number;
    isStarred?: boolean;
    isOwner?: boolean;
    author?: { name?: string; username?: string };
    forkedFrom?: string;
    featured?: boolean;
    verified?: boolean;
    createdAt?: string;
    updatedAt?: string;
    _cachedAt?: number;
}

interface Pagination {
    page: number;
    pages: number;
    total: number;
}

interface SnippetListResponse {
    data?: SnippetData[];
    pagination?: Pagination;
}

interface SnippetCreateResponse {
    id?: string;
    data?: { id?: string };
}

interface SnippetGetResponse {
    data?: SnippetData;
    [key: string]: unknown;
}

interface ImportResult {
    name: string;
    status: string;
    id?: string;
    reason?: string;
    httpStatus?: number;
    error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCompactNumber(n: number | null | undefined): string {
    if (n == null) return '-';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function formatTimeAgo(dateStr: string | null | undefined): string {
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
// parseSnippetFlags
// ---------------------------------------------------------------------------

function parseSnippetFlags(args: string[]): SnippetFlags {
    const flags: SnippetFlags = {
        json: args.includes('--json'),
        force: args.includes('--force'),
        codeOnly: args.includes('--code-only') || args.includes('--code'),
        positional: [],
    };
    for (const a of args) {
        if (a.startsWith('--page=')) flags.page = a.split('=')[1];
        if (a.startsWith('--limit=')) flags.limit = a.split('=')[1];
        if (a.startsWith('--name=')) flags.name = a.split('=')[1];
        if (a.startsWith('--description=')) flags.description = a.split('=')[1];
        if (a.startsWith('--visibility=')) flags.visibility = a.split('=')[1];
        if (a.startsWith('--category=')) flags.category = a.split('=')[1];
        if (a.startsWith('--tags=')) flags.tags = a.split('=')[1];
        if (a.startsWith('--status=')) flags.status = a.split('=')[1];
        if (a.startsWith('--license=')) flags.license = a.split('=')[1];
        if (a.startsWith('--version=')) flags.version = a.split('=')[1];
        if (a.startsWith('--sort=')) flags.sort = a.split('=')[1];
        if (a.startsWith('--code=')) flags.code = a.split('=')[1];
        if (a.startsWith('--changelog=')) flags.changelog = a.split('=')[1];
        if (a.startsWith('--format=')) flags.format = a.split('=')[1];
        if (a.startsWith('--readme=')) flags.readme = a.split('=')[1];
    }
    flags.positional = args.filter((a) => a === '-' || !a.startsWith('-'));
    return flags;
}

// ---------------------------------------------------------------------------
// fetchSnippet
// ---------------------------------------------------------------------------

/**
 * Fetch a snippet — tries authenticated endpoint first (own + public),
 * falls back to public endpoint if not logged in.
 */
async function fetchSnippet(id: string): Promise<Response> {
    const token: string | null = getAuthToken();
    if (token) {
        const res: Response = await fetch(`${PLATFORM_URL}/v1/snippets/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) return res;
    }
    // Fallback: try public endpoint (no auth)
    return fetch(`${PLATFORM_URL}/public/snippets/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// resolveSnippetId
// ---------------------------------------------------------------------------

/**
 * Resolve a partial snippet ID to a full ID.
 * If the input is already a full ULID (26 chars), returns it as-is.
 * Otherwise, fetches the user's snippets and matches by prefix.
 * Falls back to the input if no auth or no match (let the API return 404).
 */
async function resolveSnippetId(partialId: string): Promise<string> {
    if (!partialId) return partialId;
    // Full ULID — skip resolution
    if (partialId.length >= 26) return partialId;

    const token: string | null = getAuthToken();
    if (!token) return partialId; // Can't resolve without auth

    try {
        // Fetch user's snippets to match prefix
        const res: Response = await fetch(`${PLATFORM_URL}/v1/snippets?limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return partialId;

        const body: SnippetListResponse = (await res.json()) as SnippetListResponse;
        const snippets: SnippetData[] = body.data || [];
        const upper: string = partialId.toUpperCase();
        const matches: SnippetData[] = snippets.filter((s) => s.id && s.id.toUpperCase().startsWith(upper));

        if (matches.length === 1) return matches[0].id!;
        if (matches.length > 1) {
            console.error(
                color.yellow('Warning:') + ` Ambiguous ID '${partialId}' matches ${matches.length} snippets:`,
            );
            for (const m of matches.slice(0, 5)) {
                console.error(`  ${color.cyan(m.id!)}  ${m.name || 'untitled'}`);
            }
            console.error('Please use a longer prefix.');
            process.exit(2);
        }
        // No match in own snippets — return as-is, let the API try (might be a public snippet)
        return partialId;
    } catch {
        return partialId;
    }
}

// ---------------------------------------------------------------------------
// handleSnippet — main router
// ---------------------------------------------------------------------------

export async function handleSnippet(args: string[]): Promise<void> {
    const sub: string | undefined = args[0];
    const subArgs: string[] = args.slice(1);

    if (!sub || sub === 'list') return snippetList(subArgs);
    if (sub === 'create' || sub === 'new') return snippetCreate(subArgs);
    if (sub === 'init') return snippetInit(subArgs);
    if (sub === 'get' || sub === 'view' || sub === 'show') return snippetGet(subArgs);
    if (sub === 'update' || sub === 'edit') return snippetUpdate(subArgs);
    if (sub === 'delete' || sub === 'rm') return snippetDelete(subArgs);
    if (sub === 'explore' || sub === 'browse') return snippetExplore(subArgs);
    if (sub === 'search') return snippetExplore(subArgs);
    if (sub === 'star') return snippetStar(subArgs);
    if (sub === 'unstar') return snippetUnstar(subArgs);
    if (sub === 'fork') return snippetFork(subArgs);
    if (sub === 'publish') return snippetPublish(subArgs);
    if (sub === 'unpublish') return snippetUnpublish(subArgs);
    if (sub === 'copy' || sub === 'cp') return snippetCopy(subArgs);
    if (sub === 'run' || sub === 'exec') return snippetRun(subArgs);
    if (sub === 'pull' || sub === 'download') return snippetPull(subArgs);
    if (sub === 'push') return snippetPush(subArgs);
    if (sub === 'version') return snippetVersion(subArgs);
    if (sub === 'export') return snippetExport(subArgs);
    if (sub === 'import') return snippetImport(subArgs);
    if (sub === 'diff') return snippetDiff(subArgs);
    if (sub === 'trending') return snippetExplore(['--sort=popular', ...subArgs]);

    console.error(color.red('Error:') + ` Unknown snippet subcommand: ${sub}`);
    console.error(
        'Available: list, create, get, update, delete, explore, search, star, unstar, fork, publish, unpublish, copy, run, pull, push, version, diff, export, import, trending',
    );
    process.exit(2);
}

// ---------------------------------------------------------------------------
// snippetList
// ---------------------------------------------------------------------------

async function snippetList(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const query: string = flags.positional.join(' ');

    const params: URLSearchParams = new URLSearchParams();
    if (flags.page) params.set('page', flags.page);
    if (flags.limit) params.set('limit', flags.limit);
    if (flags.visibility) params.set('visibility', flags.visibility);
    if (flags.status) params.set('status', flags.status);
    if (flags.category) params.set('category', flags.category);
    if (query) params.set('q', query);

    try {
        const res: Response = await platformFetch(`/v1/snippets?${params}`);
        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to list snippets (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        const body: SnippetListResponse = (await res.json()) as SnippetListResponse;
        const snippets: SnippetData[] = body.data || [];
        const pagination: Pagination | null = body.pagination || null;

        if (flags.json) {
            console.log(JSON.stringify({ snippets, pagination }, null, 2));
            return;
        }

        // Active filters summary
        const filters: string[] = [];
        if (flags.visibility) filters.push(`visibility=${flags.visibility}`);
        if (flags.status) filters.push(`status=${flags.status}`);
        if (flags.category) filters.push(`category=${flags.category}`);
        if (query) filters.push(`search="${query}"`);
        if (filters.length) log(color.dim('  Filters: ' + filters.join(', ')) + '\n');

        if (snippets.length === 0) {
            log('No snippets found.');
            if (filters.length) {
                log(`Try removing some filters, or run ${color.cyan('robinpath snippet list')} to see all.`);
            } else {
                log(`Run ${color.cyan('robinpath snippet create <file>')} to create your first snippet.`);
            }
            return;
        }

        for (const s of snippets) {
            const vis: string = s.visibility === 'public' ? color.green('\u25CF public') : color.dim('\u25CB private');
            const status: string = s.status || 'draft';
            const updated: string = formatTimeAgo(s.updatedAt);
            const cat: string = s.category ? color.dim(` [${s.category}]`) : '';

            log(color.bold('  ' + (s.name || 'Untitled')) + cat);
            log(
                `    ${vis}  ${color.dim('|')}  ${status}  ${color.dim('|')}  ${color.dim(updated)}  ${color.dim('|')}  \u2605 ${formatCompactNumber(s.starCount)}`,
            );
            if (s.description) log(`    ${color.dim(s.description.slice(0, 80))}`);
            log(`    ${color.dim('ID:')} ${color.cyan(s.id!)}`);
            log('');
        }

        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`));
        }

        log('');
        log(color.dim('  Filter: --visibility=public|private  --status=draft|published|archived  --category=<cat>'));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to list snippets: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetCreate
// ---------------------------------------------------------------------------

async function snippetCreate(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const fileArg: string | undefined = flags.positional[0];

    if (!fileArg) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet create <file|-> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --name=<name>            Snippet name (defaults to filename)');
        console.error('    --description=<desc>     Description');
        console.error('    --visibility=<v>         public or private (default: private)');
        console.error('    --category=<cat>         Category (' + SNIPPET_CATEGORIES.join(', ') + ')');
        console.error('    --tags=<t1,t2>           Comma-separated tags');
        console.error('    --status=<s>             draft, published, or archived (default: draft)');
        console.error('    --license=<lic>          License (MIT, Apache-2.0, etc.)');
        console.error('    --version=<ver>          Version string');
        console.error('    --readme=<file>          Readme file path');
        console.error('    --json                   Machine-readable JSON output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet create app.rp');
        console.error('    robinpath snippet create app.rp --name="My Tool" --visibility=public');
        console.error('    robinpath snippet create - < script.rp --name="Piped"');
        process.exit(2);
    }

    let code: string;
    let defaultName: string;

    if (fileArg === '-') {
        code = await readStdin();
        defaultName = 'untitled';
    } else {
        const filePath: string = resolve(fileArg);
        if (!existsSync(filePath)) {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
            process.exit(1);
        }
        code = readFileSync(filePath, 'utf-8');
        defaultName = basename(filePath, extname(filePath));
    }

    if (!code || !code.trim()) {
        console.error(color.red('Error:') + ' Code cannot be empty.');
        process.exit(1);
    }

    const payload: Record<string, any> = {
        name: flags.name || defaultName,
        code,
        language: 'robinpath',
    };
    if (flags.description) payload.description = flags.description;
    if (flags.visibility) payload.visibility = flags.visibility;
    if (flags.category) payload.category = flags.category;
    if (flags.tags)
        payload.tags = flags.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    if (flags.status) payload.status = flags.status;
    if (flags.license) payload.license = flags.license;
    if (flags.version) payload.version = flags.version;
    if (flags.readme) {
        const readmePath: string = resolve(flags.readme);
        if (existsSync(readmePath)) {
            payload.readme = readFileSync(readmePath, 'utf-8');
        }
    }

    try {
        const res: Response = await platformFetch('/v1/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to create snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        const body: SnippetCreateResponse = (await res.json()) as SnippetCreateResponse;
        const id: string | undefined = body.id || body.data?.id;

        if (flags.json) {
            console.log(
                JSON.stringify({ id, name: payload.name, visibility: payload.visibility || 'private' }, null, 2),
            );
            return;
        }

        log(color.green('\u2713') + ' Snippet created: ' + color.cyan(id!));
        log('  Name: ' + payload.name);
        log('  Visibility: ' + (payload.visibility || 'private'));
        log('');
        log('  View:    ' + color.cyan(`robinpath snippet get ${id}`));
        log('  Run:     ' + color.cyan(`robinpath snippet run ${id}`));
        if (payload.visibility !== 'public') {
            log('  Publish: ' + color.cyan(`robinpath snippet publish ${id}`));
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to create snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetInit (interactive wizard)
// ---------------------------------------------------------------------------

async function snippetInit(args: string[]): Promise<void> {
    requireAuth();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def: string): Promise<string> =>
        new Promise((resolve) => {
            const suffix: string = def ? color.dim(` (${def})`) : '';
            rl.question(`  ${q}${suffix}: `, (answer) => resolve(answer.trim() || def || ''));
        });

    log(color.bold('Create a new snippet') + '\n');

    const name: string = await ask('Name', '');
    if (!name) {
        console.error(color.red('Error:') + ' Name is required.');
        rl.close();
        process.exit(2);
    }

    const description: string = await ask('Description', '');

    log('');
    log(color.dim('  Visibility: 1) private  2) public'));
    const visChoice: string = await ask('Choose', '1');
    const visibility: string = visChoice === '2' ? 'public' : 'private';

    log('');
    log(color.dim('  Categories: ' + SNIPPET_CATEGORIES.join(', ')));
    const category: string = await ask('Category', '');

    const tagsRaw: string = await ask('Tags (comma-separated)', '');
    const tags: string[] = tagsRaw
        ? tagsRaw
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
        : [];

    log('');
    log(color.dim('  Status: 1) published  2) draft'));
    const statusChoice: string = await ask('Choose', '1');
    const status: string = statusChoice === '2' ? 'draft' : 'published';

    const license: string = await ask('License', 'MIT');
    const version: string = await ask('Version', '1.0.0');

    log('');
    log(color.dim('  Code source: 1) file  2) type inline'));
    const codeChoice: string = await ask('Choose', '1');

    let code: string = '';
    if (codeChoice === '2') {
        log(color.dim('  Type your code (end with an empty line):'));
        const codeLines: string[] = [];
        while (true) {
            const line: string = await ask('', '');
            if (!line && codeLines.length > 0) break;
            if (line) codeLines.push(line);
        }
        code = codeLines.join('\n');
    } else {
        const filePath: string = await ask('File path', '');
        if (!filePath || !existsSync(resolve(filePath))) {
            console.error(color.red('Error:') + ' File not found.');
            rl.close();
            process.exit(1);
        }
        code = readFileSync(resolve(filePath), 'utf-8');
    }

    rl.close();

    if (!code.trim()) {
        console.error(color.red('Error:') + ' Code cannot be empty.');
        process.exit(1);
    }

    log('');
    log(color.dim('Creating snippet...'));

    const payload: Record<string, any> = { name, code, language: 'robinpath', visibility, status, license, version };
    if (description) payload.description = description;
    if (category) payload.category = category;
    if (tags.length) payload.tags = tags;

    try {
        const res: Response = await platformFetch('/v1/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(color.red('Error:') + ` Failed to create snippet: ${body.error?.message || res.statusText}`);
            process.exit(1);
        }

        const body: SnippetCreateResponse = (await res.json()) as SnippetCreateResponse;
        const id: string | undefined = body.id || body.data?.id;

        log('');
        log(color.green('\u2713') + ' Snippet created: ' + color.cyan(id!));
        log('  Name:       ' + name);
        log('  Visibility: ' + (visibility === 'public' ? color.green(visibility) : color.dim(visibility)));
        log('  Status:     ' + status);
        log('');
        log('  View: ' + color.cyan(`robinpath snippet get ${id}`));
        log('  Run:  ' + color.cyan(`robinpath snippet run ${id}`));
        if (visibility === 'public') {
            log('  CDN:  ' + color.cyan(`https://cdn.robinpath.com/s/${id}`));
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to create snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetGet
// ---------------------------------------------------------------------------

async function snippetGet(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet get <id> [--json]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(
                    color.red('Error:') +
                        ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`,
                );
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body: SnippetGetResponse = (await res.json()) as SnippetGetResponse;
        const s: SnippetData = (body.data || body) as SnippetData;

        if (flags.json) {
            console.log(JSON.stringify(s, null, 2));
            return;
        }

        // --code-only: just output raw code (pipeable)
        if (flags.codeOnly) {
            console.log(s.code || '');
            return;
        }

        // Pretty print
        log(color.bold(s.name || 'Untitled'));
        if (s.description) log(color.dim(s.description));
        log('');
        log('  ID:         ' + (s.id || id));
        log('  Visibility: ' + (s.visibility === 'public' ? color.green('public') : color.dim('private')));
        log('  Status:     ' + (s.status || 'draft'));
        log('  Language:   ' + (s.language || 'robinpath'));
        if (s.category) log('  Category:   ' + s.category);
        if (s.version) log('  Version:    ' + s.version);
        if (s.license) log('  License:    ' + s.license);
        if (s.tags) {
            const tags: string[] = typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags;
            if (tags && tags.length) log('  Tags:       ' + tags.join(', '));
        }
        if (s.starCount != null) log('  Stars:      ' + formatCompactNumber(s.starCount));
        if (s.viewCount != null) log('  Views:      ' + formatCompactNumber(s.viewCount));
        if (s.forkCount != null) log('  Forks:      ' + formatCompactNumber(s.forkCount));
        if (s.isStarred != null) log('  Starred:    ' + (s.isStarred ? color.yellow('\u2605 yes') : '\u2606 no'));
        if (s.isOwner != null) log('  Owner:      ' + (s.isOwner ? 'yes' : 'no'));
        if (s.author) log('  Author:     ' + (s.author.name || s.author.username || '-'));
        if (s.forkedFrom) log('  Forked from: ' + s.forkedFrom);
        if (s.createdAt) log('  Created:    ' + formatTimeAgo(s.createdAt));
        if (s.updatedAt) log('  Updated:    ' + formatTimeAgo(s.updatedAt));
        log('');
        log(color.bold('Code:'));
        log(color.dim('\u2500'.repeat(60)));
        log(s.code || '');
        log(color.dim('\u2500'.repeat(60)));

        // Actionable hints
        const sid: string = s.id || id;
        log('');
        log(color.dim('  Actions:'));
        log(color.dim(`    robinpath snippet run  ${sid}`) + color.dim('     Execute this snippet'));
        log(color.dim(`    robinpath snippet copy ${sid}`) + color.dim('    Copy code to clipboard'));
        log(color.dim(`    robinpath snippet pull ${sid}`) + color.dim('    Save to local file'));
        if (s.isOwner) {
            log(color.dim(`    robinpath snippet push <file> ${sid}`) + color.dim('  Update code from file'));
        } else {
            log(color.dim(`    robinpath snippet fork ${sid}`) + color.dim('    Fork to your account'));
            log(color.dim(`    robinpath snippet star ${sid}`) + color.dim('    Star this snippet'));
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to fetch snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetUpdate
// ---------------------------------------------------------------------------

async function snippetUpdate(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet update <id> [options]');
        console.error('');
        console.error('  Options:');
        console.error('    --name=<name>            Update name');
        console.error('    --description=<desc>     Update description');
        console.error('    --code=<file>            Update code from file');
        console.error('    --visibility=<v>         public or private');
        console.error('    --category=<cat>         Category');
        console.error('    --tags=<t1,t2>           Comma-separated tags');
        console.error('    --status=<s>             draft, published, or archived');
        console.error('    --license=<lic>          License');
        console.error('    --version=<ver>          Version string');
        console.error('    --changelog=<text>       Changelog text');
        console.error('    --readme=<file>          Readme from file');
        console.error('    --json                   Machine-readable output');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet update abc123 --name="New Name"');
        console.error('    robinpath snippet update abc123 --visibility=public --status=published');
        console.error('    robinpath snippet update abc123 --code=updated.rp');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const payload: Record<string, any> = {};
    if (flags.name) payload.name = flags.name;
    if (flags.description) payload.description = flags.description;
    if (flags.visibility) payload.visibility = flags.visibility;
    if (flags.category) payload.category = flags.category;
    if (flags.status) payload.status = flags.status;
    if (flags.license) payload.license = flags.license;
    if (flags.version) payload.version = flags.version;
    if (flags.changelog) payload.changelog = flags.changelog;
    if (flags.tags)
        payload.tags = flags.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    if (flags.code) {
        const codePath: string = resolve(flags.code);
        if (!existsSync(codePath)) {
            console.error(color.red('Error:') + ` Code file not found: ${flags.code}`);
            process.exit(1);
        }
        payload.code = readFileSync(codePath, 'utf-8');
    }
    if (flags.readme) {
        const readmePath: string = resolve(flags.readme);
        if (existsSync(readmePath)) {
            payload.readme = readFileSync(readmePath, 'utf-8');
        }
    }

    if (Object.keys(payload).length === 0) {
        console.error(color.red('Error:') + ' No fields to update. Provide at least one --flag.');
        process.exit(2);
    }

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to update snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ updated: true, id, fields: Object.keys(payload) }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet updated: ' + color.cyan(id));
        log('  Updated fields: ' + Object.keys(payload).join(', '));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to update snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetDelete
// ---------------------------------------------------------------------------

async function snippetDelete(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet delete <id> [--force]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    if (!flags.force) {
        console.error(color.yellow('Warning:') + ` This will permanently delete snippet '${id}'.`);
        console.error('Run again with ' + color.cyan('--force') + ' to confirm.');
        process.exit(0);
    }

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found.`);
            } else {
                const body: Record<string, any> = await res.json().catch(() => ({}));
                console.error(
                    color.red('Error:') +
                        ` Failed to delete snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
                );
            }
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ deleted: true, id }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet deleted: ' + id);
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to delete snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetExplore / search / trending
// ---------------------------------------------------------------------------

async function snippetExplore(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const query: string = flags.positional.join(' ');

    if (flags.sort && !SNIPPET_SORTS.includes(flags.sort)) {
        console.error(color.red('Error:') + ` Invalid sort: ${flags.sort}`);
        console.error('  Valid sorts: ' + SNIPPET_SORTS.join(', '));
        process.exit(2);
    }

    if (flags.category && !SNIPPET_CATEGORIES.includes(flags.category)) {
        console.error(color.red('Error:') + ` Invalid category: ${flags.category}`);
        console.error('  Valid categories: ' + SNIPPET_CATEGORIES.join(', '));
        process.exit(2);
    }

    const params: URLSearchParams = new URLSearchParams();
    if (query) params.set('q', query);
    if (flags.category) params.set('category', flags.category);
    if (flags.sort) params.set('sort', flags.sort);
    if (flags.tags) params.set('tags', flags.tags);
    if (flags.page) params.set('page', flags.page);
    if (flags.limit) params.set('limit', flags.limit);

    const searchLabel: string = query
        ? `"${query}"`
        : flags.category
          ? `category: ${flags.category}`
          : 'public snippets';
    log(`Searching ${searchLabel}...\n`);

    try {
        // Public endpoint — no auth required
        const res: Response = await fetch(`${PLATFORM_URL}/public/snippets?${params}`);
        if (!res.ok) {
            console.error(color.red('Error:') + ` Failed to search snippets (HTTP ${res.status})`);
            process.exit(1);
        }

        const body: SnippetListResponse = (await res.json()) as SnippetListResponse;
        const snippets: SnippetData[] = body.data || [];
        const pagination: Pagination | null = body.pagination || null;

        if (flags.json) {
            console.log(JSON.stringify({ snippets, pagination }, null, 2));
            return;
        }

        if (snippets.length === 0) {
            log('No public snippets found.');
            return;
        }

        for (const s of snippets) {
            const name: string = s.name || 'untitled';
            const author: string = s.author?.username || s.author?.name || '-';
            const cat: string = s.category || '-';
            const stars: string = formatCompactNumber(s.starCount);
            const views: string = formatCompactNumber(s.viewCount);
            const updated: string = formatTimeAgo(s.updatedAt);
            const badges: string[] = [];
            if (s.featured) badges.push(color.yellow('\u2605'));
            if (s.verified) badges.push(color.green('\u2713'));
            const badgeStr: string = badges.length ? ' ' + badges.join(' ') : '';

            log(color.bold('  ' + name) + badgeStr);
            log(
                `    ${color.dim('by')} ${author}  ${color.dim('|')} ${cat}  ${color.dim('|')} \u2605 ${stars}  ${color.dim('|')} ${color.dim(updated)}`,
            );
            if (s.description) log(`    ${color.dim(s.description.slice(0, 80))}`);
            // Code preview — first 2 non-empty lines
            if (s.code) {
                const previewLines: string[] = s.code
                    .split('\n')
                    .filter((l) => l.trim())
                    .slice(0, 2);
                if (previewLines.length) {
                    log(color.dim('    \u250C ') + color.dim(previewLines[0].trim().slice(0, 70)));
                    if (previewLines[1]) log(color.dim('    \u2502 ') + color.dim(previewLines[1].trim().slice(0, 70)));
                    const totalLines: number = s.code.split('\n').filter((l) => l.trim()).length;
                    if (totalLines > 2)
                        log(color.dim(`    \u2514 ... ${totalLines - 2} more line${totalLines - 2 !== 1 ? 's' : ''}`));
                    else log(color.dim('    \u2514'));
                }
            }
            log(`    ${color.dim('ID:')} ${color.cyan(s.id!)}`);
            log('');
        }

        if (pagination && pagination.pages > 1) {
            log(color.dim(`  Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)`));
            if (pagination.page < pagination.pages) {
                log(color.dim(`  Use --page=${pagination.page + 1} for next page`));
            }
        } else {
            log(color.dim(`  ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`));
        }

        log('');
        log(color.dim('  Quick actions:'));
        log(color.dim('    robinpath snippet get  <id>     View full code'));
        log(color.dim('    robinpath snippet run  <id>     Execute it'));
        log(color.dim('    robinpath snippet pull <id>     Save to local file'));
        log(color.dim('    robinpath snippet copy <id>     Copy code to clipboard'));
        log(color.dim('    robinpath snippet fork <id>     Fork to your account'));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to search snippets: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetStar
// ---------------------------------------------------------------------------

async function snippetStar(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet star <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/star`, {
            method: 'POST',
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to star snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ starred: true, id }, null, 2));
            return;
        }

        log(color.yellow('\u2605') + ' Starred snippet: ' + color.cyan(id));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to star snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetUnstar
// ---------------------------------------------------------------------------

async function snippetUnstar(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet unstar <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/star`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to unstar snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ starred: false, id }, null, 2));
            return;
        }

        log('\u2606 Unstarred snippet: ' + color.cyan(id));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to unstar snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetFork
// ---------------------------------------------------------------------------

async function snippetFork(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet fork <id> [--json]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}/fork`, {
            method: 'POST',
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to fork snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        const body: SnippetCreateResponse = (await res.json()) as SnippetCreateResponse;
        const newId: string | undefined = body.id || body.data?.id;

        if (flags.json) {
            console.log(JSON.stringify({ id: newId, forkedFrom: id }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet forked!');
        log('  New ID:      ' + color.cyan(newId!));
        log('  Forked from: ' + id);
        log('');
        log('  View: ' + color.cyan(`robinpath snippet get ${newId}`));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to fork snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetPublish
// ---------------------------------------------------------------------------

async function snippetPublish(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet publish <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', visibility: 'public' }),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to publish snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ published: true, id, visibility: 'public', status: 'published' }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet published: ' + color.cyan(id));
        log('  Visibility: ' + color.green('public'));
        log('  Status:     published');
        log('  CDN:        ' + color.cyan(`https://cdn.robinpath.com/s/${id}`));
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to publish snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetUnpublish
// ---------------------------------------------------------------------------

async function snippetUnpublish(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet unpublish <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft', visibility: 'private' }),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to unpublish snippet (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ published: false, id, visibility: 'private', status: 'draft' }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet unpublished: ' + color.cyan(id));
        log('  Visibility: ' + color.dim('private'));
        log('  Status:     draft');
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to unpublish snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetCopy
// ---------------------------------------------------------------------------

async function snippetCopy(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet copy <id>');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(
                    color.red('Error:') +
                        ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`,
                );
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body: SnippetGetResponse = (await res.json()) as SnippetGetResponse;
        const s: SnippetData = (body.data || body) as SnippetData;
        const code: string = s.code || '';

        if (!code.trim()) {
            console.error(color.red('Error:') + ' Snippet has no code to copy.');
            process.exit(1);
        }

        // Cross-platform clipboard copy
        const isWin: boolean = platform() === 'win32';
        const isMac: boolean = platform() === 'darwin';
        let clipCmd: string;
        if (isWin) clipCmd = 'clip';
        else if (isMac) clipCmd = 'pbcopy';
        else clipCmd = 'xclip -selection clipboard';

        try {
            const { execSync: exec } = await import('node:child_process');
            exec(clipCmd, { input: code, stdio: ['pipe', 'ignore', 'ignore'] });

            if (flags.json) {
                console.log(
                    JSON.stringify({ copied: true, id, name: s.name, bytes: Buffer.byteLength(code) }, null, 2),
                );
                return;
            }

            log(color.green('\u2713') + ' Code copied to clipboard!');
            log('  Snippet: ' + (s.name || id));
            log('  Size:    ' + Buffer.byteLength(code) + ' bytes');
            log('');
            log(color.dim('  Paste it anywhere, or run it:'));
            log(color.dim(`    robinpath snippet run ${s.id || id}`));
        } catch (clipErr: any) {
            // Clipboard not available — print code to stdout as fallback
            console.error(color.yellow('Warning:') + ' Could not access clipboard. Printing code to stdout:\n');
            console.log(code);
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to copy snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Snippet cache helpers
// ---------------------------------------------------------------------------

const SNIPPET_CACHE_DIR: string = join(homedir(), '.robinpath', 'cache', 'snippets');
const SNIPPET_CACHE_TTL: number = 5 * 60 * 1000; // 5 minutes

function getSnippetCachePath(id: string): string {
    return join(SNIPPET_CACHE_DIR, `${id}.json`);
}

function readSnippetCache(id: string): SnippetData | null {
    try {
        const cachePath: string = getSnippetCachePath(id);
        if (!existsSync(cachePath)) return null;
        const raw: SnippetData = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (Date.now() - (raw._cachedAt || 0) > SNIPPET_CACHE_TTL) return null; // expired
        return raw;
    } catch {
        return null;
    }
}

function writeSnippetCache(id: string, data: SnippetData): void {
    try {
        if (!existsSync(SNIPPET_CACHE_DIR)) {
            mkdirSync(SNIPPET_CACHE_DIR, { recursive: true });
        }
        writeFileSync(getSnippetCachePath(id), JSON.stringify({ ...data, _cachedAt: Date.now() }), 'utf-8');
    } catch {
        // ignore cache write failures
    }
}

// ---------------------------------------------------------------------------
// snippetRun
// ---------------------------------------------------------------------------

async function snippetRun(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const noCache: boolean = args.includes('--no-cache');
    let id: string | undefined = flags.positional[0];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet run <id> [--no-cache]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        // Try cache first
        let s: SnippetData | null = null;
        if (!noCache) {
            s = readSnippetCache(id);
            if (s) logVerbose(`Using cached snippet (${id})`);
        }

        if (!s) {
            const res: Response = await fetchSnippet(id);
            if (!res.ok) {
                // If network fails, try stale cache as fallback
                const stale: SnippetData | null = readSnippetCache(id);
                if (stale) {
                    log(color.yellow('Warning:') + ' Network unavailable, using cached version.');
                    s = stale;
                } else {
                    if (res.status === 404) {
                        console.error(
                            color.red('Error:') +
                                ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`,
                        );
                    } else {
                        console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
                    }
                    process.exit(1);
                }
            } else {
                const body: SnippetGetResponse = (await res.json()) as SnippetGetResponse;
                s = (body.data || body) as SnippetData;
                writeSnippetCache(id, s);
            }
        }

        const code: string | undefined = s!.code;
        if (!code || !code.trim()) {
            console.error(color.red('Error:') + ' Snippet has no code to execute.');
            process.exit(1);
        }

        log(color.dim(`Running snippet: ${s!.name || id}`));
        log(color.dim('\u2500'.repeat(40)));

        await runScript(code);
    } catch (err: any) {
        if (err.code === 'ERR_SCRIPT') throw err;
        console.error(color.red('Error:') + ` Failed to run snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetPull
// ---------------------------------------------------------------------------

async function snippetPull(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];
    const outputFile: string | undefined = flags.positional[1];

    if (!id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet pull <id> [output-file]');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    try {
        const res: Response = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(
                    color.red('Error:') +
                        ` Snippet '${id}' not found. Private snippets require login (${color.cyan('robinpath login')}).`,
                );
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body: SnippetGetResponse = (await res.json()) as SnippetGetResponse;
        const s: SnippetData = (body.data || body) as SnippetData;
        const code: string = s.code || '';

        // Determine output filename
        const sanitizedName: string = (s.name || 'snippet').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
        const fileName: string = outputFile || `${sanitizedName}.rp`;
        const filePath: string = resolve(fileName);

        writeFileSync(filePath, code, 'utf-8');

        if (flags.json) {
            console.log(JSON.stringify({ id, name: s.name, file: filePath, bytes: Buffer.byteLength(code) }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Snippet pulled to: ' + color.cyan(fileName));
        log('  Snippet: ' + (s.name || id));
        log('  Size:    ' + Buffer.byteLength(code) + ' bytes');
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to pull snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetPush
// ---------------------------------------------------------------------------

async function snippetPush(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const fileArg: string | undefined = flags.positional[0];
    let id: string | undefined = flags.positional[1];

    if (!fileArg || !id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet push <file> <id>');
        console.error('');
        console.error("  Uploads a local file as the snippet's code.");
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet push app.rp abc123');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const filePath: string = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    const code: string = readFileSync(filePath, 'utf-8');
    if (!code.trim()) {
        console.error(color.red('Error:') + ' File is empty.');
        process.exit(1);
    }

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to push code (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ pushed: true, id, file: fileArg, bytes: Buffer.byteLength(code) }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Code pushed to snippet: ' + color.cyan(id));
        log('  File: ' + fileArg);
        log('  Size: ' + Buffer.byteLength(code) + ' bytes');
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to push code: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetVersion
// ---------------------------------------------------------------------------

async function snippetVersion(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    let id: string | undefined = flags.positional[0];
    const ver: string | undefined = flags.positional[1] || flags.version;

    if (!id || !ver) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet version <id> <version> [--changelog=<text>]');
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet version abc123 1.2.0');
        console.error('    robinpath snippet version abc123 2.0.0 --changelog="Breaking changes"');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const payload: Record<string, string> = { version: ver };
    if (flags.changelog) payload.changelog = flags.changelog;

    try {
        const res: Response = await platformFetch(`/v1/snippets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body: Record<string, any> = await res.json().catch(() => ({}));
            console.error(
                color.red('Error:') +
                    ` Failed to set version (HTTP ${res.status}): ${body.error?.message || res.statusText}`,
            );
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ id, version: ver, changelog: flags.changelog || null }, null, 2));
            return;
        }

        log(color.green('\u2713') + ' Version set: ' + color.cyan(ver) + ' for snippet ' + id);
        if (flags.changelog) log('  Changelog: ' + flags.changelog);
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to set version: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetDiff
// ---------------------------------------------------------------------------

async function snippetDiff(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const fileArg: string | undefined = flags.positional[0];
    let id: string | undefined = flags.positional[1];

    if (!fileArg || !id) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet diff <file> <id>');
        console.error('');
        console.error("  Compare a local file with a remote snippet's code.");
        console.error('');
        console.error('  Examples:');
        console.error('    robinpath snippet diff app.rp abc123');
        process.exit(2);
    }
    id = await resolveSnippetId(id);

    const filePath: string = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    const localCode: string = readFileSync(filePath, 'utf-8');

    try {
        const res: Response = await fetchSnippet(id);
        if (!res.ok) {
            if (res.status === 404) {
                console.error(color.red('Error:') + ` Snippet '${id}' not found.`);
            } else {
                console.error(color.red('Error:') + ` Failed to fetch snippet (HTTP ${res.status})`);
            }
            process.exit(1);
        }

        const body: SnippetGetResponse = (await res.json()) as SnippetGetResponse;
        const s: SnippetData = (body.data || body) as SnippetData;
        const remoteCode: string = s.code || '';

        if (localCode === remoteCode) {
            log(color.green('\u2713') + ' No differences \u2014 local file matches remote snippet.');
            return;
        }

        // Simple line-by-line diff
        const localLines: string[] = localCode.split('\n');
        const remoteLines: string[] = remoteCode.split('\n');
        const maxLines: number = Math.max(localLines.length, remoteLines.length);

        log(color.bold(`Diff: ${fileArg} (local) vs ${s.name || id} (remote)`));
        log(color.dim('\u2500'.repeat(60)));

        let additions: number = 0,
            deletions: number = 0,
            unchanged: number = 0;

        for (let i: number = 0; i < maxLines; i++) {
            const local: string | undefined = localLines[i];
            const remote: string | undefined = remoteLines[i];
            const lineNum: string = String(i + 1).padStart(4);

            if (local === remote) {
                // Only show context around changes (3 lines)
                unchanged++;
            } else if (local !== undefined && remote !== undefined) {
                // Changed line
                log(color.red(`${lineNum} - ${remote}`));
                log(color.green(`${lineNum} + ${local}`));
                deletions++;
                additions++;
            } else if (local === undefined) {
                // Line only in remote
                log(color.red(`${lineNum} - ${remote}`));
                deletions++;
            } else {
                // Line only in local
                log(color.green(`${lineNum} + ${local}`));
                additions++;
            }
        }

        log(color.dim('\u2500'.repeat(60)));
        log(
            `${color.green(`+${additions}`)} additions, ${color.red(`-${deletions}`)} deletions, ${unchanged} unchanged`,
        );

        if (additions > 0 || deletions > 0) {
            log('');
            log(color.dim(`  Push local changes: robinpath snippet push ${fileArg} ${id}`));
            log(color.dim(`  Pull remote version: robinpath snippet pull ${id} ${fileArg}`));
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to diff snippet: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetExport
// ---------------------------------------------------------------------------

async function snippetExport(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);

    log('Exporting all snippets...\n');

    try {
        const allSnippets: SnippetData[] = [];
        let page: number = 1;
        const limit: number = 50;

        while (true) {
            const params: URLSearchParams = new URLSearchParams({ page: String(page), limit: String(limit) });
            const res: Response = await platformFetch(`/v1/snippets?${params}`);
            if (!res.ok) {
                console.error(color.red('Error:') + ` Failed to fetch snippets (HTTP ${res.status})`);
                process.exit(1);
            }

            const body: SnippetListResponse = (await res.json()) as SnippetListResponse;
            const snippets: SnippetData[] = body.data || [];
            allSnippets.push(...snippets);

            const pagination: Pagination | undefined = body.pagination as Pagination | undefined;
            if (!pagination || page >= pagination.pages) break;
            page++;
        }

        if (allSnippets.length === 0) {
            log('No snippets to export.');
            return;
        }

        const exportData = {
            exportedAt: new Date().toISOString(),
            count: allSnippets.length,
            snippets: allSnippets.map((s) => ({
                name: s.name,
                description: s.description,
                code: s.code,
                language: s.language,
                tags: s.tags,
                visibility: s.visibility,
                category: s.category,
                status: s.status,
                readme: s.readme,
                version: s.version,
                license: s.license,
            })),
        };

        if (flags.json || !flags.format || flags.format === 'json') {
            const outputFile: string = flags.positional[0] || 'snippets-export.json';
            const filePath: string = resolve(outputFile);
            writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
            log(
                color.green('\u2713') +
                    ` Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? 's' : ''} to: ${color.cyan(outputFile)}`,
            );
        }
    } catch (err: any) {
        console.error(color.red('Error:') + ` Failed to export snippets: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// snippetImport
// ---------------------------------------------------------------------------

async function snippetImport(args: string[]): Promise<void> {
    const flags: SnippetFlags = parseSnippetFlags(args);
    const fileArg: string | undefined = flags.positional[0];

    if (!fileArg) {
        console.error(color.red('Error:') + ' Usage: robinpath snippet import <file.json> [--json]');
        process.exit(2);
    }

    const filePath: string = resolve(fileArg);
    if (!existsSync(filePath)) {
        console.error(color.red('Error:') + ` File not found: ${fileArg}`);
        process.exit(1);
    }

    let importData: any;
    try {
        importData = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        console.error(color.red('Error:') + ' Invalid JSON file.');
        process.exit(1);
    }

    const snippets: any[] = importData.snippets || importData;
    if (!Array.isArray(snippets)) {
        console.error(color.red('Error:') + ' Expected JSON with a "snippets" array.');
        process.exit(1);
    }

    log(`Importing ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}...\n`);

    let created: number = 0,
        failed: number = 0;
    const results: ImportResult[] = [];

    for (const s of snippets) {
        if (!s.name || !s.code) {
            failed++;
            results.push({ name: s.name || '(unnamed)', status: 'skipped', reason: 'missing name or code' });
            continue;
        }

        try {
            const payload: Record<string, any> = {
                name: s.name,
                code: s.code,
                language: s.language || 'robinpath',
            };
            if (s.description) payload.description = s.description;
            if (s.visibility) payload.visibility = s.visibility;
            if (s.category) payload.category = s.category;
            if (s.tags) payload.tags = typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags;
            if (s.status) payload.status = s.status;
            if (s.license) payload.license = s.license;
            if (s.version) payload.version = s.version;
            if (s.readme) payload.readme = s.readme;

            const res: Response = await platformFetch('/v1/snippets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const body: SnippetCreateResponse = (await res.json()) as SnippetCreateResponse;
                created++;
                results.push({ name: s.name, status: 'created', id: body.id || body.data?.id });
                log(color.green('  \u2713') + ' ' + s.name);
            } else {
                failed++;
                results.push({ name: s.name, status: 'failed', httpStatus: res.status });
                log(color.red('  \u2717') + ' ' + s.name + color.dim(` (HTTP ${res.status})`));
            }
        } catch (err: any) {
            failed++;
            results.push({ name: s.name, status: 'failed', error: err.message });
            log(color.red('  \u2717') + ' ' + s.name + color.dim(` (${err.message})`));
        }
    }

    log('');
    if (flags.json) {
        console.log(JSON.stringify({ created, failed, total: snippets.length, results }, null, 2));
        return;
    }

    log(
        color.green(`\u2713 Imported: ${created}`) +
            (failed > 0 ? color.red(` | Failed: ${failed}`) : '') +
            ` | Total: ${snippets.length}`,
    );
}
