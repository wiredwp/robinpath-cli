---
module: cli
category: tool
type: core
description: RobinPath CLI — the command-line interface for running scripts, managing modules, serving HTTP APIs, publishing packages, AI-assisted coding, and snippet management.
---

# RobinPath CLI

The RobinPath CLI (`robinpath` or `rp`) is the primary interface for the RobinPath scripting language. It handles script execution, code formatting, testing, module management, HTTP server mode, AI-assisted development, and cloud publishing.

## Installation

- **macOS / Linux:** `curl -fsSL https://dev.robinpath.com/install.sh | bash`
- **Windows:** `irm https://dev.robinpath.com/install.ps1 | iex`

After installation, restart your terminal and verify with `robinpath --version`.

## Global Flags

| Flag | Description |
|------|-------------|
| `-q, --quiet` | Suppress non-error output |
| `--verbose` | Show timing and debug info |
| `-v, --version` | Show version |
| `-h, --help` | Show help |

Use `robinpath help <command>` to see detailed help for any command.

## File Extensions

RobinPath recognizes `.rp` and `.robin` file extensions. When running a script without an extension, the CLI auto-resolves (e.g., `robinpath hello` tries `hello.rp` then `hello.robin`).

---

## run (script execution)

Run a RobinPath script file, inline code, or pipe from stdin.

**Syntax:**
```
robinpath <file.rp>
robinpath -e '<code>'
robinpath -w <file.rp>
echo 'log "hi"' | robinpath
```

**Options:**

| Flag | Description |
|------|-------------|
| `-e, --eval <code>` | Execute inline RobinPath code |
| `-w, --watch` | Re-run the script automatically on file changes |

**Examples:**
```bash
robinpath app.rp               # Run a script
robinpath hello                 # Auto-resolves hello.rp or hello.robin
robinpath -e 'log "hi"'        # Execute inline code
robinpath --watch app.rp        # Re-run on file changes
echo 'log "hi"' | robinpath    # Pipe from stdin
```

---

## fmt

Format RobinPath source code to a canonical style (like gofmt). Normalizes syntax: `set $x as 1` becomes `$x = 1`, indentation is standardized, etc.

**Syntax:**
```
robinpath fmt <file|dir> [flags]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-w, --write` | Overwrite file(s) in place |
| `--check` | Exit code 1 if any file is not formatted (for CI) |
| `--diff` | Show what would change (unified diff output) |

Without flags, formatted code is printed to stdout.

**Examples:**
```bash
robinpath fmt app.rp            # Print formatted code to stdout
robinpath fmt -w app.rp         # Format and overwrite file
robinpath fmt --check app.rp    # Check if formatted (CI mode)
robinpath fmt --diff app.rp     # Show diff of changes
robinpath fmt -w src/           # Format all .rp/.robin files in directory
robinpath fmt --check .         # Check all files in current directory
```

---

## check

Parse a RobinPath script and report syntax errors without executing. Shows rich error context with line numbers and caret pointers.

**Syntax:**
```
robinpath check <file> [--json]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output result as JSON for tooling |

JSON output format:
- Success: `{"ok":true,"file":"app.rp"}`
- Error: `{"ok":false,"file":"app.rp","error":"...","line":5,"column":3}`

**Exit Codes:** 0 = no errors, 2 = syntax error found.

**Examples:**
```bash
robinpath check app.rp          # Check single file
robinpath check app.rp --json   # Machine-readable output
robinpath check hello           # Auto-resolves hello.rp or hello.robin
```

---

## ast

Parse a RobinPath script and output its Abstract Syntax Tree as JSON. Useful for tooling, editor integrations, and debugging.

**Syntax:**
```
robinpath ast <file> [--compact]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--compact` | Output minified JSON (no indentation) |

**Examples:**
```bash
robinpath ast app.rp            # Pretty-printed AST
robinpath ast app.rp --compact  # Minified AST
```

---

## test

Discover and run `*.test.rp` test files. Each test file runs in an isolated RobinPath instance. If any assertion fails, the file is marked FAIL.

**Syntax:**
```
robinpath test [dir|file] [--json]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON for CI and tooling |

JSON output: `{"passed":1,"failed":1,"total":2,"duration_ms":42,"results":[...]}`

**Exit Codes:** 0 = all passed, 1 = one or more failed.

**Assertions (test module):**

| Function | Description |
|----------|-------------|
| `test.assert ($value)` | Assert value is truthy |
| `test.assertEqual ($a) ($b)` | Assert a equals b |
| `test.assertTrue ($value)` | Assert value is true |
| `test.assertFalse ($value)` | Assert value is false |
| `test.assertContains ($arr) ($v)` | Assert array contains value |

Name test files with `.test.rp` extension.

**Examples:**
```bash
robinpath test                  # Run all tests in current dir
robinpath test --json           # Machine-readable results
robinpath test tests/           # Run tests in specific dir
robinpath test my.test.rp       # Run a single test file
```

---

## add

Download and install a module from the registry to `~/.robinpath/modules/`. Installed modules are automatically available in all scripts.

**Syntax:**
```
robinpath add <module>[@version] [--force]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Reinstall even if already installed |

**Examples:**
```bash
robinpath add @robinpath/slack          # Install latest version
robinpath add @robinpath/slack@0.2.0    # Install specific version
```

---

## remove

Remove an installed module from `~/.robinpath/modules/` and update the local manifest.

**Syntax:**
```
robinpath remove <module>
```

**Examples:**
```bash
robinpath remove @robinpath/slack
```

---

## upgrade

Check the registry for a newer version of a module and install it.

**Syntax:**
```
robinpath upgrade <module>
```

**Examples:**
```bash
robinpath upgrade @robinpath/slack
```

---

## search

Search the RobinPath module registry. You can search by keyword, browse by category, or combine both.

**Syntax:**
```
robinpath search <query> [options]
robinpath search --category=<cat> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--category=<cat>` | Filter by category: utilities, devops, productivity, web, sales, marketing, data, communication, ai |
| `--sort=<key>` | Sort by: downloads, stars, updated, created, name (default: downloads) |
| `--page=<n>` | Page number (default: 1) |
| `--limit=<n>` | Results per page (default: 20) |
| `--json` | Machine-readable JSON output |

**Examples:**
```bash
robinpath search slack
robinpath search --category=ai
robinpath search crm --category=sales --sort=stars
robinpath search http --limit=5 --page=2
robinpath search --category=utilities --json
```

---

## modules

Module management subcommands.

**Syntax:**
```
robinpath modules <subcommand>
```

### modules list

List all installed modules with name, version, and type.

```bash
robinpath modules list
```

### modules upgrade

Upgrade all installed modules to their latest versions.

```bash
robinpath modules upgrade
```

### modules init

Scaffold a new RobinPath module using an interactive wizard. Creates the directory structure, package.json, and entry file.

```bash
robinpath modules init
```

---

## publish

Pack and upload a module to the RobinPath registry. Requires a `package.json` with `name` and `version` fields. Scoped packages (`@scope/name`) are supported. Maximum package size: 5MB.

**Syntax:**
```
robinpath publish [dir] [flags]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--public` | Publish as public (default) |
| `--private` | Publish as private (only you can install) |
| `--org <name>` | Publish to an organization |
| `--patch` | Auto-bump patch version before publish |
| `--minor` | Auto-bump minor version before publish |
| `--major` | Auto-bump major version before publish |
| `--dry-run` | Validate and show what would be published |

Excluded from tarball: `node_modules`, `.git`, `dist`.

**Examples:**
```bash
robinpath publish                        # Publish current directory
robinpath publish --private              # Publish as private
robinpath publish --org mycompany        # Publish to org
robinpath publish --patch                # Bump 0.1.0 -> 0.1.1 and publish
robinpath publish --dry-run              # Preview without uploading
```

---

## pack

Create a `.tar.gz` archive of a module (same as publish would create) but save it locally instead of uploading.

**Syntax:**
```
robinpath pack [dir]
```

**Examples:**
```bash
robinpath pack
robinpath pack ./my-module
```

---

## init

Create a new RobinPath project in the current directory. Generates `robinpath.json`, `main.rp`, `.env`, and `.gitignore`.

**Syntax:**
```
robinpath init [--force]
```

**Examples:**
```bash
robinpath init
```

---

## install (project dependencies)

Install all modules listed in the project's `robinpath.json`.

**Syntax:**
```
robinpath install
```

> Note: When no `robinpath.json` is present, `robinpath install` instead installs the CLI binary to `~/.robinpath/bin/` and adds it to your system PATH.

---

## start

Start a local HTTP API server that exposes RobinPath as a service. Any application can execute scripts, check syntax, format code, and manage jobs via REST API. The session token acts as a secret gatekeeper.

**Syntax:**
```
robinpath start [flags]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | 6372 | Port to listen on |
| `-s, --session <token>` | auto UUID | Session secret |
| `--host <address>` | 127.0.0.1 | Bind address |
| `--timeout <ms>` | 30000 | Max script execution time |
| `--max-concurrent <n>` | 5 | Max parallel jobs |
| `--cors-origin <origin>` | * | CORS origin |
| `--log-file <path>` | (none) | Write structured JSON logs to file |
| `--max-body <bytes>` | 5000000 | Max request body size |

**Startup output (JSON):**
```json
{"ok":true,"port":6372,"host":"127.0.0.1","session":"...","version":"..."}
```

### Server Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Health check (no auth required) |
| POST | `/v1/execute` | Execute a RobinPath script (returns job) |
| POST | `/v1/execute/file` | Execute a .rp file by path |
| POST | `/v1/check` | Syntax check without executing |
| POST | `/v1/fmt` | Format code |
| GET | `/v1/jobs` | List all jobs |
| GET | `/v1/jobs/:id` | Job detail with output |
| GET | `/v1/jobs/:id/stream` | SSE real-time progress stream |
| POST | `/v1/jobs/:id/cancel` | Cancel a running job |
| GET | `/v1/modules` | List loaded modules |
| GET | `/v1/info` | Server info and config |
| GET | `/v1/metrics` | Prometheus-style metrics |
| POST | `/v1/stop` | Graceful server shutdown |

### Headers

| Header | Description |
|--------|-------------|
| `x-robinpath-session` | Required on all endpoints (except /v1/health) |
| `x-request-id` | Optional client request ID (auto-generated if missing) |
| `x-idempotency-key` | Prevents duplicate execution on retry |
| `accept: text/event-stream` | On /v1/execute to get SSE streaming |

### Execute Body Examples

```json
{ "script": "log \"hi\"" }
{ "file": "./send-emails.rp" }
{ "script": "...", "webhook": "https://example.com/hook" }
{ "script": "...", "webhook": "url", "webhook_secret": "whsec_..." }
```

**Examples:**
```bash
robinpath start                                # Start with defaults
robinpath start -p 8080 -s my-secret           # Custom port and session
robinpath start --timeout 60000                # Allow 60s scripts
robinpath start --max-concurrent 10            # Allow 10 parallel jobs

# cURL
curl http://localhost:6372/v1/health

curl -X POST http://localhost:6372/v1/execute \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"script":"print(\"hello\")"}'
```

---

## status

Check if a RobinPath server is running on a given port.

**Syntax:**
```
robinpath status [-p port]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to check (default: 6372) |

**Output:**
- Running: `{"ok":true,"running":true,"port":6372,"pid":"12345","version":"..."}`
- Stopped: `{"ok":true,"running":false,"port":6372,"reason":"Server not reachable"}`

**Examples:**
```bash
robinpath status              # Check default port
robinpath status -p 8080      # Check specific port
```

---

## info

Show system information or module details from the registry.

**Syntax:**
```
robinpath info                # System paths and environment info
robinpath info --json         # Machine-readable JSON output
robinpath info <module>       # Module details from registry
```

**Examples:**
```bash
robinpath info                 # Show system paths
robinpath info --json          # JSON output for external tools
robinpath info @robinpath/slack
```

---

## doctor

Diagnose the RobinPath environment. Checks CLI installation, authentication status, installed modules, project config, and cache. Reports any issues found.

**Syntax:**
```
robinpath doctor
```

---

## audit

Check each installed module against the registry for deprecation warnings and available updates.

**Syntax:**
```
robinpath audit
```

---

## env

Manage environment secrets stored in `~/.robinpath/env`. Values are masked when listed.

**Syntax:**
```
robinpath env set <KEY> <value>
robinpath env list
robinpath env remove <KEY>
```

**Examples:**
```bash
robinpath env set SLACK_TOKEN xoxb-1234
robinpath env list
robinpath env remove SLACK_TOKEN
```

---

## cache

Manage the module download cache at `~/.robinpath/cache/`. Cached tarballs speed up reinstalls and enable offline installs.

**Syntax:**
```
robinpath cache list
robinpath cache clean
```

---

## login

Sign in to RobinPath Cloud via browser. Opens your browser for Google sign-in with a verification code displayed in the terminal. The token is stored in `~/.robinpath/auth.json` and is valid for 30 days.

**Syntax:**
```
robinpath login
```

**Environment Variables:**

| Variable | Description |
|----------|-------------|
| `ROBINPATH_CLOUD_URL` | Override the cloud app URL |
| `ROBINPATH_PLATFORM_URL` | Override the platform API URL |

---

## logout

Delete the auth token stored in `~/.robinpath/auth.json`.

**Syntax:**
```
robinpath logout
```

---

## whoami

Show your locally stored email and name, token expiry, and fetch your server profile (username, tier, role) if reachable.

**Syntax:**
```
robinpath whoami
```

---

## deprecate

Mark a published module as deprecated. Users who have it installed will see a warning when running `robinpath audit`.

**Syntax:**
```
robinpath deprecate <module> "reason"
```

**Examples:**
```bash
robinpath deprecate @myorg/old-module "Use @myorg/new-module instead"
```

---

## sync

List your published modules from the registry. Displays a table with name, version, downloads, and visibility.

**Syntax:**
```
robinpath sync
```

---

## ai

RobinPath AI is an intelligent assistant built into the CLI. It knows RobinPath syntax, modules, and patterns. Ask questions, generate code, edit files, and run scripts from an interactive prompt.

**Syntax:**
```
robinpath                              # Start AI interactive session (default)
robinpath -p, --prompt "question"      # Headless prompt (no UI, for scripts/apps)
robinpath ai config <subcommand>       # Manage AI configuration
```

### Setup

1. Get an API key from https://openrouter.ai/keys
2. `robinpath ai config set-key sk-or-...`
3. `robinpath` (starts AI session)

### Config Subcommands

| Subcommand | Description |
|------------|-------------|
| `set-key` | Set your OpenRouter API key (interactive secure input) |
| `set-key <key>` | Set your OpenRouter API key (inline) |
| `set-model <id>` | Set the AI model (default: anthropic/claude-sonnet-4-20250514) |
| `show` | Show current AI configuration |
| `remove` | Remove AI configuration |

### AI Session Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help inside AI session |
| `/clear` | Clear conversation history |
| `/model` | Show or switch model |
| `/tools` | List available AI tools |
| `exit` | Exit AI mode |

### AI Tools

The AI can use these tools during conversation:
- **read_file** — Read file contents
- **write_file** — Create or overwrite files
- **edit_file** — Modify specific parts of files
- **run_script** — Execute RobinPath code
- **list_files** — Explore project structure

### Headless Mode (-p)

The `-p` flag returns just the AI response with no UI, colors, or formatting. Designed for shell scripts, app integration, and piping.

```bash
result=$(robinpath -p "write a CSV parser")
robinpath -p "explain this" | less
robinpath -p "write a slack bot" > bot.rp
```

### Popular Models

| Model | Notes |
|-------|-------|
| `anthropic/claude-sonnet-4-20250514` | Default, recommended |
| `openai/gpt-4o` | |
| `google/gemini-2.5-pro` | |
| `deepseek/deepseek-chat` | Budget-friendly |

---

## repl

Start the RobinPath language REPL for writing and executing RobinPath code interactively.

**Syntax:**
```
robinpath repl
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `help` | Show help |
| `exit` / `quit` | Exit REPL |
| `clear` | Clear screen |
| `..` | List all available commands/modules |
| `.load <file>` | Load and execute a script file |
| `.save <file>` | Save session to file |
| `\` | Line continuation (at end of line) |

Multi-line blocks (`if`, `def`, `for`, `do`) are supported automatically.

---

## snippet

Manage code snippets — create, share, explore, run, and sync RobinPath code snippets with the cloud. Supports partial IDs (e.g., `robinpath snippet get 01KJ8`).

**Syntax:**
```
robinpath snippet <subcommand> [options]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List your saved snippets |
| `create <file\|->` | Create a snippet from a file or stdin |
| `init` | Interactive snippet creation wizard |
| `get <id>` | View a snippet (code + metadata) |
| `update <id>` | Update a snippet's metadata or code |
| `delete <id>` | Delete a snippet (`--force` required) |
| `explore [query]` | Browse public snippets (marketplace) |
| `search <query>` | Search public snippets |
| `star <id>` | Star a snippet |
| `unstar <id>` | Unstar a snippet |
| `fork <id>` | Fork a snippet to your account |
| `publish <id>` | Make public + set status to published |
| `unpublish <id>` | Revert to private draft |
| `copy <id>` | Copy snippet code to clipboard |
| `run <id>` | Fetch and execute (cached locally for 5 min) |
| `pull <id> [file]` | Download snippet code to a local file |
| `push <file> <id>` | Update snippet code from local file |
| `diff <file> <id>` | Compare local file with remote snippet |
| `version <id> <ver>` | Set version (`--changelog=<text>`) |
| `trending` | Browse trending snippets |
| `export [file]` | Export all snippets to JSON |
| `import <file>` | Import snippets from JSON export |

### Common Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--page=<n>` | Page number (default: 1) |
| `--limit=<n>` | Results per page (default: 20) |

### List Flags

| Flag | Description |
|------|-------------|
| `--visibility=<v>` | Filter: public or private |
| `--status=<s>` | Filter: draft, published, or archived |
| `--category=<cat>` | Filter by category |

### Create Flags

| Flag | Description |
|------|-------------|
| `--name=<name>` | Snippet name (defaults to filename) |
| `--description=<desc>` | Description |
| `--visibility=<v>` | public or private (default: private) |
| `--category=<cat>` | Category: forms, notifications, crm, e-commerce, data-processing, auth, ai, webhooks, utilities, other |
| `--tags=<t1,t2>` | Comma-separated tags |
| `--status=<s>` | draft, published, or archived |
| `--license=<lic>` | License (MIT, Apache-2.0, GPL-3.0, etc.) |
| `--version=<ver>` | Version string |
| `--readme=<file>` | Readme from file |

### Get Flags

| Flag | Description |
|------|-------------|
| `--code-only` | Output only the raw code (pipeable) |

### Run Flags

| Flag | Description |
|------|-------------|
| `--no-cache` | Skip local cache, always fetch from network |

### Explore Flags

| Flag | Description |
|------|-------------|
| `--category=<cat>` | Filter by category |
| `--sort=<key>` | Sort: popular, stars, newest, updated |
| `--tags=<t1,t2>` | Filter by tags |

**Examples:**
```bash
robinpath snippet list
robinpath snippet list --visibility=public --status=published
robinpath snippet list contact                          # Search your snippets
robinpath snippet init                                  # Interactive wizard
robinpath snippet create app.rp --name="My Tool" --visibility=public
robinpath snippet create - < script.rp --name="Piped"
robinpath snippet get 01KJ8                             # Partial ID works
robinpath snippet get abc123 --code-only                # Raw code only
robinpath snippet get abc123 --code-only | robinpath    # Pipe to execute
robinpath snippet explore --category=ai --sort=popular
robinpath snippet search "slack notification"
robinpath snippet run abc123                            # Cached for 5 min
robinpath snippet run abc123 --no-cache                 # Force fresh fetch
robinpath snippet pull abc123 my-local.rp
robinpath snippet push updated.rp abc123
robinpath snippet diff app.rp abc123                    # Compare before push
robinpath snippet version abc123 2.0.0 --changelog="Major rewrite"
robinpath snippet trending --limit=10
robinpath snippet export my-backup.json
robinpath snippet import my-backup.json
```

---

## update

Update the RobinPath CLI to the latest version. Re-runs the install script for the current platform.

**Syntax:**
```
robinpath update
```

---

## uninstall

Remove `~/.robinpath/` and clean the PATH entry. Restart your terminal after uninstalling.

**Syntax:**
```
robinpath uninstall
```

---

## Built-in Modules

These modules are available in every script without installation:

| Module | Description |
|--------|-------------|
| `math` | Mathematical operations (add, subtract, multiply, ...) |
| `string` | String manipulation (length, slice, split, ...) |
| `array` | Array operations (push, pop, map, filter, ...) |
| `object` | Object operations (keys, values, merge, ...) |
| `json` | JSON parse/stringify |
| `time` | Time operations (sleep, now, format) |
| `random` | Random number generation (int, float, pick, shuffle) |
| `fetch` | HTTP requests (get, post, put, delete) |
| `test` | Test assertions (assert, assertEqual, assertTrue, ...) |
| `dom` | DOM manipulation (browser only) |

---

## Configuration Paths

| Path | Purpose |
|------|---------|
| `~/.robinpath/bin/` | CLI binary install directory |
| `~/.robinpath/modules/` | Installed modules |
| `~/.robinpath/cache/` | Download cache |
| `~/.robinpath/history` | REPL history |
| `~/.robinpath/auth.json` | Authentication token |
| `~/.robinpath/env` | Environment secrets |

---

## Common Workflows

### Create and run a project
```bash
robinpath init                  # Create project skeleton
robinpath main.rp               # Run the entry file
robinpath test                  # Run tests
```

### Install and use a module
```bash
robinpath search slack          # Find modules
robinpath add @robinpath/slack  # Install
robinpath app.rp                # Use in scripts
robinpath audit                 # Check for updates
```

### Publish a module
```bash
robinpath modules init          # Scaffold module
robinpath login                 # Authenticate
robinpath publish --dry-run     # Preview
robinpath publish               # Upload to registry
robinpath sync                  # Verify published
```

### CI/CD integration
```bash
robinpath check app.rp --json   # Syntax check
robinpath fmt --check .         # Format check
robinpath test --json           # Run tests with JSON output
```

### HTTP server for app integration
```bash
robinpath start -p 8080 -s my-secret
# Then from any app:
curl -X POST http://localhost:8080/v1/execute \
  -H "x-robinpath-session: my-secret" \
  -H "Content-Type: application/json" \
  -d '{"script":"log \"hello from API\""}'
```

### AI-assisted development
```bash
robinpath ai config set-key sk-or-...   # One-time setup
robinpath                                # Start AI session
robinpath -p "write a CSV parser"        # Headless prompt
```

### Snippet sharing
```bash
robinpath snippet create app.rp --name="My Tool" --visibility=public
robinpath snippet publish <id>
robinpath snippet explore --category=ai
robinpath snippet run <id>
```
