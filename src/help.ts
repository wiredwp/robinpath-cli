/**
 * RobinPath CLI — Help system
 * Contains showMainHelp() and showCommandHelp() with all CLI help text.
 */
import { color, CLI_VERSION } from './utils';

/**
 * Show the main help page with all commands, flags, and examples.
 */
export function showMainHelp(): void {
    console.log(`RobinPath v${CLI_VERSION} — Scripting language for automation and data processing

USAGE:
  robinpath [command] [flags] [file]
  rp [command] [flags] [file]          (shorthand alias)

COMMANDS:
  <file.rp>          Run a RobinPath script
  fmt <file|dir>     Format a script (--write to overwrite, --check for CI, --diff)
  check <file>       Check syntax without executing (--json for machine output)
  ast <file>         Dump AST as JSON (--compact for minified)
  test [dir|file]    Run *.test.rp test files (--json for machine output)

MODULE MANAGEMENT:
  add <pkg>[@ver]    Install a module from the registry
  remove <pkg>       Uninstall a module
  upgrade <pkg>      Upgrade a single module to latest
  search [query]     Search the module registry (--category, --sort, --page, --limit)
  info               Show system paths (--json for machines)
  info <pkg>         Show module details from registry
  modules list       List installed modules
  modules upgrade    Upgrade all installed modules
  modules init       Scaffold a new module (interactive wizard)
  audit              Check installed modules for issues

PROJECT:
  init               Create a robinpath.json project
  install            Install all modules from robinpath.json
  doctor             Diagnose environment and modules
  env <set|list|rm>  Manage environment secrets
  cache <list|clean> Manage download cache

SYSTEM:
  install            Install robinpath to system PATH (if no robinpath.json)
  uninstall          Remove robinpath from system
  update             Update robinpath to the latest version

SERVER (HTTP API):
  start              Start HTTP server for app integration
                     -p, --port <port>        Port (default: 6372)
                     -s, --session <token>    Session secret (auto-generated if omitted)
                     --host <addr>            Bind address (default: 127.0.0.1)
                     --timeout <ms>           Max script execution time (default: 30000)
                     --max-concurrent <n>     Max parallel jobs (default: 5)
                     --log-file <path>        Write JSON logs to file
                     --max-body <bytes>       Max request body (default: 5MB)
  status             Check if server is running on a port

  Endpoints:  /v1/health, /v1/execute, /v1/execute/file, /v1/check,
              /v1/fmt, /v1/jobs, /v1/jobs/:id, /v1/jobs/:id/stream,
              /v1/jobs/:id/cancel, /v1/modules, /v1/info,
              /v1/metrics, /v1/stop

  Features:   Session gatekeeper, SSE streaming, webhook callbacks,
              idempotency keys, rate limiting, structured logging,
              job management, API versioning (/v1/)

  All endpoints require x-robinpath-session header (except /v1/health).
  Use 'robinpath help start' for full details.

CLOUD:
  login              Sign in to RobinPath Cloud via browser
  logout             Remove stored credentials
  whoami             Show current user and account info
  publish [dir]      Publish a module to the registry
  pack [dir]         Create tarball without publishing
  deprecate <pkg>    Mark a module as deprecated
  sync               List your published modules

AI:
  (default)              Type 'robinpath' with no args to start AI mode
  -p, --prompt <text>    Headless AI prompt (no UI, just response — for scripts/apps)
  -p "..." --save        Save generated code to an auto-named .rp file
  -p "..." --run         Save and immediately run the generated script
  -p "..." -o <file>     Save generated code to a specific file
  ai config set-key <k>  Set OpenRouter API key
  ai config set-model    Set AI model (e.g. openai/gpt-4o)
  ai config show         Show AI configuration
  ai config remove       Remove AI configuration
  ai sessions            List saved AI sessions
  ai --resume <id>       Resume a saved AI session

SNIPPETS:
  snippet list           List your snippets (--visibility, --status, --category)
  snippet create <file>  Create a snippet from a file (or - for stdin)
  snippet init           Interactive snippet creation wizard
  snippet get <id>       View a snippet (--code-only for raw code)
  snippet update <id>    Update a snippet's metadata or code
  snippet delete <id>    Delete a snippet (--force to confirm)
  snippet explore [q]    Browse public snippets (marketplace)
  snippet search <q>     Search public snippets
  snippet star <id>      Star a snippet
  snippet unstar <id>    Unstar a snippet
  snippet fork <id>      Fork a snippet to your account
  snippet publish <id>   Make a snippet public + published
  snippet unpublish <id> Revert to private draft
  snippet copy <id>      Copy snippet code to clipboard
  snippet run <id>       Fetch and execute (cached, --no-cache to refresh)
  snippet pull <id>      Download snippet code to a local file
  snippet push <f> <id>  Update snippet code from a local file
  snippet diff <f> <id>  Compare local file with remote snippet
  snippet version <id> <v>  Set snippet version
  snippet trending       Browse trending snippets
  snippet export         Export all your snippets to JSON
  snippet import <file>  Import snippets from a JSON export

  Supports partial IDs: robinpath snippet get 01KJ8 (resolves automatically)

FLAGS:
  -p, --prompt <text>  Headless AI prompt (for scripts and app integration)
      --save           Save AI-generated code to .rp file (use with -p)
      --run            Save and run AI-generated code (use with -p)
  -o, --output <file>  Save AI output to specific file (use with -p)
  -e, --eval <code>    Execute inline script
  -w, --watch          Re-run script on file changes
  --auto               Start with auto-accept (skip command confirmations)
  --dev                Dev mode: auto-accept + verbose output
  -q, --quiet          Suppress non-error output
  --verbose            Show timing and debug info
  -v, --version        Show version
  -h, --help           Show this help

REPL:
  repl               Start language REPL (for writing RobinPath code directly)

  REPL Commands:
    help             Show help
    exit / quit      Exit REPL
    clear            Clear screen
    ..               List all available commands/modules
    .load <file>     Load and execute a script file
    .save <file>     Save session to file
    \\                Line continuation (at end of line)

EXAMPLES:
  robinpath app.rp                Run a script
  robinpath hello                 Auto-resolves hello.rp or hello.robin
  robinpath -e 'log "hi"'        Execute inline code
  robinpath fmt app.rp            Print formatted code
  robinpath fmt -w src/           Format all .rp files in dir
  robinpath check app.rp          Syntax check
  robinpath ast app.rp            Dump AST as JSON
  robinpath test                  Run all *.test.rp in current dir
  robinpath test tests/           Run tests in specific dir
  robinpath --watch app.rp        Re-run on file changes
  echo 'log "hi"' | robinpath    Pipe script via stdin
  robinpath start                 Start HTTP server (auto session)
  robinpath start -p 8080 -s my-secret   Start server on port 8080

FILE EXTENSIONS:
  .rp, .robin        Both recognized (auto-resolved without extension)

MODULES (built-in):
  math      Mathematical operations (add, subtract, multiply, ...)
  string    String manipulation (length, slice, split, ...)
  array     Array operations (push, pop, map, filter, ...)
  object    Object operations (keys, values, merge, ...)
  json      JSON parse/stringify
  time      Time operations (sleep, now, format)
  random    Random number generation (int, float, pick, shuffle)
  fetch     HTTP requests (get, post, put, delete)
  test      Test assertions (assert, assertEqual, assertTrue, ...)
  dom       DOM manipulation (browser only)

TEST WRITING:
  Use the test module for assertions:
    test.assert ($value)
    test.assertEqual ($actual) ($expected)
    test.assertTrue ($value)
    test.assertContains ($array) ($item)

  Name test files with .test.rp extension.
  Run with: robinpath test

CONFIGURATION:
  Install dir:  ~/.robinpath/bin/
  Modules dir:  ~/.robinpath/modules/
  History file: ~/.robinpath/history
  Auth file:    ~/.robinpath/auth.json

For more: https://dev.robinpath.com`);
}

/**
 * Show help for a specific command.
 */
export function showCommandHelp(command: string): void {
    const helpPages: Record<string, string> = {
        fmt: `robinpath fmt \u2014 Code formatter

USAGE:
  robinpath fmt <file|dir> [flags]

DESCRIPTION:
  Format RobinPath source code to a canonical style (like gofmt).
  Normalizes syntax: 'set $x as 1' becomes '$x = 1', indentation
  is standardized, etc.

FLAGS:
  -w, --write    Overwrite file(s) in place
  --check        Exit code 1 if any file is not formatted (for CI)
  --diff         Show what would change (unified diff output)

  Without flags, formatted code is printed to stdout.

EXAMPLES:
  robinpath fmt app.rp            Print formatted code to stdout
  robinpath fmt -w app.rp         Format and overwrite file
  robinpath fmt --check app.rp    Check if formatted (CI mode)
  robinpath fmt --diff app.rp     Show diff of changes
  robinpath fmt -w src/           Format all .rp/.robin files in directory
  robinpath fmt --check .         Check all files in current directory`,

        check: `robinpath check \u2014 Syntax checker

USAGE:
  robinpath check <file> [--json]

DESCRIPTION:
  Parse a RobinPath script and report syntax errors without executing.
  Shows rich error context with line numbers and caret pointers.

FLAGS:
  --json         Output result as JSON (for AI agents and tooling)
                 Success: {"ok":true,"file":"app.rp"}
                 Error:   {"ok":false,"file":"app.rp","error":"...","line":5,"column":3}

EXIT CODES:
  0    No syntax errors
  2    Syntax error found

EXAMPLES:
  robinpath check app.rp          Check single file
  robinpath check app.rp --json   Machine-readable output
  robinpath check hello           Auto-resolves hello.rp or hello.robin`,

        ast: `robinpath ast \u2014 AST dump

USAGE:
  robinpath ast <file> [flags]

DESCRIPTION:
  Parse a RobinPath script and output its Abstract Syntax Tree as JSON.
  Useful for tooling, editor integrations, and debugging.

FLAGS:
  --compact      Output minified JSON (no indentation)

EXAMPLES:
  robinpath ast app.rp            Pretty-printed AST
  robinpath ast app.rp --compact  Minified AST`,

        test: `robinpath test \u2014 Test runner

USAGE:
  robinpath test [dir|file] [--json]

DESCRIPTION:
  Discover and run *.test.rp test files. Uses the built-in 'test'
  module for assertions. Each test file runs in an isolated RobinPath
  instance. If any assertion fails, the file is marked FAIL.

  Without arguments, searches the current directory recursively.

FLAGS:
  --json         Output results as JSON (for AI agents and CI)
                 {"passed":1,"failed":1,"total":2,"duration_ms":42,
                  "results":[{"file":"...","status":"pass"},
                             {"file":"...","status":"fail","error":"..."}]}

EXIT CODES:
  0    All tests passed
  1    One or more tests failed

ASSERTIONS (test module):
  test.assert ($value)            Assert value is truthy
  test.assertEqual ($a) ($b)      Assert a equals b
  test.assertTrue ($value)        Assert value is true
  test.assertFalse ($value)       Assert value is false
  test.assertContains ($arr) ($v) Assert array contains value

EXAMPLES:
  robinpath test                  Run all tests in current dir
  robinpath test --json           Machine-readable results
  robinpath test tests/           Run tests in specific dir
  robinpath test my.test.rp       Run a single test file`,

        install: `robinpath install \u2014 System installation

USAGE:
  robinpath install

DESCRIPTION:
  Copy the robinpath binary to ~/.robinpath/bin/ and add it to
  your system PATH. After installation, restart your terminal
  and run 'robinpath --version' to verify.`,

        uninstall: `robinpath uninstall \u2014 System removal

USAGE:
  robinpath uninstall

DESCRIPTION:
  Remove ~/.robinpath/ and clean the PATH entry. After uninstalling,
  restart your terminal.`,

        login: `robinpath login \u2014 Sign in to RobinPath Cloud

USAGE:
  robinpath login

DESCRIPTION:
  Opens your browser to sign in via Google. A unique verification code
  is displayed in your terminal \u2014 confirm it matches in the browser to
  complete authentication. The token is stored in ~/.robinpath/auth.json
  and is valid for 30 days.

ENVIRONMENT:
  ROBINPATH_CLOUD_URL      Override the cloud app URL (default: https://dev.robinpath.com)
  ROBINPATH_PLATFORM_URL   Override the platform API URL`,

        logout: `robinpath logout \u2014 Remove stored credentials

USAGE:
  robinpath logout

DESCRIPTION:
  Deletes the auth token stored in ~/.robinpath/auth.json.
  You will need to run 'robinpath login' again to use cloud features.`,

        whoami: `robinpath whoami \u2014 Show current user info

USAGE:
  robinpath whoami

DESCRIPTION:
  Shows your locally stored email and name, token expiry, and
  fetches your server profile (username, tier, role) if reachable.`,

        publish: `robinpath publish \u2014 Publish a module to the registry

USAGE:
  robinpath publish [dir] [flags]

DESCRIPTION:
  Pack the target directory (default: current dir) as a tarball and upload
  it to the RobinPath registry. Requires a package.json with "name" and
  "version" fields. Scoped packages (@scope/name) are supported.

  Maximum package size: 5MB.
  Excluded from tarball: node_modules, .git, dist

FLAGS:
  --public             Publish as public (default)
  --private            Publish as private (only you can install)
  --org <name>         Publish to an organization
  --patch              Auto-bump patch version before publish
  --minor              Auto-bump minor version before publish
  --major              Auto-bump major version before publish
  --dry-run            Validate and show what would be published

EXAMPLES:
  robinpath publish                        Publish current directory
  robinpath publish --private              Publish as private
  robinpath publish --org mycompany        Publish to org
  robinpath publish --patch                Bump 0.1.0 \u2192 0.1.1 and publish
  robinpath publish --dry-run              Preview without uploading`,

        sync: `robinpath sync \u2014 List your published modules

USAGE:
  robinpath sync

DESCRIPTION:
  Fetches your published modules from the registry and displays
  them in a table with name, version, downloads, and visibility.`,

        add: `robinpath add \u2014 Install a module from the registry

USAGE:
  robinpath add <module>[@version]

DESCRIPTION:
  Downloads and installs a module to ~/.robinpath/modules/.
  Installed modules are automatically available in all scripts.

FLAGS:
  --force            Reinstall even if already installed

EXAMPLES:
  robinpath add @robinpath/slack          Install latest version
  robinpath add @robinpath/slack@0.2.0    Install specific version`,

        remove: `robinpath remove \u2014 Uninstall a module

USAGE:
  robinpath remove <module>

DESCRIPTION:
  Removes an installed module from ~/.robinpath/modules/ and
  updates the local manifest.

EXAMPLES:
  robinpath remove @robinpath/slack`,

        upgrade: `robinpath upgrade \u2014 Upgrade a module to the latest version

USAGE:
  robinpath upgrade <module>

DESCRIPTION:
  Checks the registry for a newer version and installs it.

EXAMPLES:
  robinpath upgrade @robinpath/slack`,

        modules: `robinpath modules \u2014 Module management subcommands

USAGE:
  robinpath modules <subcommand>

SUBCOMMANDS:
  list               List all installed modules
  upgrade            Upgrade all installed modules to latest
  init               Scaffold a new RobinPath module (interactive wizard)

EXAMPLES:
  robinpath modules list
  robinpath modules upgrade
  robinpath modules init`,

        pack: `robinpath pack \u2014 Create a tarball without publishing

USAGE:
  robinpath pack [dir]

DESCRIPTION:
  Creates a .tar.gz archive of the module, same as publish would,
  but saves it to the current directory instead of uploading.

EXAMPLES:
  robinpath pack
  robinpath pack ./my-module`,

        search: `robinpath search \u2014 Search the module registry

USAGE:
  robinpath search <query> [options]
  robinpath search --category=<cat> [options]

OPTIONS:
  --category=<cat>   Filter by category (utilities, devops, productivity, web,
                     sales, marketing, data, communication, ai)
  --sort=<key>       Sort results by: downloads, stars, updated, created, name
                     (default: downloads)
  --page=<n>         Page number (default: 1)
  --limit=<n>        Results per page (default: 20)
  --json             Machine-readable JSON output

DESCRIPTION:
  Searches the RobinPath module registry and displays matching modules.
  You can search by keyword, browse by category, or combine both.
  Results show name, version, download count, stars, and last update.

EXAMPLES:
  robinpath search slack
  robinpath search --category=ai
  robinpath search crm --category=sales --sort=stars
  robinpath search http --limit=5 --page=2
  robinpath search --category=utilities --json`,

        info: `robinpath info \u2014 System info & module details

USAGE:
  robinpath info                Show system paths and environment info
  robinpath info --json         Machine-readable JSON output
  robinpath info <module>       Show module details from registry

DESCRIPTION:
  Without arguments, displays system information including version,
  platform, paths to home dir, modules, cache, auth, and more.
  Useful for external tools that need to discover where RobinPath lives.

  With a module name, displays detailed information from the registry,
  including version, author, license, downloads, and install status.

FLAGS:
  --json       Output as JSON (system info mode, no args)

EXAMPLES:
  robinpath info                 Show system paths
  robinpath info --json          JSON output for external tools
  robinpath info @robinpath/slack`,

        init: `robinpath init \u2014 Create a new RobinPath project

USAGE:
  robinpath init [--force]

DESCRIPTION:
  Creates a robinpath.json project config file in the current directory,
  along with a main.rp entry file, .env, and .gitignore.

EXAMPLES:
  robinpath init`,

        doctor: `robinpath doctor \u2014 Diagnose environment

USAGE:
  robinpath doctor

DESCRIPTION:
  Checks CLI installation, authentication status, installed modules,
  project config, and cache. Reports any issues found.`,

        env: `robinpath env \u2014 Manage environment secrets

USAGE:
  robinpath env set <KEY> <value>
  robinpath env list
  robinpath env remove <KEY>

DESCRIPTION:
  Manages environment variables stored in ~/.robinpath/env.
  Values are masked when listed.

EXAMPLES:
  robinpath env set SLACK_TOKEN xoxb-1234
  robinpath env list
  robinpath env remove SLACK_TOKEN`,

        cache: `robinpath cache \u2014 Manage download cache

USAGE:
  robinpath cache list
  robinpath cache clean

DESCRIPTION:
  Manages the module download cache at ~/.robinpath/cache/.
  Cached tarballs speed up reinstalls and enable offline installs.

EXAMPLES:
  robinpath cache list
  robinpath cache clean`,

        audit: `robinpath audit \u2014 Check installed modules for issues

USAGE:
  robinpath audit

DESCRIPTION:
  Checks each installed module against the registry for deprecation
  warnings and available updates.`,

        deprecate: `robinpath deprecate \u2014 Mark a module as deprecated

USAGE:
  robinpath deprecate <module> "reason"

DESCRIPTION:
  Marks a published module as deprecated. Users who have it installed
  will see a warning when running 'robinpath audit'.

EXAMPLES:
  robinpath deprecate @myorg/old-module "Use @myorg/new-module instead"`,

        start: `robinpath start \u2014 Start HTTP server for app integration

USAGE:
  robinpath start [flags]

DESCRIPTION:
  Starts a local HTTP API server that exposes RobinPath as a service.
  Any application can execute scripts, check syntax, format code,
  and manage jobs via REST API. Session token acts as a secret
  gatekeeper \u2014 requests without a valid token are rejected (403).

  Outputs JSON to stdout on startup:
    {"ok":true,"port":6372,"host":"127.0.0.1","session":"...","version":"..."}

  If the port is already in use, outputs:
    {"ok":false,"error":"Port 6372 is already in use"}

FLAGS:
  -p, --port <port>             Port to listen on (default: 6372)
  -s, --session <token>         Session secret (default: auto-generated UUID)
  --host <address>              Bind address (default: 127.0.0.1)
  --timeout <ms>                Max script execution time (default: 30000)
  --max-concurrent <n>          Max parallel jobs (default: 5)
  --cors-origin <origin>        CORS origin (default: *)
  --log-file <path>             Write structured JSON logs to file
  --max-body <bytes>            Max request body size (default: 5000000)

ENDPOINTS:
  GET  /v1/health               Health check (no auth required)
  POST /v1/execute/file         Execute a .rp file by path
  POST /v1/execute              Execute a RobinPath script (returns job)
  POST /v1/check                Syntax check without executing
  POST /v1/fmt                  Format code
  GET  /v1/jobs                 List all jobs
  GET  /v1/jobs/:id             Job detail with output
  GET  /v1/jobs/:id/stream      SSE real-time progress stream
  POST /v1/jobs/:id/cancel      Cancel a running job
  GET  /v1/modules              List loaded modules
  GET  /v1/info                 Server info and config
  GET  /v1/metrics              Prometheus-style metrics
  POST /v1/stop                 Graceful server shutdown

HEADERS:
  x-robinpath-session           Required on all endpoints (except /health)
  x-request-id                  Optional client request ID (auto-generated if missing)
  x-idempotency-key             Prevents duplicate execution on retry
  accept: text/event-stream     On /v1/execute to get SSE streaming

EXECUTE BODY:
  { "script": "log \\"hi\\"" }                 Inline script
  { "file": "./send-emails.rp" }              Run a file by path
  { "script": "...", "webhook": "url" }       Fire-and-forget with webhook callback
  { "script": "...", "webhook": "url",
    "webhook_secret": "whsec_..." }           Webhook with signature verification

EXAMPLES:
  robinpath start                                Start with defaults
  robinpath start -p 8080 -s my-secret           Custom port and session
  robinpath start --timeout 60000                Allow 60s scripts
  robinpath start --max-concurrent 10            Allow 10 parallel jobs

CURL EXAMPLES:
  curl http://localhost:6372/v1/health

  curl -X POST http://localhost:6372/v1/execute \\
    -H "x-robinpath-session: <token>" \\
    -H "Content-Type: application/json" \\
    -d '{"script":"print(\\"hello\\")"}'

  curl -X POST http://localhost:6372/v1/stop \\
    -H "x-robinpath-session: <token>"`,

        status: `robinpath status \u2014 Check if a server is running

USAGE:
  robinpath status [-p port]

DESCRIPTION:
  Checks if a robinpath server is running on the given port.
  Queries the /v1/health endpoint and checks the PID file.
  Outputs JSON with running status, port, PID, and version.

FLAGS:
  -p, --port <port>    Port to check (default: 6372)

OUTPUT:
  Running:  {"ok":true,"running":true,"port":6372,"pid":"12345","version":"1.42.0"}
  Stopped:  {"ok":true,"running":false,"port":6372,"reason":"Server not reachable"}

EXAMPLES:
  robinpath status              Check default port
  robinpath status -p 8080      Check specific port`,

        snippet: `robinpath snippet \u2014 Manage code snippets

USAGE:
  robinpath snippet <subcommand> [options]

  Supports partial IDs \u2014 use just the first few characters:
    robinpath snippet get 01KJ8     (resolves to full ID automatically)

SUBCOMMANDS:
  list                    List your saved snippets
  create <file|->         Create a snippet from a file or stdin
  init                    Interactive snippet creation wizard
  get <id>                View a snippet (code + metadata)
  update <id>             Update a snippet
  delete <id>             Delete a snippet (--force required)
  explore [query]         Browse public snippets (marketplace)
  search <query>          Search public snippets
  star <id>               Star a snippet
  unstar <id>             Unstar a snippet
  fork <id>               Fork a snippet to your account
  publish <id>            Make public + set status to published
  unpublish <id>          Revert to private draft
  copy <id>               Copy snippet code to clipboard
  run <id>                Fetch and execute (cached locally for 5 min)
  pull <id> [file]        Download snippet code to a local file
  push <file> <id>        Update snippet code from local file
  diff <file> <id>        Compare local file with remote snippet
  version <id> <ver>      Set version (--changelog=<text>)
  trending                Browse trending snippets (alias: explore --sort=popular)
  export [file]           Export all snippets to JSON
  import <file>           Import snippets from JSON export

COMMON FLAGS:
  --json                  Machine-readable JSON output
  --page=<n>              Page number (default: 1)
  --limit=<n>             Results per page (default: 20)

GET FLAGS:
  --code-only             Output only the raw code (pipeable)
                          Example: robinpath snippet get <id> --code-only | robinpath

LIST FLAGS:
  --visibility=<v>        Filter: public or private
  --status=<s>            Filter: draft, published, or archived
  --category=<cat>        Filter by category
  [query]                 Search by name/description

CREATE FLAGS:
  --name=<name>           Snippet name (defaults to filename)
  --description=<desc>    Description
  --visibility=<v>        public or private (default: private)
  --category=<cat>        Category (forms, notifications, crm, e-commerce,
                          data-processing, auth, ai, webhooks, utilities, other)
  --tags=<t1,t2>          Comma-separated tags
  --status=<s>            draft, published, or archived
  --license=<lic>         License (MIT, Apache-2.0, GPL-3.0, etc.)
  --version=<ver>         Version string
  --readme=<file>         Readme from file

RUN FLAGS:
  --no-cache              Skip local cache, always fetch from network

EXPLORE FLAGS:
  --category=<cat>        Filter by category
  --sort=<key>            Sort: popular, stars, newest, updated
  --tags=<t1,t2>          Filter by tags

EXAMPLES:
  robinpath snippet list
  robinpath snippet list --visibility=public --status=published
  robinpath snippet list contact                          Search your snippets
  robinpath snippet init                                  Interactive wizard
  robinpath snippet create app.rp --name="My Tool" --visibility=public
  robinpath snippet create - < script.rp --name="Piped Snippet"
  robinpath snippet get 01KJ8                             Partial ID works
  robinpath snippet get abc123 --code-only                Raw code only
  robinpath snippet get abc123 --code-only | robinpath    Pipe to execute
  robinpath snippet update abc123 --name="New Name" --tags=utils,helpers
  robinpath snippet delete abc123 --force
  robinpath snippet explore --category=ai --sort=popular
  robinpath snippet search "slack notification"
  robinpath snippet star abc123
  robinpath snippet fork abc123
  robinpath snippet publish abc123
  robinpath snippet run abc123                            Cached for 5 min
  robinpath snippet run abc123 --no-cache                 Force fresh fetch
  robinpath snippet pull abc123 my-local.rp
  robinpath snippet push updated.rp abc123
  robinpath snippet diff app.rp abc123                    Compare before push
  robinpath snippet version abc123 2.0.0 --changelog="Major rewrite"
  robinpath snippet trending --limit=10
  robinpath snippet export my-backup.json
  robinpath snippet import my-backup.json`,

        ai: `robinpath ai \u2014 AI configuration & interactive mode

USAGE:
  robinpath                          Start AI interactive session (default)
  robinpath -p "question"            Headless prompt (no UI, for scripts/apps)
  robinpath ai config <subcommand>   Manage AI configuration

DESCRIPTION:
  RobinPath AI is an intelligent assistant built into the CLI. It knows
  RobinPath syntax, modules, and patterns. Ask questions, generate code,
  edit files, and run scripts \u2014 all from an interactive prompt.

  Just type 'robinpath' to start. The AI can read and modify your files,
  execute RobinPath code, and help you build projects.

  The -p flag runs a single prompt without UI \u2014 perfect for integration
  with other apps, scripts, or piping output.

SETUP:
  1. Get an API key from https://openrouter.ai/keys
  2. robinpath ai config set-key sk-or-...
  3. robinpath

CONFIG SUBCOMMANDS:
  set-key           Set your OpenRouter API key (interactive secure input)
  set-key <key>     Set your OpenRouter API key (inline \u2014 less secure)
  set-model         Interactive model picker (or set-model <id>)
  show              Show current AI configuration
  remove            Remove AI configuration

AI SESSION COMMANDS:
  /help             Show help inside AI session
  /clear            Clear conversation history
  /model            Interactive model switcher (or /model <id>)
  /tools            List available shell tools
  exit              Exit AI mode

HEADLESS MODE (-p):
  The -p flag returns just the AI response with no UI, colors, or
  formatting. Designed for:
  - Shell scripts:  result=$(robinpath -p "write a CSV parser")
  - App integration: spawn robinpath with -p flag, read stdout
  - Piping:         robinpath -p "explain this" | less

AVAILABLE MODELS:
  robinpath-default                     (free, no key needed)
  anthropic/claude-sonnet-4.6           (recommended)
  anthropic/claude-opus-4.6             (most capable)
  anthropic/claude-haiku-4.5            (fastest)
  openai/gpt-5.2                        (instant)
  openai/gpt-5.2-pro                    (reasoning)
  google/gemini-3-flash-preview         (1M context)
  google/gemini-3.1-pro-preview         (65K output)

EXAMPLES:
  robinpath ai config set-key sk-or-v1-abc123
  robinpath ai config set-model
  robinpath                                        Start AI session
  robinpath -p "how do I read a file?"             Quick answer
  robinpath -p "write a slack bot" > bot.rp        Generate to file

  # Inside AI session:
  > make a script that reads a CSV and posts to Slack
  > add error handling to app.rp
  > what does my project do?
  > run the tests`,
    };

    const page = helpPages[command];
    if (page) {
        console.log(page);
    } else {
        console.error(color.red('Error:') + ` Unknown command: ${command}`);
        console.error(
            'Available: add, remove, upgrade, search, info, modules, init, doctor, env, cache, audit, deprecate, pack, fmt, check, ast, test, install, uninstall, login, logout, whoami, publish, sync, snippet, ai, start, status',
        );
        process.exit(2);
    }
}
