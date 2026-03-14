/**
 * RobinPath CLI Entry Point
 * Bundled by esbuild, packaged as Node.js SEA.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';

import { getROBINPATH_VERSION } from './runtime';

import { CLI_VERSION, color, log, setFlags, FLAG_AUTO_ACCEPT, FLAG_DEV_MODE } from './utils';
import { readAiConfig, writeAiConfig } from './config';
import { listSessions } from './sessions';
import { showMainHelp, showCommandHelp } from './help';
import { handleStart, handleStatus, readStdin } from './server';
import { fetchBrainStream, fetchBrainContext, buildEnrichedPrompt } from './brain';
import { startAiREPL, handleAiConfig } from './repl';

import { startInkREPL } from './ink-repl';

async function startInkOrFallback(
    prompt: string | null,
    resumeId: string | null,
    opts: { autoAccept: boolean; devMode: boolean },
): Promise<void> {
    if (process.stdin.isTTY) {
        return startInkREPL(prompt, resumeId, opts);
    }
    return startAiREPL(prompt, resumeId, opts);
}
import {
    checkForUpdates,
    handleUpdate,
    handleInstall,
    handleUninstall,
    resolveScriptPath,
    runScript,
    readAuth,
} from './commands-core';
import {
    handleAdd,
    handleRemove,
    handleUpgrade,
    handleModulesList,
    handleModulesUpgradeAll,
    handleModulesInit,
    handlePack,
    handleSearch,
    handleInfo,
} from './commands-modules';
import {
    handleInit,
    handleProjectInstall,
    handleDoctor,
    handleEnv,
    handleCache,
    handleAudit,
    handleDeprecate,
} from './commands-project';
import { handleSnippet } from './commands-snippets';
import { handleLogin, handleLogout, handleWhoami, handlePublish, handleSync } from './commands-cloud';
import { handleCheck, handleAST, handleFmt, handleTest, handleWatch, startREPL } from './commands-devtools';
import { expandFileRefs } from './file-refs';

// ============================================================================
// AI command handlers (kept here since they tie together many modules)
// ============================================================================

async function handleAi(args: string[]): Promise<void> {
    if (args[0] === 'config') {
        await handleAiConfig(args.slice(1));
        return;
    }

    if (args[0] === 'sessions') {
        const sessions = listSessions();
        if (sessions.length === 0) {
            log('No saved sessions.');
        } else {
            log(`\nSaved Sessions (${sessions.length}):`);
            for (const s of sessions) {
                const age = Math.round((Date.now() - new Date(s.updated).getTime()) / 60000);
                const ageStr =
                    age < 60
                        ? `${age}m ago`
                        : age < 1440
                          ? `${Math.round(age / 60)}h ago`
                          : `${Math.round(age / 1440)}d ago`;
                log(`  ${s.id}  ${s.name}  (${s.messages} msgs, ${ageStr})`);
            }
            log(`\nResume with: robinpath ai --resume <id>`);
        }
        return;
    }

    const resumeIdx = args.indexOf('--resume');
    if (resumeIdx !== -1) {
        const resumeId = args[resumeIdx + 1];
        if (!resumeId) {
            log('Usage: robinpath ai --resume <session-id>');
            return;
        }
        await startInkOrFallback(null, resumeId, { autoAccept: FLAG_AUTO_ACCEPT, devMode: FLAG_DEV_MODE });
        return;
    }

    const prompt = args.join(' ').trim();
    await startInkOrFallback(prompt || null, null, { autoAccept: FLAG_AUTO_ACCEPT, devMode: FLAG_DEV_MODE });
}

// ============================================================================
// Headless prompt mode
// ============================================================================

interface HeadlessOpts {
    save?: boolean;
    run?: boolean;
    outFile?: string | null;
}

async function handleHeadlessPrompt(prompt: string, opts: HeadlessOpts = {}): Promise<void> {
    const { save = false, run = false, outFile = null } = opts;

    // Expand @/ file references before sending
    const { expanded: expandedPrompt, refs: fileRefs } = expandFileRefs(prompt);
    if (fileRefs.length > 0) {
        const totalFiles = fileRefs.reduce((n, r) => n + r.files.length, 0);
        console.error(`  ${totalFiles} file(s) attached`);
    }

    const enriched = await buildEnrichedPrompt(expandedPrompt);

    if (enriched.missingModules.length > 0) {
        console.error('');
        for (const mod of enriched.missingModules) {
            console.error(`  \u26A0 Requires: ${mod} (not installed)`);
            console.error(`    \u2192 robinpath add ${mod}`);
        }
        console.error('');
    }

    try {
        const isSaveOrRun = save || run;

        if (isSaveOrRun) {
            const brainResult = await fetchBrainStream(enriched.enrichedPrompt);

            if (!brainResult || !brainResult.code) {
                const fallback = await fetchBrainContext(enriched.enrichedPrompt);
                if (fallback && fallback.code) {
                    await handleSaveRun(fallback.code, prompt, { save, run, outFile });
                } else {
                    console.error('Error: Brain returned no response');
                    process.exit(1);
                }
                return;
            }

            await handleSaveRun(brainResult.code, prompt, { save, run, outFile });
        } else {
            const brainResult = await fetchBrainStream(enriched.enrichedPrompt, {
                onToken: (delta: string) => {
                    if (delta === '\x1b[RETRY]') return;
                    process.stdout.write(delta);
                },
            });

            if (!brainResult) {
                const fallback = await fetchBrainContext(enriched.enrichedPrompt);
                if (fallback && fallback.code) {
                    console.log(fallback.code);
                } else {
                    console.error('Error: Brain returned no response');
                    process.exit(1);
                }
                return;
            }

            if (brainResult.code && !brainResult.code.endsWith('\n')) {
                process.stdout.write('\n');
            }
        }
    } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
    }
}

async function handleSaveRun(
    content: string,
    prompt: string,
    { save, run, outFile }: { save: boolean; run: boolean; outFile: string | null },
): Promise<void> {
    const codeMatch = content.match(/```(?:robinpath|robin|rp|js|javascript)?\s*\n([\s\S]*?)```/);
    const codeBlock = codeMatch ? codeMatch[1].trim() : null;

    if (codeBlock) {
        const fs = await import('node:fs');
        const path = await import('node:path');

        let fileName = outFile;
        if (!fileName) {
            const slug = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 50);
            fileName = `${slug}.rp`;
        }
        if (!fileName.endsWith('.rp')) fileName += '.rp';

        const fullPath = path.default.resolve(fileName);
        fs.default.writeFileSync(fullPath, codeBlock + '\n');
        console.error(`Saved: ${fullPath}`);

        if (run) {
            console.error(`Running: ${fileName}\n`);
            await runScript(codeBlock, fullPath);
        } else {
            console.log(content);
        }
    } else {
        console.error('No RobinPath code block found in response — printing raw output');
        console.log(content);
    }
}

// ============================================================================
// Main entry point
// ============================================================================

/** Simple arrow-key selector — returns selected index */
function arrowSelect(options: string[]): Promise<number> {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY) { resolve(0); return; }
        let selected = 0;

        function render() {
            process.stdout.write('\x1b[2K\r');
            for (let i = 0; i < options.length; i++) {
                if (i > 0) process.stdout.write('\n\x1b[2K');
                const marker = i === selected ? color.cyan('  ❯ ') : '    ';
                const text = i === selected ? color.bold(options[i]) : options[i];
                process.stdout.write(`${marker}${text}`);
            }
            if (options.length > 1) process.stdout.write(`\x1b[${options.length - 1}A\r`);
        }

        render();
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const onKey = (buf: Buffer): void => {
            const key = buf.toString();
            if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); return; }
            if (key === '\x1b[B') { selected = Math.min(options.length - 1, selected + 1); render(); return; }
            if (key === '\r' || key === '\n') {
                process.stdin.removeListener('data', onKey);
                try { process.stdin.setRawMode(false); } catch {}
                process.stdin.pause();
                process.stdout.write('\n'.repeat(options.length));
                resolve(selected);
                return;
            }
            if (key === '\x1b' || key === '\x03') {
                process.stdin.removeListener('data', onKey);
                try { process.stdin.setRawMode(false); } catch {}
                process.stdin.pause();
                process.stdout.write('\n'.repeat(options.length));
                resolve(options.length - 1); // last option = skip/cancel
                return;
            }
        };
        process.stdin.on('data', onKey);
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // Parse global flags
    setFlags({
        quiet: args.includes('--quiet') || args.includes('-q'),
        verbose: args.includes('--verbose'),
        autoAccept: args.includes('--auto'),
        devMode: args.includes('--dev'),
    });
    if (args.includes('--dev')) {
        setFlags({ autoAccept: true, verbose: true });
    }

    const invokedAs = basename(process.execPath, '.exe').toLowerCase();
    const cliName = invokedAs === 'rp' ? 'rp' : 'robinpath';

    if (args.includes('--version') || args.includes('-v')) {
        console.log(`${cliName} v${CLI_VERSION} (lang v${getROBINPATH_VERSION()})`);
        return;
    }

    if (args.includes('--help') || args.includes('-h')) {
        showMainHelp();
        return;
    }

    // Find actual command (skip global flags)
    const globalFlags = new Set(['--quiet', '-q', '--verbose', '--auto', '--dev']);
    const command = args.find((a) => !globalFlags.has(a));

    if (command === 'help') {
        const subCommand = args[1];
        subCommand ? showCommandHelp(subCommand) : showMainHelp();
        return;
    }

    // ── Module management ──
    if (command === 'add') {
        await handleAdd(args.slice(1));
        return;
    }
    if (command === 'remove') {
        await handleRemove(args.slice(1));
        return;
    }
    if (command === 'upgrade') {
        await handleUpgrade(args.slice(1));
        return;
    }
    if (command === 'search') {
        await handleSearch(args.slice(1));
        return;
    }
    if (command === 'info') {
        await handleInfo(args.slice(1));
        return;
    }
    if (command === 'modules' || command === 'module') {
        const sub = args[1];
        if (!sub || sub === 'list') await handleModulesList();
        else if (sub === 'upgrade') await handleModulesUpgradeAll();
        else if (sub === 'init') await handleModulesInit();
        else {
            console.error(color.red('Error:') + ` Unknown subcommand: modules ${sub}`);
            console.error('Available: modules list, modules upgrade, modules init');
            process.exit(2);
        }
        return;
    }
    if (command === 'pack') {
        await handlePack(args.slice(1));
        return;
    }
    if (command === 'audit') {
        await handleAudit();
        return;
    }
    if (command === 'deprecate') {
        await handleDeprecate(args.slice(1));
        return;
    }
    if (command === 'env') {
        await handleEnv(args.slice(1));
        return;
    }
    if (command === 'cache') {
        await handleCache(args.slice(1));
        return;
    }
    if (command === 'doctor') {
        await handleDoctor();
        return;
    }
    if (command === 'init') {
        await handleInit(args.slice(1));
        return;
    }

    // ── Install / Update ──
    if (command === 'install') {
        existsSync(resolve('robinpath.json')) ? await handleProjectInstall() : handleInstall();
        return;
    }
    if (command === 'uninstall') {
        await handleUninstall();
        return;
    }
    if (command === 'update') {
        await handleUpdate();
        return;
    }

    // ── Dev tools ──
    if (command === 'check') {
        await handleCheck(args.slice(1));
        return;
    }
    if (command === 'ast') {
        await handleAST(args.slice(1));
        return;
    }
    if (command === 'fmt') {
        await handleFmt(args.slice(1));
        return;
    }
    if (command === 'test') {
        await handleTest(args.slice(1));
        return;
    }

    // ── Cloud ──
    if (command === 'login') {
        await handleLogin();
        return;
    }
    if (command === 'logout') {
        handleLogout();
        return;
    }
    if (command === 'whoami') {
        await handleWhoami();
        return;
    }
    if (command === 'publish') {
        await handlePublish(args.slice(1));
        return;
    }
    if (command === 'sync') {
        await handleSync();
        return;
    }

    // ── Snippets ──
    if (command === 'snippet' || command === 'snippets') {
        await handleSnippet(args.slice(1));
        return;
    }

    // ── AI ──
    if (command === 'ai') {
        await handleAi(args.slice(1));
        return;
    }

    // ── Language REPL ──
    if (command === 'repl') {
        await startREPL();
        return;
    }

    // ── Server ──
    if (command === 'start') {
        await handleStart(args.slice(1));
        return;
    }
    if (command === 'status') {
        await handleStatus(args.slice(1));
        return;
    }

    // ── Headless prompt (-p) ──
    const promptIdx = args.indexOf('-p') !== -1 ? args.indexOf('-p') : args.indexOf('--prompt');
    if (promptIdx !== -1) {
        const hasSave = args.includes('--save');
        const hasRun = args.includes('--run');
        const outIdx = args.indexOf('-o') !== -1 ? args.indexOf('-o') : args.indexOf('--output');
        const outFile = outIdx !== -1 ? args[outIdx + 1] : null;

        const skipSet = new Set([promptIdx]);
        if (hasSave) skipSet.add(args.indexOf('--save'));
        if (hasRun) skipSet.add(args.indexOf('--run'));
        if (outIdx !== -1) {
            skipSet.add(outIdx);
            skipSet.add(outIdx + 1);
        }
        const promptParts: string[] = [];
        for (let pi = promptIdx + 1; pi < args.length; pi++) {
            if (!skipSet.has(pi)) promptParts.push(args[pi]);
        }
        const prompt = promptParts.join(' ').trim();
        if (!prompt) {
            console.error(color.red('Error:') + ' -p requires a prompt argument');
            process.exit(2);
        }
        await handleHeadlessPrompt(prompt, { save: hasSave || !!outFile, run: hasRun, outFile });
        return;
    }

    // ── Eval (-e) ──
    const evalIdx = args.indexOf('-e') !== -1 ? args.indexOf('-e') : args.indexOf('--eval');
    if (evalIdx !== -1) {
        const script = args[evalIdx + 1];
        if (!script) {
            console.error(color.red('Error:') + ' -e requires a script argument');
            process.exit(2);
        }
        await runScript(script);
        return;
    }

    // ── File argument ──
    const dashDashIdx = args.indexOf('--');
    let fileArg: string | undefined;
    if (dashDashIdx !== -1) {
        fileArg = args[dashDashIdx + 1];
    } else {
        const flagsToSkip = new Set(['-q', '--quiet', '--verbose', '-p', '--prompt', '--auto', '--dev']);
        fileArg = args.find((a) => !a.startsWith('-') && !flagsToSkip.has(a));
    }

    if (fileArg) {
        const filePath = resolveScriptPath(fileArg);
        if (!filePath) {
            console.error(color.red('Error:') + ` File not found: ${fileArg}`);
            if (!extname(fileArg)) {
                console.error(`  (also tried ${fileArg}.rp and ${fileArg}.robin)`);
            }
            process.exit(2);
        }

        const script = readFileSync(filePath, 'utf-8');

        const hasWatch = args.includes('--watch');
        const hasShortWatch = args.includes('-w') && command !== 'fmt';
        if (hasWatch || hasShortWatch) {
            await handleWatch(filePath, script);
            return;
        }

        await runScript(script, filePath);
        return;
    }

    // ── Piped stdin ──
    if (!process.stdin.isTTY) {
        const script = await readStdin();
        if (script.trim()) {
            await runScript(script);
        }
        return;
    }

    // ── Default: AI interactive mode ──
    checkForUpdates();

    if (process.stdin.isTTY) {
        // ── Step 1: Login check ──
        const auth = readAuth();
        if (!auth) {
            console.log('');
            console.log(color.bold('  Welcome to RobinPath!'));
            console.log('');
            console.log('  Login to unlock AI assistant, deploy, snippets, and sync.');
            console.log(color.dim('  Without login: run scripts, fmt, test, and install modules.'));
            console.log('');

            const choice = await arrowSelect(['Login', 'Skip for now']);
            if (choice === 0) {
                await handleLogin();
            } else {
                console.log(color.dim('  Run ') + color.cyan('robinpath login') + color.dim(' anytime.'));
                console.log('');
                return;
            }
        }

        // ── Step 2: API key check ──
        const config = readAiConfig();
        if (!config.apiKey) {
            console.log('');
            console.log(color.green('  ✓') + ' Logged in!');
            console.log('');
            console.log('  Connect your OpenRouter API key to use the AI:');
            console.log('');
            console.log(color.bold('  1.') + ' Go to ' + color.cyan('https://openrouter.ai/keys'));
            console.log(color.bold('  2.') + ' Create a key and copy it');
            console.log(color.bold('  3.') + ' Paste it below:');
            console.log('');

            // Masked key input — right here, no separate command needed
            const apiKey: string = await new Promise((resolve) => {
                process.stdout.write(color.cyan('  API key: '));
                process.stdin.setRawMode(true);
                process.stdin.resume();
                let input = '';
                const onData = (ch: Buffer): void => {
                    const c = ch.toString();
                    if (c === '\r' || c === '\n') {
                        process.stdin.removeListener('data', onData);
                        try { process.stdin.setRawMode(false); } catch {}
                        process.stdin.pause();
                        process.stdout.write('\n');
                        resolve(input);
                    } else if (c === '\x03' || c === '\x1b') {
                        process.stdin.removeListener('data', onData);
                        try { process.stdin.setRawMode(false); } catch {}
                        process.stdin.pause();
                        process.stdout.write('\n');
                        resolve('');
                    } else if (c === '\x7f' || c === '\b') {
                        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
                    } else if (c.charCodeAt(0) >= 32) {
                        input += c;
                        process.stdout.write('*');
                    }
                };
                process.stdin.on('data', onData);
            });

            if (apiKey && apiKey.trim()) {
                const k = apiKey.trim();
                const newConfig: any = { apiKey: k, model: 'anthropic/claude-sonnet-4.6' };
                if (k.startsWith('sk-or-')) newConfig.provider = 'openrouter';
                else if (k.startsWith('sk-ant-')) newConfig.provider = 'anthropic';
                else if (k.startsWith('sk-')) newConfig.provider = 'openai';
                else newConfig.provider = 'openrouter';
                writeAiConfig(newConfig);
                console.log(color.green('  ✓') + ' API key saved! Provider: ' + color.cyan(newConfig.provider));
                console.log('');
            } else {
                console.log(color.dim('  Skipped. Set it later: ') + color.cyan('robinpath ai config set-key ...'));
                console.log('');
                return;
            }
        }
    }

    // ── Step 3: Enter AI mode (login + key ready) ──
    await startInkOrFallback(null, null, { autoAccept: FLAG_AUTO_ACCEPT, devMode: FLAG_DEV_MODE });
}

main().catch((err) => {
    console.error(color.red('Fatal:') + ` ${err.message}`);
    process.exit(1);
});
