import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

// Build with Bun — supports ESM, top-level await, Ink v5
execSync(
    `bun build src/index.ts --compile --outfile=dist/robinpath --target=bun --define:__CLI_VERSION__='"${version}"'`,
    { stdio: 'inherit' }
);
