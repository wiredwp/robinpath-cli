import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

execSync(
    `npx esbuild src/index.ts --bundle --minify --platform=node --format=cjs --target=node22 --jsx=automatic --define:__CLI_VERSION__='"${version}"' --outfile=dist/robinpath-cli.cjs`,
    { stdio: 'inherit' }
);
