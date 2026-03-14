import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

// Bundle our code but keep npm dependencies external
// Node.js resolves them from node_modules at runtime
execSync(
    `npx esbuild src/index.ts --bundle --format=esm --platform=node --target=node18 --jsx=automatic --define:__CLI_VERSION__='"${version}"' --external:ink --external:react --external:react/jsx-runtime --external:ink-spinner --external:ink-text-input --external:react-devtools-core --external:yoga-layout --outfile=dist/cli.mjs`,
    { stdio: 'inherit' }
);

// Add shebang
const content = readFileSync('dist/cli.mjs', 'utf8');
if (!content.startsWith('#!')) {
    writeFileSync('dist/cli.mjs', '#!/usr/bin/env node\n' + content);
}

console.log(`Built @robinpath/cli v${version}`);
