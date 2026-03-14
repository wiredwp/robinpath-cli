import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

// Try Bun first (supports ESM + Ink v5 React UI), fall back to esbuild (CJS)
let useBun = false;
try {
    execSync('bun --version', { stdio: 'pipe' });
    useBun = true;
} catch {}

if (useBun) {
    console.log('Building with Bun (full Ink UI)...');
    execSync(
        `bun build src/index.ts --compile --outfile=dist/robinpath --target=bun --define:__CLI_VERSION__='"${version}"'`,
        { stdio: 'inherit' }
    );
} else {
    // esbuild CJS — Ink v5 excluded (ESM-only), falls back to old REPL at runtime
    console.log('Building with esbuild (no Ink UI)...');
    execSync(
        `npx esbuild src/index.ts --bundle --minify --platform=node --format=cjs --target=node22 --define:__CLI_VERSION__='"${version}"' --external:ink --external:react --external:ink-spinner --external:ink-text-input --external:react-devtools-core --external:yoga-layout --outfile=dist/robinpath-cli.cjs`,
        { stdio: 'inherit' }
    );
}
