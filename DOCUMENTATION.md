# RobinPath CLI — Complete Documentation

> **Version:** 1.44.0
> **Language Version:** 0.30.x
> **Binary names:** `robinpath`, `rp` (shorthand alias)
> **Supported platforms:** Windows, macOS, Linux

---

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start](#2-quick-start)
3. [Script Execution](#3-script-execution)
4. [REPL (Interactive Mode)](#4-repl-interactive-mode)
5. [Code Tools](#5-code-tools)
6. [Module System](#6-module-system)
7. [Project System](#7-project-system)
8. [Environment Secrets](#8-environment-secrets)
9. [System Management](#9-system-management)
10. [Cloud & Authentication](#10-cloud--authentication)
11. [HTTP Server Mode (robinpath start)](#11-http-server-mode-robinpath-start)
12. [System Info (robinpath info)](#12-system-info-robinpath-info)
13. [Native Modules Reference](#13-native-modules-reference)
14. [Integration Guide](#14-integration-guide)
15. [SDK (@robinpath/sdk)](#15-sdk-robinpathsdk)
16. [Configuration Reference](#16-configuration-reference)
17. [Error Handling & Exit Codes](#17-error-handling--exit-codes)
18. [Security](#18-security)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Installation

### macOS / Linux

```bash
curl -fsSL https://dev.robinpath.com/install.sh | bash
```

This downloads the correct binary for your OS and architecture, installs it to `~/.robinpath/bin/`, and configures PATH for bash, zsh, and fish shells.

### Windows

```powershell
irm https://dev.robinpath.com/install.ps1 | iex
```

This downloads the Windows binary, installs it to `%USERPROFILE%\.robinpath\bin\`, creates `robinpath.exe` and `rp.exe`, and adds the directory to your PATH.

### Verify Installation

```bash
robinpath --version
# robinpath v1.44.0 (lang v0.30.0)
```

### Update

```bash
robinpath update
```

### Uninstall

```bash
robinpath uninstall
```

---

## 2. Quick Start

### Run a script

```bash
robinpath app.rp
```

### Run inline code

```bash
robinpath -e 'log "Hello, World!"'
```

### Pipe from stdin

```bash
echo 'log math.add 1 2' | robinpath
```

### Start the interactive REPL

```bash
robinpath
```

### Start the HTTP server

```bash
robinpath start
```

---

## 3. Script Execution

### Running Files

```bash
robinpath script.rp          # Run a .rp file
robinpath script.robin       # Run a .robin file
robinpath script              # Auto-resolves to script.rp or script.robin
```

**Auto-resolution order:**
1. Exact file name (if it exists)
2. `<name>.rp`
3. `<name>.robin`

### Inline Execution

```bash
robinpath -e 'log "hello"'
robinpath --eval 'set $x = math.add 1 2; log $x'
```

### Stdin Piping

```bash
echo 'log "piped"' | robinpath
cat script.rp | robinpath
```

### Watch Mode

```bash
robinpath --watch app.rp
robinpath -w app.rp
```

Re-runs the script automatically when the file changes. Debounced at 200ms. Screen is cleared between runs.

### Global Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--quiet` | `-q` | Suppress non-error output |
| `--verbose` | (none) | Show timing and debug info |
| `--version` | `-v` | Display version and exit |
| `--help` | `-h` | Show help |

### Verbose Mode Output

```bash
robinpath --verbose app.rp
# [verbose] Parsed in 12.5ms, 15 top-level nodes
# ... script output ...
```

---

## 4. REPL (Interactive Mode)

Start by running `robinpath` with no arguments:

```bash
robinpath
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `exit` / `quit` / `.exit` | Exit REPL |
| `help` / `.help` | Show help |
| `clear` / `.clear` | Clear screen |
| `..` | List all available commands and modules |
| `.load <file>` | Load and execute a script file |
| `.save <file>` | Save session history to file |
| `\` (at end of line) | Line continuation |

### Multi-line Support

The REPL automatically detects incomplete blocks (if, def, for, do, together) and shows a `...` continuation prompt:

```
> if $x > 5
...   log "big"
... end
```

### History

- **Location:** `~/.robinpath/history`
- **Limit:** 1000 most recent commands
- **Persistence:** Saved on REPL exit

---

## 5. Code Tools

### `fmt` — Code Formatter

Format RobinPath source code to a canonical style.

```bash
robinpath fmt app.rp              # Print formatted code to stdout
robinpath fmt -w app.rp           # Overwrite file in place
robinpath fmt --write src/        # Format all .rp files in directory
robinpath fmt --check app.rp      # Exit code 1 if not formatted (CI)
robinpath fmt --diff app.rp       # Show unified diff
```

**Normalizations:**
- `set $x as 1` → `$x = 1`
- Standardized indentation
- Blank lines between blocks

### `check` — Syntax Checker

Parse and validate syntax without executing.

```bash
robinpath check app.rp
robinpath check app.rp --json
```

**JSON output:**
```json
// Success
{"ok": true, "file": "app.rp"}

// Error
{"ok": false, "file": "app.rp", "error": "Unexpected token", "line": 5, "column": 3}
```

**Exit codes:** 0 (valid), 2 (syntax error)

### `ast` — AST Dump

Parse script and output Abstract Syntax Tree as JSON.

```bash
robinpath ast app.rp              # Pretty-printed JSON
robinpath ast app.rp --compact    # Minified JSON
```

### `test` — Test Runner

Discover and run `*.test.rp` test files.

```bash
robinpath test                    # Run all tests in current directory
robinpath test tests/             # Run tests in specific directory
robinpath test tests/math.test.rp # Run a single test file
robinpath test --json             # Machine-readable output
```

Each test file runs in an isolated RobinPath instance. Use the `test` module for assertions:

```
test.assert ($value)
test.assertEqual ($actual) ($expected)
test.assertTrue ($condition)
test.assertContains ($array) ($item)
```

**JSON output:**
```json
{
  "passed": 5,
  "failed": 1,
  "total": 6,
  "duration_ms": 42,
  "results": [
    {"file": "math.test.rp", "status": "pass"},
    {"file": "string.test.rp", "status": "fail", "error": "assertEqual: expected 3, got 4"}
  ]
}
```

**Exit codes:** 0 (all pass), 1 (any fail)

---

## 6. Module System

### Installing Modules

```bash
robinpath add @robinpath/slack           # Install latest version
robinpath add @robinpath/slack@1.2.0     # Install specific version
robinpath add @robinpath/slack --force   # Reinstall
```

Modules are installed to `~/.robinpath/modules/<scope>/<name>/`.

### Removing Modules

```bash
robinpath remove @robinpath/slack
```

### Upgrading Modules

```bash
robinpath upgrade @robinpath/slack       # Upgrade single module
robinpath modules upgrade                # Upgrade all modules
```

### Listing Installed Modules

```bash
robinpath modules list
```

### Searching the Registry

```bash
robinpath search slack
robinpath search --category=api slack
```

**Categories:** api, messaging, crm, ai, database, storage, analytics, dev-tools, utilities

### Module Info

```bash
robinpath info @robinpath/slack
```

### Auditing Modules

```bash
robinpath audit
```

Checks installed modules for deprecated status, outdated versions, and registry accessibility.

### Scaffolding a New Module

```bash
robinpath modules init
```

Interactive wizard that creates:
- `package.json` with RobinPath metadata
- `src/index.ts` (entry point)
- `src/<name>.ts` (implementation)
- `tests/<name>.test.rp` (test template)
- `tsconfig.json`, `README.md`, `.gitignore`

### Module Adapter Interface

Every module exports this structure:

```javascript
export default {
  name: 'mymodule',
  functions: {
    greet: (args) => `Hello ${args[0]}!`,
    add: (args) => Number(args[0]) + Number(args[1]),
  },
  functionMetadata: {
    greet: {
      description: 'Greet someone',
      parameters: [
        { name: 'name', dataType: 'string', required: true }
      ],
      returnType: 'string',
      example: 'mymodule.greet "World"'
    },
  },
  moduleMetadata: {
    description: 'My custom module',
    methods: ['greet', 'add']
  },
  global: false  // if true, functions available without module prefix
};
```

### Module File Structure

```
~/.robinpath/modules/@scope/name/
├── package.json
├── dist/
│   └── index.js       (entry point, loaded at runtime)
├── src/
│   └── index.ts       (source, auto-compiled if dist/ missing)
├── tests/
│   └── name.test.rp
└── README.md
```

### Module Manifest

Located at `~/.robinpath/modules/modules.json`:

```json
{
  "@robinpath/slack": {
    "version": "1.2.0",
    "integrity": "sha256-abc123...",
    "installedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

### Dependency Resolution

Modules can declare dependencies in `package.json`:

```json
{
  "robinpath": {
    "depends": {
      "@robinpath/http-utils": "^1.0.0"
    }
  }
}
```

Dependencies are automatically installed when the parent module is installed.

---

## 7. Project System

### Creating a Project

```bash
robinpath init
robinpath init --force   # Overwrite existing
```

Creates:
- `robinpath.json` — Project configuration
- `main.rp` — Entry script
- `.env` — Environment variables
- `.gitignore` — Git ignore patterns

### `robinpath.json` Schema

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "description": "My automation project",
  "author": "user@example.com",
  "main": "main.rp",
  "modules": {
    "@robinpath/slack": "^1.2.0",
    "@robinpath/csv": "^0.5.0"
  },
  "env": {}
}
```

### Installing Project Dependencies

```bash
robinpath install
```

Reads `robinpath.json`, installs all declared modules, and generates `robinpath-lock.json` with integrity hashes.

### Lock File (`robinpath-lock.json`)

```json
{
  "@robinpath/slack": {
    "version": "1.2.0",
    "integrity": "sha256-abc123..."
  }
}
```

---

## 8. Environment Secrets

Manage secrets stored at `~/.robinpath/env`.

```bash
robinpath env set API_KEY sk-abc123     # Set a secret
robinpath env list                       # List all (values masked)
robinpath env remove API_KEY             # Remove a secret
```

**File format:** `KEY=VALUE`, one per line, with comment support (`#`).
**Permissions:** Unix 0o600 (owner-read-write only).
**Masking:** Values shown as `sk****23` in `env list`.

---

## 9. System Management

### Install to System PATH

```bash
robinpath install
```

Copies the binary to `~/.robinpath/bin/` and adds it to your system PATH.

### Uninstall

```bash
robinpath uninstall
```

Removes `~/.robinpath/` and PATH entries.

### Update

```bash
robinpath update
```

Downloads and installs the latest version from GitHub releases.

### Diagnostics

```bash
robinpath doctor
```

Checks:
- CLI version and language version
- Installation directory
- Authentication status and expiry
- Installed modules validity
- Project config presence
- Missing project modules
- Cache stats

### Cache Management

```bash
robinpath cache list     # Show cached tarballs with sizes
robinpath cache clean    # Clear all cached downloads
```

Cache location: `~/.robinpath/cache/`

---

## 10. Cloud & Authentication

### Login

```bash
robinpath login
```

1. Opens browser to the RobinPath Cloud login page
2. Shows a verification code (e.g., `ROBIN-A7F3`)
3. After confirming in the browser, stores token locally
4. Token saved to `~/.robinpath/auth.json` (permissions: 0o600)
5. Timeout: 5 minutes

### Logout

```bash
robinpath logout
```

Deletes `~/.robinpath/auth.json`.

### Check Login Status

```bash
robinpath whoami
```

Shows email, name, token expiry, and (if server is reachable) username, tier, and role.

### Publishing a Module

```bash
robinpath publish                       # Publish current directory
robinpath publish ./my-module           # Publish specific directory
robinpath publish --private             # Publish as private
robinpath publish --org myteam          # Publish to organization
robinpath publish --minor              # Auto-bump minor version
robinpath publish --dry-run            # Validate without uploading
```

Version bump flags: `--patch`, `--minor`, `--major`

### Creating a Tarball

```bash
robinpath pack                # Create tarball without publishing
robinpath pack ./my-module
```

### Deprecating a Module

```bash
robinpath deprecate @scope/name "Use @scope/name-v2 instead"
```

### Listing Your Published Modules

```bash
robinpath sync
```

---

## 11. HTTP Server Mode (`robinpath start`)

Start an HTTP server that exposes the RobinPath engine over REST API. Designed for integration with external applications (desktop apps, web backends, CI/CD pipelines, other languages).

### Starting the Server

```bash
robinpath start                                    # Default: port 6372, auto-generated session
robinpath start -p 8080                            # Custom port
robinpath start -s my-secret-token                 # Custom session secret
robinpath start -p 8080 -s my-secret --host 0.0.0.0   # Bind to all interfaces
robinpath start --timeout 60000                    # 60s script timeout
robinpath start --max-concurrent 10                # 10 parallel jobs
robinpath start --log-file /var/log/rp.jsonl       # Enable file logging
robinpath start --cors-origin https://myapp.com    # Restrict CORS
```

### Server Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port` | `6372` | Port to listen on |
| `-s, --session` | auto-generated UUID | Session secret (gatekeeper) |
| `--host` | `127.0.0.1` | Bind address |
| `--timeout` | `30000` | Max script execution time in ms |
| `--max-concurrent` | `5` | Max parallel jobs |
| `--cors-origin` | `*` | CORS allowed origin |
| `--log-file` | (none) | JSON log file path |
| `--max-body` | `5000000` | Max request body size in bytes |

### Startup Output

The server prints a single JSON line on startup:

```json
{"ok": true, "port": 6372, "host": "127.0.0.1", "session": "a1b2c3d4-...", "version": "1.44.0"}
```

Parse this to get the session token and confirm the server is ready.

If the port is unavailable:

```json
{"ok": false, "error": "Port 6372 is already in use"}
```

### Checking Server Status

```bash
robinpath status                 # Check default port 6372
robinpath status -p 8080         # Check specific port
```

Returns JSON:
```json
{"ok": true, "running": true, "port": 6372, "pid": "12345", "version": "1.44.0"}
```

### Stopping the Server

```bash
# Via HTTP
curl -X POST http://127.0.0.1:6372/v1/stop -H "x-robinpath-session: <token>"

# Via signals
# SIGINT (Ctrl+C) or SIGTERM — waits up to 10s for active jobs
```

### PID File

Created at `~/.robinpath/server-<port>.pid` when the server starts. Removed on clean shutdown.

---

### API Reference

All endpoints (except `/v1/health`) require the `x-robinpath-session` header.

#### Authentication

Every request must include:

```
x-robinpath-session: <session-token>
```

The session token is printed when the server starts. Requests without a valid session receive `401 Unauthorized`.

---

#### `GET /v1/health`

Health check. **No authentication required.**

```bash
curl http://127.0.0.1:6372/v1/health
```

**Response:**
```json
{
  "ok": true,
  "version": "1.44.0",
  "uptime_ms": 12345
}
```

---

#### `POST /v1/execute`

Execute a RobinPath script.

**Request (JSON):**
```bash
curl -X POST http://127.0.0.1:6372/v1/execute \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"code": "set $x = math.add 1 2\nlog $x"}'
```

**Request (plain text — paste code directly):**
```bash
curl -X POST http://127.0.0.1:6372/v1/execute \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: text/plain" \
  -d 'set $x = math.add 1 2
log $x'
```

**Synchronous response:**
```json
{
  "ok": true,
  "jobId": "abc-123",
  "status": "completed",
  "output": "3\n",
  "duration": 12,
  "requestId": "req-456"
}
```

**SSE streaming (add `Accept: text/event-stream`):**
```bash
curl -N http://127.0.0.1:6372/v1/execute \
  -H "x-robinpath-session: <token>" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"code": "log 1\ntime.sleep 1000\nlog 2"}'
```

**SSE events:**
```
event: started
data: {"timestamp": "2025-01-15T10:30:00.000Z"}

event: output
data: {"chunk": "1"}

event: output
data: {"chunk": "2"}

event: completed
data: {"result": null, "duration": 1012}

event: done
data: null
```

**Webhook callback (fire-and-forget, returns 202):**
```bash
curl -X POST http://127.0.0.1:6372/v1/execute \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "log \"processing...\"",
    "webhook": "https://myapp.com/rp-callback",
    "webhook_secret": "whsec_my_secret"
  }'
```

Response:
```json
{"ok": true, "jobId": "abc-123", "status": "running", "message": "Webhook will fire on completion"}
```

The webhook receives a POST with the job result. If `webhook_secret` is provided, the payload is signed:
```
X-Webhook-Signature: sha256=<hmac-hex>
```

**Dry run (validate without executing):**
```bash
curl -X POST http://127.0.0.1:6372/v1/execute?dry=true \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"code": "log 1"}'
```

---

#### `POST /v1/execute/file`

Execute a script file by path.

```bash
curl -X POST http://127.0.0.1:6372/v1/execute/file \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"file": "/path/to/script.rp"}'
```

Same response format and streaming/webhook support as `/v1/execute`.

---

#### `POST /v1/check`

Syntax check without executing.

```bash
curl -X POST http://127.0.0.1:6372/v1/check \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"script": "log \"hello\""}'
```

**Response (valid):**
```json
{"ok": true, "message": "No syntax errors"}
```

**Response (error):**
```json
{"ok": false, "error": {"message": "Unexpected token at line 3", "line": 3, "column": 5}}
```

---

#### `POST /v1/fmt`

Format code.

```bash
curl -X POST http://127.0.0.1:6372/v1/fmt \
  -H "x-robinpath-session: <token>" \
  -H "Content-Type: application/json" \
  -d '{"script": "set  $x  as   1\nlog   $x"}'
```

**Response:**
```json
{"ok": true, "formatted": "$x = 1\nlog $x\n"}
```

---

#### `GET /v1/jobs`

List all jobs.

```bash
curl http://127.0.0.1:6372/v1/jobs \
  -H "x-robinpath-session: <token>"

# With filters
curl "http://127.0.0.1:6372/v1/jobs?status=running&limit=10" \
  -H "x-robinpath-session: <token>"
```

**Response:**
```json
{
  "ok": true,
  "jobs": [
    {
      "id": "abc-123",
      "status": "completed",
      "script": "log 1",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "startedAt": "2025-01-15T10:30:00.001Z",
      "completedAt": "2025-01-15T10:30:00.015Z",
      "duration": 14,
      "output": "1\n",
      "error": null
    }
  ]
}
```

---

#### `GET /v1/jobs/:id`

Get details of a specific job.

```bash
curl http://127.0.0.1:6372/v1/jobs/abc-123 \
  -H "x-robinpath-session: <token>"
```

---

#### `GET /v1/jobs/:id/stream`

Subscribe to real-time job progress via SSE.

```bash
curl -N http://127.0.0.1:6372/v1/jobs/abc-123/stream \
  -H "x-robinpath-session: <token>" \
  -H "Accept: text/event-stream"
```

If the job is already completed/failed/cancelled, returns the final status and closes. If running, streams live updates until completion.

---

#### `POST /v1/jobs/:id/cancel`

Cancel a running job.

```bash
curl -X POST http://127.0.0.1:6372/v1/jobs/abc-123/cancel \
  -H "x-robinpath-session: <token>"
```

**Response:**
```json
{"ok": true, "jobId": "abc-123", "status": "cancelled"}
```

**Error (not running):** `409 Conflict`
**Error (not found):** `404 Not Found`

---

#### `GET /v1/modules`

List all loaded modules and their functions.

```bash
curl http://127.0.0.1:6372/v1/modules \
  -H "x-robinpath-session: <token>"
```

---

#### `GET /v1/info`

Server runtime information.

```bash
curl http://127.0.0.1:6372/v1/info \
  -H "x-robinpath-session: <token>"
```

**Response:**
```json
{
  "ok": true,
  "version": "1.44.0",
  "lang_version": "0.30.0",
  "host": "127.0.0.1",
  "port": 6372,
  "uptime_seconds": 123,
  "started_at": "2025-01-15T10:30:00.000Z",
  "config": {
    "max_concurrent": 5,
    "job_timeout_ms": 30000,
    "rate_limit": 100
  },
  "memory": {
    "heap_used": 1234567,
    "heap_total": 2345678,
    "rss": 3456789
  },
  "jobs": {
    "total": 10,
    "active": 2
  }
}
```

---

#### `GET /v1/metrics`

Prometheus-style plain text metrics.

```bash
curl http://127.0.0.1:6372/v1/metrics \
  -H "x-robinpath-session: <token>"
```

**Response:**
```
robinpath_jobs_total 10
robinpath_jobs_active 2
robinpath_jobs_completed 7
robinpath_jobs_failed 1
robinpath_jobs_cancelled 0
robinpath_request_duration_avg_ms 123
robinpath_uptime_seconds 456
robinpath_memory_heap_bytes 1234567
robinpath_memory_rss_bytes 2345678
robinpath_requests_total 100
robinpath_requests_errors 5
```

---

#### `GET /v1/openapi.json`

OpenAPI 3.1 specification. Built once at startup.

```bash
curl http://127.0.0.1:6372/v1/openapi.json \
  -H "x-robinpath-session: <token>"
```

---

#### `POST /v1/stop`

Graceful server shutdown.

```bash
curl -X POST http://127.0.0.1:6372/v1/stop \
  -H "x-robinpath-session: <token>"
```

**Response:**
```json
{"ok": true, "message": "Server stopping", "active_jobs": []}
```

Waits up to 5 seconds for active jobs to complete before shutting down.

---

### Request/Response Headers

#### Required Headers

| Header | Description |
|--------|-------------|
| `x-robinpath-session` | Session token (all endpoints except `/v1/health`) |

#### Optional Request Headers

| Header | Description |
|--------|-------------|
| `x-request-id` | Client request ID (auto-generated UUID if missing) |
| `x-idempotency-key` | Prevents duplicate execution on retry (5-minute TTL) |
| `Accept: text/event-stream` | Request SSE streaming for `/v1/execute` and `/v1/jobs/:id/stream` |
| `Content-Type: text/plain` | Send raw code in request body (no JSON wrapping needed) |
| `Content-Type: application/json` | Send JSON body |

#### Response Headers

| Header | Description |
|--------|-------------|
| `x-processing-ms` | Time to process request (milliseconds) |
| `x-request-id` | Echo of request ID |
| `x-rate-limit-limit` | Rate limit quota |
| `x-rate-limit-remaining` | Requests remaining in window |
| `x-rate-limit-reset` | Timestamp when limit resets |

### Error Response Format

All errors follow this structure:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  },
  "requestId": "request-uuid"
}
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `running` | Job is currently executing |
| `completed` | Job finished successfully |
| `failed` | Job encountered an error |
| `cancelled` | Job was cancelled by client |

### Server Features Summary

| Feature | Description |
|---------|-------------|
| Session gatekeeper | All requests require `x-robinpath-session` header |
| API versioning | All paths prefixed with `/v1/` (legacy paths also supported) |
| SSE streaming | Real-time progress via Server-Sent Events |
| Webhook callbacks | Fire-and-forget with HMAC-SHA256 signatures |
| Idempotency keys | Prevent duplicate execution on retries |
| Rate limiting | Sliding window, configurable |
| Job management | Queue, track, stream, cancel jobs |
| Structured logging | JSONL log file support |
| Prometheus metrics | `/v1/metrics` endpoint |
| OpenAPI spec | `/v1/openapi.json` auto-generated |
| Graceful shutdown | Signal handling, waits for active jobs |
| Persistent runtime | Variables persist across requests (conversational) |
| Plain text body | Paste code directly without JSON escaping |
| PID file | `~/.robinpath/server-<port>.pid` for process detection |

---

## 12. System Info (`robinpath info`)

### No Arguments — System Info

```bash
robinpath info              # Human-friendly format
robinpath info --json       # Machine-readable JSON
```

**Human-friendly output:**
```
RobinPath v1.44.0 (lang v0.30.0)

  Platform:     win32 (x64)
  Node:         v22.20.0
  Executable:   C:\Users\user\.robinpath\bin\robinpath.exe

Paths:
  Home:         C:\Users\user\.robinpath
  Binary:       C:\Users\user\.robinpath\bin
  Modules:      C:\Users\user\.robinpath\modules
  Manifest:     C:\Users\user\.robinpath\modules\modules.json
  Cache:        C:\Users\user\.robinpath\cache
  Auth:         C:\Users\user\.robinpath\auth.json
  History:      C:\Users\user\.robinpath\history
  Env:          C:\Users\user\.robinpath\env
```

**JSON output:**
```json
{
  "ok": true,
  "version": "1.44.0",
  "lang_version": "0.30.0",
  "platform": "win32",
  "arch": "x64",
  "node_version": "v22.20.0",
  "executable": "C:\\Users\\user\\.robinpath\\bin\\robinpath.exe",
  "pid": 12345,
  "paths": {
    "home": "C:\\Users\\user\\.robinpath",
    "bin": "C:\\Users\\user\\.robinpath\\bin",
    "modules": "C:\\Users\\user\\.robinpath\\modules",
    "modules_manifest": "C:\\Users\\user\\.robinpath\\modules\\modules.json",
    "cache": "C:\\Users\\user\\.robinpath\\cache",
    "auth": "C:\\Users\\user\\.robinpath\\auth.json",
    "history": "C:\\Users\\user\\.robinpath\\history",
    "env": "C:\\Users\\user\\.robinpath\\env"
  }
}
```

Use `robinpath info --json` for external tools that need to discover where RobinPath lives.

### With Package Argument — Module Info

```bash
robinpath info @robinpath/slack
```

Shows registry details: name, version, description, author, license, downloads, visibility, keywords, and local install status.

---

## 13. Native Modules Reference

These modules are bundled directly into the CLI binary. Always available, zero installation required.

### `file` — File System Operations
```
file.read <path> [encoding]      Read file contents (default: utf-8)
file.readBinary <path>           Read file as binary buffer
file.write <path> <content>      Write content to file
file.writeBinary <path> <buffer> Write binary data to file
file.append <path> <content>     Append to file
file.delete <path>               Delete a file
file.exists <path>               Check if file exists (returns boolean)
file.copy <src> <dest>           Copy file
file.move <src> <dest>           Move/rename file
file.rename <old> <new>          Rename file
file.list <dir>                  List directory contents
file.stat <path>                 Get file stats (size, created, modified)
file.mkdir <path>                Create directory (recursive)
file.readJSON <path>             Read and parse JSON file
file.writeJSON <path> <data>     Write data as JSON file
file.size <path>                 Get file size in bytes
file.isFile <path>               Check if path is a file
file.isDir <path>                Check if path is a directory
file.lines <path>                Read file as array of lines
file.lineCount <path>            Count lines in file
file.temp [prefix]               Create temporary file, return path
file.cwd                         Get current working directory
```

### `path` — Path Manipulation
```
path.join <...parts>             Join path segments
path.resolve <...parts>         Resolve to absolute path
path.dirname <path>              Get directory name
path.basename <path>             Get file name
path.extname <path>              Get file extension
path.parse <path>                Parse into {root, dir, base, ext, name}
path.format <obj>                Format path object to string
path.relative <from> <to>        Get relative path
path.normalize <path>            Normalize path separators
path.isAbsolute <path>           Check if path is absolute
path.sep                         Platform path separator
path.delimiter                   Platform PATH delimiter
path.toNamespacedPath <path>     Convert to namespace path (Windows)
```

### `process` — Process Information
```
process.env [key]                Get environment variable(s)
process.argv                     Get command-line arguments
process.exit [code]              Exit with code (default: 0)
process.cwd                      Current working directory
process.chdir <dir>              Change working directory
process.pid                      Process ID
process.ppid                     Parent process ID
process.platform                 OS platform (win32, darwin, linux)
process.arch                     CPU architecture (x64, arm64)
process.version                  Node.js version
process.versions                 All version strings
process.memoryUsage              Memory usage stats
process.uptime                   Process uptime in seconds
process.hrtime                   High-resolution time
process.title                    Process title
process.execPath                 Path to executable
process.cpuUsage                 CPU usage stats
process.resourceUsage            Resource usage stats
```

### `os` — Operating System Information
```
os.hostname                      Machine hostname
os.cpus                          CPU info array
os.cpuCount                      Number of CPU cores
os.totalmem                      Total memory in bytes
os.freemem                       Free memory in bytes
os.usedmem                       Used memory in bytes
os.memoryInfo                    Detailed memory info
os.networkInterfaces             Network interface info
os.tmpdir                        Temporary directory path
os.homedir                       Home directory path
os.type                          OS type (Windows_NT, Darwin, Linux)
os.release                       OS release version
os.uptime                        System uptime in seconds
os.loadavg                       Load averages (1, 5, 15 min)
os.userInfo                      Current user info
os.platform                      OS platform
os.arch                          CPU architecture
os.endianness                    Byte order (BE/LE)
os.machine                       Machine type
os.version                       OS version string
os.eol                           Line ending (\n or \r\n)
```

### `crypto` — Cryptography
```
crypto.hash <algo> <data>        Hash data (sha256, sha512, md5, etc.)
crypto.md5 <data>                MD5 hash
crypto.sha1 <data>               SHA-1 hash
crypto.sha256 <data>             SHA-256 hash
crypto.sha512 <data>             SHA-512 hash
crypto.hmac <algo> <key> <data>  HMAC signature
crypto.hmacSha256 <key> <data>   HMAC-SHA256
crypto.hmacSha512 <key> <data>   HMAC-SHA512
crypto.encrypt <algo> <key> <data>  Encrypt data
crypto.decrypt <algo> <key> <data>  Decrypt data
crypto.randomBytes <size>        Random bytes (hex string)
crypto.randomUUID                Generate UUID v4
crypto.randomInt [min] <max>     Random integer
crypto.pbkdf2 <pass> <salt> <iterations> <keylen> <digest>  PBKDF2
crypto.scrypt <pass> <salt> <keylen>  Scrypt key derivation
crypto.base64Encode <data>       Base64 encode
crypto.base64Decode <data>       Base64 decode
crypto.base64UrlEncode <data>    Base64url encode
crypto.base64UrlDecode <data>    Base64url decode
crypto.hexEncode <data>          Hex encode
crypto.hexDecode <data>          Hex decode
crypto.ciphers                   List available ciphers
crypto.hashes                    List available hash algorithms
```

### `buffer` — Binary Data
```
buffer.alloc <size>              Allocate zeroed buffer
buffer.from <data> [encoding]    Create buffer from string/array
buffer.toString <buf> [encoding] Convert buffer to string
buffer.toJSON <buf>              Convert buffer to JSON
buffer.concat <...bufs>          Concatenate buffers
buffer.compare <a> <b>           Compare two buffers
buffer.equals <a> <b>            Check buffer equality
buffer.slice <buf> <start> [end] Slice buffer
buffer.length <buf>              Get buffer length
buffer.byteLength <str> [enc]    Get byte length of string
buffer.isBuffer <val>            Check if value is a buffer
buffer.fill <buf> <value>        Fill buffer with value
buffer.indexOf <buf> <value>     Find value in buffer
buffer.copy <src> <dest>         Copy buffer
buffer.toHex <buf>               Convert to hex string
buffer.fromHex <hex>             Create from hex string
```

### `url` — URL Utilities
```
url.parse <url>                  Parse URL into components
url.format <obj>                 Format URL from components
url.resolve <base> <path>        Resolve URL relative to base
url.searchParams <url>           Get search params as object
url.buildQuery <obj>             Build query string from object
url.encode <str>                 URL encode component
url.decode <str>                 URL decode component
url.encodeFull <str>             URL encode full string
url.decodeFull <str>             URL decode full string
url.isValid <url>                Check if URL is valid
url.join <base> <...parts>       Join URL parts
```

### `child` — Child Processes
```
child.exec <command>             Execute shell command (returns stdout)
child.execSync <command>         Execute synchronously
child.spawn <command> [args]     Spawn process (returns handle ID)
child.wait <id>                  Wait for spawned process to finish
child.kill <id>                  Kill spawned process
child.running <id>               Check if process is still running
```

### `timer` — Timing Operations
```
timer.sleep <ms>                 Sleep for milliseconds
timer.delay <ms>                 Alias for sleep
timer.setTimeout <ms> <callback> Set timeout (returns ID)
timer.setInterval <ms> <callback> Set interval (returns ID)
timer.clearTimeout <id>          Clear timeout
timer.clearInterval <id>         Clear interval
timer.clearAll                   Clear all timers
timer.active                     List active timers
timer.measure <callback>         Measure execution time (returns ms)
timer.timestamp                  Current Unix timestamp (seconds)
timer.now                        Current time in milliseconds
```

### `http` — HTTP Client & Server
```
http.get <url> [headers]         HTTP GET request
http.post <url> <body> [headers] HTTP POST request
http.put <url> <body> [headers]  HTTP PUT request
http.patch <url> <body> [headers] HTTP PATCH request
http.delete <url> [headers]      HTTP DELETE request
http.head <url> [headers]        HTTP HEAD request
http.request <options>           Custom HTTP request
http.serve <port> [handler]      Start HTTP server (returns ID)
http.close <id>                  Close server
http.servers                     List active servers
http.download <url> <path>       Download file to path
```

### `net` — TCP Networking
```
net.connect <host> <port>        Connect TCP socket (returns ID)
net.send <id> <data>             Send data on socket
net.read <id>                    Read data from socket
net.close <id>                   Close socket
net.createServer <port> [handler] Create TCP server (returns ID)
net.isIP <str>                   Check if string is IP address
net.isIPv4 <str>                 Check if IPv4
net.isIPv6 <str>                 Check if IPv6
net.active                       List active connections
```

### `dns` — DNS Resolution
```
dns.lookup <hostname>            Resolve hostname to IP
dns.resolve <hostname>           Resolve hostname (all records)
dns.resolve4 <hostname>          Resolve A records (IPv4)
dns.resolve6 <hostname>          Resolve AAAA records (IPv6)
dns.resolveMx <hostname>         Resolve MX records
dns.resolveTxt <hostname>        Resolve TXT records
dns.resolveNs <hostname>         Resolve NS records
dns.resolveCname <hostname>      Resolve CNAME records
dns.resolveSrv <hostname>        Resolve SRV records
dns.resolveSoa <hostname>        Resolve SOA record
dns.reverse <ip>                 Reverse DNS lookup
```

### `tls` — TLS/SSL
```
tls.connect <host> <port> [options]  TLS connection (returns ID)
tls.send <id> <data>                 Send data on TLS socket
tls.read <id>                        Read data from TLS socket
tls.close <id>                       Close TLS socket
tls.createServer <port> <options>    Create TLS server (returns ID)
tls.getCertificate <id>              Get local certificate
tls.getPeerCertificate <id>          Get peer certificate
tls.isEncrypted <id>                 Check if connection is encrypted
tls.getProtocol <id>                 Get TLS protocol version
tls.getCipher <id>                   Get cipher info
tls.active                           List active TLS connections
```

### `stream` — Streams
```
stream.readable [options]        Create readable stream (returns ID)
stream.writable [options]        Create writable stream (returns ID)
stream.transform [options]       Create transform stream (returns ID)
stream.duplex [options]          Create duplex stream (returns ID)
stream.passThrough               Create passthrough stream (returns ID)
stream.write <id> <data>         Write to stream
stream.read <id>                 Read from stream
stream.end <id>                  End stream
stream.destroy <id>              Destroy stream
stream.pipe <src> <dest>         Pipe source to destination
stream.pipeline <...ids>         Pipeline multiple streams
stream.toBuffer <id>             Collect stream to buffer
stream.toString <id>             Collect stream to string
stream.fromString <str>          Create readable from string
stream.fromArray <arr>           Create readable from array
stream.active                    List active streams
stream.count                     Count active streams
```

### `events` — Event Emitter
```
events.create [name]             Create event emitter (returns ID)
events.on <id> <event> <handler> Listen for event
events.once <id> <event> <handler> Listen once
events.emit <id> <event> [...args] Emit event
events.off <id> <event> [handler] Remove listener
events.listeners <id> <event>    Get listeners for event
events.eventNames <id>           Get all event names
events.removeAll <id> [event]    Remove all listeners
events.destroy <id>              Destroy emitter
events.list                      List active emitters
```

### `zlib` — Compression
```
zlib.gzip <data>                 Gzip compress
zlib.gunzip <data>               Gzip decompress
zlib.deflate <data>              Deflate compress
zlib.inflate <data>              Deflate decompress
zlib.brotliCompress <data>       Brotli compress
zlib.brotliDecompress <data>     Brotli decompress
zlib.compressSize <data> [algo]  Get compressed size without full compress
```

### `assert` — Assertions
```
assert.ok <value>                Assert truthy
assert.equal <a> <b>             Assert loose equality
assert.strictEqual <a> <b>       Assert strict equality
assert.notEqual <a> <b>          Assert not equal
assert.deepEqual <a> <b>         Assert deep equality
assert.notDeepEqual <a> <b>      Assert not deep equal
assert.truthy <value>            Assert truthy
assert.falsy <value>             Assert falsy
assert.isNull <value>            Assert null
assert.isNotNull <value>         Assert not null
assert.isType <value> <type>     Assert type (string, number, etc.)
assert.contains <collection> <item> Assert contains
assert.notContains <coll> <item> Assert does not contain
assert.match <str> <pattern>     Assert regex match
assert.notMatch <str> <pattern>  Assert no regex match
assert.greaterThan <a> <b>       Assert a > b
assert.lessThan <a> <b>          Assert a < b
assert.between <val> <min> <max> Assert min <= val <= max
assert.lengthOf <coll> <len>     Assert collection length
assert.hasProperty <obj> <key>   Assert object has property
assert.throws <callback>         Assert callback throws
assert.doesNotThrow <callback>   Assert callback doesn't throw
assert.fail [message]            Always fail with message
```

### `tty` — Terminal
```
tty.isatty                       Check if stdout is a TTY
tty.isStdinTTY                   Check if stdin is a TTY
tty.isStdoutTTY                  Check if stdout is a TTY
tty.isStderrTTY                  Check if stderr is a TTY
tty.columns                      Terminal width
tty.rows                         Terminal height
tty.size                         Terminal size {columns, rows}
tty.hasColors [count]            Check color support
tty.colorDepth                   Color depth (1, 4, 8, 24)
tty.supportsColor                Boolean color support
tty.getWindowSize                Get window size [columns, rows]
tty.clearLine [dir]              Clear current line
tty.cursorTo <x> [y]             Move cursor to position
tty.moveCursor <dx> <dy>         Move cursor relative
```

### `util` — Utilities
```
util.inspect <value> [options]   Inspect value (like console.dir)
util.format <fmt> [...args]      Format string (printf-like)
util.formatWithOptions <opts> <fmt> [...args]  Format with options
util.isArray <value>             Check if array
util.isBoolean <value>           Check if boolean
util.isNull <value>              Check if null
util.isUndefined <value>         Check if undefined
util.isNullOrUndefined <value>   Check if null or undefined
util.isNumber <value>            Check if number
util.isString <value>            Check if string
util.isObject <value>            Check if object
util.isFunction <value>          Check if function
util.isRegExp <value>            Check if regex
util.isDate <value>              Check if date
util.isError <value>             Check if error
util.isPrimitive <value>         Check if primitive
util.isPromise <value>           Check if promise
util.isMap <value>               Check if Map
util.isSet <value>               Check if Set
util.isTypedArray <value>        Check if typed array
util.isArrayBuffer <value>       Check if ArrayBuffer
util.typeOf <value>              Get type string
util.textEncode <str>            Encode to UTF-8 bytes
util.textDecode <bytes>          Decode UTF-8 bytes
util.deepClone <value>           Deep clone
util.deepEqual <a> <b>           Deep equality check
util.merge <...objs>             Shallow merge objects
util.deepMerge <...objs>         Deep merge objects
util.inherits <ctor> <super>     Prototype inheritance
util.deprecate <fn> <msg>        Wrap function with deprecation warning
util.callbackify <fn>            Convert async function to callback-style
util.sizeof <value>              Estimate memory size in bytes
```

### Built-in Language Modules

These are part of the RobinPath language itself (from `@wiredwp/robinpath`):

```
math      — add, subtract, multiply, divide, mod, power, sqrt, abs, round, floor, ceil, min, max, etc.
string    — length, slice, split, join, replace, trim, toUpperCase, toLowerCase, includes, startsWith, endsWith, repeat, padStart, padEnd, etc.
array     — create, push, pop, shift, unshift, map, filter, reduce, find, findIndex, includes, sort, reverse, flat, length, etc.
object    — keys, values, entries, merge, has, get, set, delete, freeze, assign, etc.
json      — parse, stringify
time      — sleep, now, format, date, timestamp, etc.
random    — int, float, pick, shuffle, uuid, etc.
fetch     — get, post, put, delete (HTTP requests)
test      — assert, assertEqual, assertTrue, assertFalse, assertContains, etc.
dom       — Browser-only DOM manipulation
```

---

## 14. Integration Guide

### Integration with Rust (e.g., Tauri, Axum, Actix)

RobinPath integrates via the HTTP server (`robinpath start`).

#### 1. Spawn the server from Rust

```rust
use std::process::{Command, Stdio};
use serde::Deserialize;

#[derive(Deserialize)]
struct ServerStartup {
    ok: bool,
    port: u16,
    session: String,
    version: String,
    error: Option<String>,
}

fn start_robinpath(port: u16) -> Result<(std::process::Child, String), String> {
    let mut child = Command::new("robinpath")
        .args(["start", "-p", &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn robinpath: {}", e))?;

    // Read the first line of stdout to get the startup JSON
    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = std::io::BufReader::new(stdout);
    let mut line = String::new();
    std::io::BufRead::read_line(&mut reader, &mut line)
        .map_err(|e| format!("Failed to read startup output: {}", e))?;

    let startup: ServerStartup = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse startup JSON: {}", e))?;

    if !startup.ok {
        return Err(startup.error.unwrap_or("Unknown error".to_string()));
    }

    Ok((child, startup.session))
}
```

#### 2. Create a client

```rust
use reqwest::Client;
use serde_json::{json, Value};

struct RobinPathClient {
    client: Client,
    base_url: String,
    session: String,
}

impl RobinPathClient {
    fn new(port: u16, session: String) -> Self {
        Self {
            client: Client::new(),
            base_url: format!("http://127.0.0.1:{}", port),
            session,
        }
    }

    async fn health(&self) -> Result<Value, reqwest::Error> {
        self.client.get(format!("{}/v1/health", self.base_url))
            .send().await?
            .json().await
    }

    async fn execute(&self, code: &str) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/execute", self.base_url))
            .header("x-robinpath-session", &self.session)
            .json(&json!({"code": code}))
            .send().await?
            .json().await
    }

    async fn execute_file(&self, path: &str) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/execute/file", self.base_url))
            .header("x-robinpath-session", &self.session)
            .json(&json!({"file": path}))
            .send().await?
            .json().await
    }

    async fn check(&self, script: &str) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/check", self.base_url))
            .header("x-robinpath-session", &self.session)
            .json(&json!({"script": script}))
            .send().await?
            .json().await
    }

    async fn format(&self, script: &str) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/fmt", self.base_url))
            .header("x-robinpath-session", &self.session)
            .json(&json!({"script": script}))
            .send().await?
            .json().await
    }

    async fn jobs(&self) -> Result<Value, reqwest::Error> {
        self.client.get(format!("{}/v1/jobs", self.base_url))
            .header("x-robinpath-session", &self.session)
            .send().await?
            .json().await
    }

    async fn cancel_job(&self, job_id: &str) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/jobs/{}/cancel", self.base_url, job_id))
            .header("x-robinpath-session", &self.session)
            .send().await?
            .json().await
    }

    async fn modules(&self) -> Result<Value, reqwest::Error> {
        self.client.get(format!("{}/v1/modules", self.base_url))
            .header("x-robinpath-session", &self.session)
            .send().await?
            .json().await
    }

    async fn stop(&self) -> Result<Value, reqwest::Error> {
        self.client.post(format!("{}/v1/stop", self.base_url))
            .header("x-robinpath-session", &self.session)
            .send().await?
            .json().await
    }
}
```

#### 3. Full lifecycle example

```rust
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Start server
    let (mut child, session) = start_robinpath(6372)?;
    let client = RobinPathClient::new(6372, session);

    // Wait for server to be ready
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Health check
    let health = client.health().await?;
    println!("Health: {}", health);

    // Execute scripts
    let result = client.execute("set $x = math.add 1 2\nlog $x").await?;
    println!("Result: {}", result);

    // Execute a file
    let result = client.execute_file("./scripts/process.rp").await?;
    println!("File result: {}", result);

    // List modules
    let modules = client.modules().await?;
    println!("Modules: {}", modules);

    // Stop server
    client.stop().await?;
    child.wait()?;

    Ok(())
}
```

---

### Integration with Python

```python
import subprocess
import json
import requests
import time

class RobinPath:
    def __init__(self, port=6372):
        self.port = port
        self.base_url = f"http://127.0.0.1:{port}"
        self.session = None
        self.process = None

    def start(self):
        """Start the RobinPath server."""
        self.process = subprocess.Popen(
            ["robinpath", "start", "-p", str(self.port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        # Read startup line
        line = self.process.stdout.readline()
        startup = json.loads(line)
        if not startup.get("ok"):
            raise RuntimeError(startup.get("error", "Failed to start"))
        self.session = startup["session"]
        return self

    def _headers(self):
        return {"x-robinpath-session": self.session}

    def health(self):
        return requests.get(f"{self.base_url}/v1/health").json()

    def execute(self, code):
        return requests.post(
            f"{self.base_url}/v1/execute",
            headers=self._headers(),
            json={"code": code}
        ).json()

    def execute_file(self, path):
        return requests.post(
            f"{self.base_url}/v1/execute/file",
            headers=self._headers(),
            json={"file": path}
        ).json()

    def check(self, script):
        return requests.post(
            f"{self.base_url}/v1/check",
            headers=self._headers(),
            json={"script": script}
        ).json()

    def format(self, script):
        return requests.post(
            f"{self.base_url}/v1/fmt",
            headers=self._headers(),
            json={"script": script}
        ).json()

    def jobs(self, status=None):
        params = {"status": status} if status else {}
        return requests.get(
            f"{self.base_url}/v1/jobs",
            headers=self._headers(),
            params=params
        ).json()

    def cancel_job(self, job_id):
        return requests.post(
            f"{self.base_url}/v1/jobs/{job_id}/cancel",
            headers=self._headers()
        ).json()

    def modules(self):
        return requests.get(
            f"{self.base_url}/v1/modules",
            headers=self._headers()
        ).json()

    def info(self):
        return requests.get(
            f"{self.base_url}/v1/info",
            headers=self._headers()
        ).json()

    def stop(self):
        result = requests.post(
            f"{self.base_url}/v1/stop",
            headers=self._headers()
        ).json()
        if self.process:
            self.process.wait(timeout=10)
        return result

    def __enter__(self):
        return self.start()

    def __exit__(self, *args):
        self.stop()


# Usage
with RobinPath(port=6372) as rp:
    print(rp.health())
    print(rp.execute('set $x = math.add 1 2\nlog $x'))
    print(rp.execute_file('./scripts/process.rp'))
    print(rp.modules())
```

---

### Integration with Go

```go
package robinpath

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"time"
)

type Client struct {
	BaseURL string
	Session string
	Port    int
	cmd     *exec.Cmd
}

type StartupResponse struct {
	OK      bool   `json:"ok"`
	Port    int    `json:"port"`
	Session string `json:"session"`
	Version string `json:"version"`
	Error   string `json:"error,omitempty"`
}

type ExecuteResponse struct {
	OK        bool   `json:"ok"`
	JobID     string `json:"jobId,omitempty"`
	Status    string `json:"status,omitempty"`
	Output    string `json:"output,omitempty"`
	Duration  int    `json:"duration,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	Error     *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func Start(port int) (*Client, error) {
	cmd := exec.Command("robinpath", "start", "-p", fmt.Sprintf("%d", port))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Scan()

	var startup StartupResponse
	if err := json.Unmarshal(scanner.Bytes(), &startup); err != nil {
		return nil, err
	}
	if !startup.OK {
		return nil, fmt.Errorf("failed to start: %s", startup.Error)
	}

	return &Client{
		BaseURL: fmt.Sprintf("http://127.0.0.1:%d", port),
		Session: startup.Session,
		Port:    port,
		cmd:     cmd,
	}, nil
}

func (c *Client) Execute(code string) (*ExecuteResponse, error) {
	body, _ := json.Marshal(map[string]string{"code": code})
	req, _ := http.NewRequest("POST", c.BaseURL+"/v1/execute", bytes.NewReader(body))
	req.Header.Set("x-robinpath-session", c.Session)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result ExecuteResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func (c *Client) Stop() error {
	req, _ := http.NewRequest("POST", c.BaseURL+"/v1/stop", nil)
	req.Header.Set("x-robinpath-session", c.Session)
	http.DefaultClient.Do(req)
	return c.cmd.Wait()
}

// Usage:
// client, err := robinpath.Start(6372)
// defer client.Stop()
// result, err := client.Execute("log math.add 1 2")
// fmt.Println(result.Output)
```

---

### Integration with PHP

```php
<?php

class RobinPath {
    private string $baseUrl;
    private string $session;
    private $process;

    public function __construct(int $port = 6372) {
        $this->baseUrl = "http://127.0.0.1:{$port}";
    }

    public function start(): self {
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $this->process = proc_open(
            "robinpath start -p " . parse_url($this->baseUrl, PHP_URL_PORT),
            $descriptors,
            $pipes
        );
        $line = fgets($pipes[1]);
        $startup = json_decode($line, true);
        if (!$startup['ok']) {
            throw new RuntimeException($startup['error'] ?? 'Failed to start');
        }
        $this->session = $startup['session'];
        return $this;
    }

    public function execute(string $code): array {
        return $this->post('/v1/execute', ['code' => $code]);
    }

    public function executeFile(string $path): array {
        return $this->post('/v1/execute/file', ['file' => $path]);
    }

    public function check(string $script): array {
        return $this->post('/v1/check', ['script' => $script]);
    }

    public function format(string $script): array {
        return $this->post('/v1/fmt', ['script' => $script]);
    }

    public function jobs(): array {
        return $this->get('/v1/jobs');
    }

    public function modules(): array {
        return $this->get('/v1/modules');
    }

    public function stop(): array {
        $result = $this->post('/v1/stop', []);
        if ($this->process) {
            proc_close($this->process);
        }
        return $result;
    }

    private function get(string $path): array {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'x-robinpath-session: ' . $this->session,
        ]);
        $response = curl_exec($ch);
        curl_close($ch);
        return json_decode($response, true);
    }

    private function post(string $path, array $data): array {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'x-robinpath-session: ' . $this->session,
            'Content-Type: application/json',
        ]);
        $response = curl_exec($ch);
        curl_close($ch);
        return json_decode($response, true);
    }
}

// Usage:
// $rp = (new RobinPath(6372))->start();
// $result = $rp->execute('set $x = math.add 1 2\nlog $x');
// echo $result['output'];
// $rp->stop();
```

---

### Integration with Ruby

```ruby
require 'net/http'
require 'json'
require 'open3'

class RobinPath
  attr_reader :session, :port

  def initialize(port: 6372)
    @port = port
    @base_url = "http://127.0.0.1:#{port}"
  end

  def start
    @stdin, @stdout, @stderr, @wait_thr = Open3.popen3("robinpath", "start", "-p", @port.to_s)
    line = @stdout.gets
    startup = JSON.parse(line)
    raise startup['error'] || 'Failed to start' unless startup['ok']
    @session = startup['session']
    self
  end

  def execute(code)
    post('/v1/execute', { code: code })
  end

  def execute_file(path)
    post('/v1/execute/file', { file: path })
  end

  def check(script)
    post('/v1/check', { script: script })
  end

  def format(script)
    post('/v1/fmt', { script: script })
  end

  def jobs
    get('/v1/jobs')
  end

  def modules
    get('/v1/modules')
  end

  def stop
    result = post('/v1/stop', {})
    @wait_thr&.join
    result
  end

  private

  def get(path)
    uri = URI("#{@base_url}#{path}")
    req = Net::HTTP::Get.new(uri)
    req['x-robinpath-session'] = @session
    res = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }
    JSON.parse(res.body)
  end

  def post(path, body)
    uri = URI("#{@base_url}#{path}")
    req = Net::HTTP::Post.new(uri, 'Content-Type' => 'application/json')
    req['x-robinpath-session'] = @session
    req.body = body.to_json
    res = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }
    JSON.parse(res.body)
  end
end

# Usage:
# rp = RobinPath.new(port: 6372).start
# puts rp.execute('set $x = math.add 1 2\nlog $x')
# rp.stop
```

---

### Integration with C# / .NET

```csharp
using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;

public class RobinPathClient : IDisposable
{
    private readonly HttpClient _http = new();
    private readonly string _baseUrl;
    private readonly string _session;
    private Process? _process;

    public RobinPathClient(string baseUrl, string session)
    {
        _baseUrl = baseUrl;
        _session = session;
        _http.DefaultRequestHeaders.Add("x-robinpath-session", session);
    }

    public static async Task<RobinPathClient> Start(int port = 6372)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "robinpath",
                Arguments = $"start -p {port}",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };
        process.Start();

        var line = await process.StandardOutput.ReadLineAsync();
        var startup = JsonSerializer.Deserialize<JsonElement>(line!);

        if (!startup.GetProperty("ok").GetBoolean())
            throw new Exception(startup.GetProperty("error").GetString());

        var session = startup.GetProperty("session").GetString()!;
        var client = new RobinPathClient($"http://127.0.0.1:{port}", session);
        client._process = process;
        return client;
    }

    public async Task<JsonElement> Execute(string code)
    {
        var body = JsonSerializer.Serialize(new { code });
        var response = await _http.PostAsync($"{_baseUrl}/v1/execute",
            new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    public async Task<JsonElement> ExecuteFile(string path)
    {
        var body = JsonSerializer.Serialize(new { file = path });
        var response = await _http.PostAsync($"{_baseUrl}/v1/execute/file",
            new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    public async Task Stop()
    {
        await _http.PostAsync($"{_baseUrl}/v1/stop", null);
        _process?.WaitForExit(10000);
    }

    public void Dispose()
    {
        _process?.Kill();
        _process?.Dispose();
        _http.Dispose();
    }
}

// Usage:
// await using var rp = await RobinPathClient.Start(6372);
// var result = await rp.Execute("set $x = math.add 1 2\nlog $x");
// Console.WriteLine(result);
// await rp.Stop();
```

---

### Integration with Java / Kotlin

```kotlin
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class RobinPathClient(private val port: Int = 6372) {
    private val baseUrl = "http://127.0.0.1:$port"
    private var session: String = ""
    private var process: Process? = null

    fun start(): RobinPathClient {
        process = ProcessBuilder("robinpath", "start", "-p", port.toString())
            .redirectErrorStream(false)
            .start()

        val line = process!!.inputStream.bufferedReader().readLine()
        val startup = JSONObject(line)

        if (!startup.getBoolean("ok")) {
            throw RuntimeException(startup.optString("error", "Failed to start"))
        }
        session = startup.getString("session")
        return this
    }

    fun execute(code: String): JSONObject {
        return post("/v1/execute", JSONObject().put("code", code))
    }

    fun executeFile(path: String): JSONObject {
        return post("/v1/execute/file", JSONObject().put("file", path))
    }

    fun check(script: String): JSONObject {
        return post("/v1/check", JSONObject().put("script", script))
    }

    fun format(script: String): JSONObject {
        return post("/v1/fmt", JSONObject().put("script", script))
    }

    fun jobs(): JSONObject = get("/v1/jobs")
    fun modules(): JSONObject = get("/v1/modules")
    fun info(): JSONObject = get("/v1/info")

    fun stop(): JSONObject {
        val result = post("/v1/stop", JSONObject())
        process?.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)
        return result
    }

    private fun get(path: String): JSONObject {
        val conn = URL("$baseUrl$path").openConnection() as HttpURLConnection
        conn.setRequestProperty("x-robinpath-session", session)
        return JSONObject(conn.inputStream.bufferedReader().readText())
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val conn = URL("$baseUrl$path").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("x-robinpath-session", session)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.write(body.toString().toByteArray())
        return JSONObject(conn.inputStream.bufferedReader().readText())
    }
}

// Usage:
// val rp = RobinPathClient(6372).start()
// val result = rp.execute("set \$x = math.add 1 2\nlog \$x")
// println(result)
// rp.stop()
```

---

### Integration with Shell / Bash

```bash
#!/bin/bash

# Start server and capture session
STARTUP=$(robinpath start -p 6372 2>&1 &)
sleep 1
# Or parse the first line from the process output
SESSION="your-session-token"
PORT=6372

# Execute a script
curl -s -X POST "http://127.0.0.1:$PORT/v1/execute" \
  -H "x-robinpath-session: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"code": "set $x = math.add 1 2\nlog $x"}'

# Execute a file
curl -s -X POST "http://127.0.0.1:$PORT/v1/execute/file" \
  -H "x-robinpath-session: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"file": "./scripts/process.rp"}'

# Paste code directly (plain text)
curl -s -X POST "http://127.0.0.1:$PORT/v1/execute" \
  -H "x-robinpath-session: $SESSION" \
  -H "Content-Type: text/plain" \
  -d 'log "hello from bash"'

# Check syntax
curl -s -X POST "http://127.0.0.1:$PORT/v1/check" \
  -H "x-robinpath-session: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"script": "log 1"}'

# Format code
curl -s -X POST "http://127.0.0.1:$PORT/v1/fmt" \
  -H "x-robinpath-session: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"script": "set  $x  as   1"}'

# List jobs
curl -s "http://127.0.0.1:$PORT/v1/jobs" \
  -H "x-robinpath-session: $SESSION"

# Stream output (SSE)
curl -N "http://127.0.0.1:$PORT/v1/execute" \
  -H "x-robinpath-session: $SESSION" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"code": "log 1\ntime.sleep 1000\nlog 2"}'

# Health check (no auth needed)
curl -s "http://127.0.0.1:$PORT/v1/health"

# Stop server
curl -s -X POST "http://127.0.0.1:$PORT/v1/stop" \
  -H "x-robinpath-session: $SESSION"
```

---

## 15. SDK (`@robinpath/sdk`)

For JavaScript/TypeScript applications (React, Next.js, Vue, Angular, Express, Fastify, Node.js), use the SDK for direct in-process execution without the HTTP server.

### Installation

```bash
npm install @robinpath/sdk
```

### Basic Usage

```javascript
import { createRuntime } from '@robinpath/sdk';

// Full access (default — all modules, no restrictions)
const rp = createRuntime();

// Run a script
const result = await rp.run('set $x = math.add 1 2\nlog $x');
console.log(result.output);  // "3"
console.log(result.ok);      // true
console.log(result.value);   // null (last expression value)
console.log(result.variables); // { x: 3 }
```

### With Context Variables

```javascript
const result = await rp.run('log "Hello " + $name', { name: 'Robin' });
// output: "Hello Robin"
```

### Result Object

Every `run()` call returns:

```typescript
{
  ok: boolean;           // Whether execution succeeded
  output: string;        // Captured log/say output (joined with \n)
  value: any;            // Last expression value
  logs: ExecutionLog[];  // All log entries with timestamps
  variables: Record<string, any>;  // Final variable state
  error: {               // null if ok
    message: string;
    line?: number;
    column?: number;
    stack?: string;
  } | null;
  stats: {
    duration_ms: number;
    statements_executed: number;
  };
}
```

### Timeout

```javascript
const rp = createRuntime({ timeout: 5000 }); // 5 second max
const result = await rp.run('time.sleep 10000');
// result.ok = false
// result.error.message = "Execution timed out after 5000ms"
```

### Sandbox / Permissions

```javascript
// Restrict what scripts can do
const rp = createRuntime({
  permissions: {
    fs: false,       // block file, path, archive, excel, pdf
    net: false,      // block http, net, dns, tls, fetch, email
    child: false,    // block child.exec, child.spawn
    env: false,      // block process.env
    crypto: true,    // allow crypto (default)
  },
});

// Or use presets
const rp = createRuntime({ permissions: 'none' });  // block everything
const rp = createRuntime({ permissions: 'all' });   // allow everything (default)
```

### Module Whitelist

```javascript
// Only allow specific modules
const rp = createRuntime({
  modules: ['math', 'string', 'array', 'json'],
});
```

### Custom Builtins

```javascript
const rp = createRuntime({
  customBuiltins: {
    double: (args) => Number(args[0]) * 2,
    greet: (args) => `Hello ${args[0]}!`,
  },
});

const result = await rp.run('log double 5');    // "10"
const result2 = await rp.run('log greet "World"'); // "Hello World!"
```

### Custom Modules

```javascript
const rp = createRuntime({
  customModules: [{
    name: 'myapp',
    functions: {
      version: () => '2.0.0',
      users: async () => await db.users.count(),
    },
  }],
});

await rp.run('log myapp.version');  // "2.0.0"
```

### Streaming

```javascript
const stream = rp.stream('log "step 1"\ntime.sleep 1000\nlog "step 2"');

stream.on('log', (log) => {
  console.log('Live:', log.message); // "step 1", then "step 2"
});

stream.on('done', (result) => {
  console.log('Finished:', result.output);
});

// Or await the result
const result = await stream.result;
```

### Variable Management

```javascript
rp.setVariable('x', 42);
rp.setVariable('$y', 'hello'); // $ prefix stripped automatically

console.log(rp.getVariable('x'));  // 42
console.log(rp.getVariables());     // { x: 42, y: 'hello' }
```

### Parse Without Executing

```javascript
const ast = await rp.parse('set $x = 1\nlog $x');
// Returns AST array
```

### Access Underlying Engine

```javascript
// For advanced use cases
rp.engine.registerDecorator('myDecorator', handler);
rp.engine.getAvailableCommands();
```

### Persistent State

Variables persist across `run()` calls on the same runtime:

```javascript
const rp = createRuntime();
await rp.run('set $counter = 0');
await rp.run('set $counter = math.add $counter 1');
await rp.run('set $counter = math.add $counter 1');
const result = await rp.run('log $counter');
// output: "2"
```

### When to Use SDK vs HTTP Server

| Use Case | Solution |
|----------|----------|
| React/Next.js/Vue app | SDK (`@robinpath/sdk`) |
| Express/Fastify backend | SDK (`@robinpath/sdk`) |
| Node.js CLI tool | SDK (`@robinpath/sdk`) |
| Rust backend (Tauri, Actix) | HTTP (`robinpath start`) |
| Python backend (Django, Flask) | HTTP (`robinpath start`) |
| Go backend | HTTP (`robinpath start`) |
| PHP backend | HTTP (`robinpath start`) |
| CI/CD pipeline | CLI (`robinpath -e` or `robinpath script.rp`) |
| Cron job | CLI (`robinpath script.rp`) |

---

## 16. Configuration Reference

### File Paths

| Path | Purpose |
|------|---------|
| `~/.robinpath/` | Home directory |
| `~/.robinpath/bin/` | Binary installation |
| `~/.robinpath/modules/` | Installed modules |
| `~/.robinpath/modules/modules.json` | Module manifest |
| `~/.robinpath/cache/` | Download cache |
| `~/.robinpath/auth.json` | Auth credentials |
| `~/.robinpath/history` | REPL history |
| `~/.robinpath/env` | Environment secrets |
| `~/.robinpath/server-<port>.pid` | Server PID file |
| `robinpath.json` | Project config |
| `robinpath-lock.json` | Lock file |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROBINPATH_CLOUD_URL` | `https://dev.robinpath.com` | Cloud app URL |
| `ROBINPATH_PLATFORM_URL` | `https://api.robinpath.com` | Registry API URL |
| `ROBINPATH_CURRENT_VERSION` | (none) | Set during update |

### Server Defaults

| Setting | Default |
|---------|---------|
| Port | `6372` |
| Host | `127.0.0.1` |
| Session | Auto-generated UUID |
| Timeout | `30000` ms |
| Max concurrent jobs | `5` |
| CORS origin | `*` |
| Max body size | `5000000` bytes (5MB) |
| Rate limit | `100` requests per window |
| Job retention | `1 hour` |
| Job cleanup interval | `60 seconds` |
| Graceful shutdown timeout | `10 seconds` (signal) / `5 seconds` (POST /stop) |

---

## 17. Error Handling & Exit Codes

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Execution error, test failure, formatter check failure |
| `2` | Syntax error, invalid arguments, missing required argument |

### Error Formats

**TTY (terminal):**
```
Error in app.rp:

  3 | set $x = math.add 1
  4 | log $x +
           ^
  Unexpected end of expression at line 4, column 10
```

**JSON (`--json` flag):**
```json
{
  "ok": false,
  "file": "app.rp",
  "error": "Unexpected end of expression",
  "line": 4,
  "column": 10
}
```

**HTTP server:**
```json
{
  "ok": false,
  "error": {
    "code": "EXECUTION_ERROR",
    "message": "Unexpected end of expression at line 4"
  },
  "requestId": "abc-123"
}
```

---

## 18. Security

### Session Gatekeeper

The HTTP server requires `x-robinpath-session` header on all endpoints except `/v1/health`. Without the correct token, requests receive `401 Unauthorized`.

The session token is:
- Printed on server startup (parse the JSON output)
- Generated as UUID v4 if not explicitly provided
- Stored only in-memory (never written to disk)

### Webhook Signatures

When using webhooks with `webhook_secret`, the payload is signed using HMAC-SHA256:

```
X-Webhook-Signature: sha256=<hex-encoded-hmac>
```

Verify the signature on your server:
```javascript
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
const valid = `sha256=${expected}` === signatureHeader;
```

### File Permissions

| File | Unix Permissions | Notes |
|------|-----------------|-------|
| `~/.robinpath/auth.json` | `0o600` | Owner read/write only |
| `~/.robinpath/env` | `0o600` | Owner read/write only |

### Rate Limiting

The HTTP server includes built-in rate limiting with headers:
- `x-rate-limit-limit` — Total allowed requests
- `x-rate-limit-remaining` — Requests remaining
- `x-rate-limit-reset` — When the limit resets

### Idempotency

Use `x-idempotency-key` header to prevent duplicate execution on network retries. The server caches results for 5 minutes per key.

---

## 19. Troubleshooting

### Common Issues

**"Port already in use"**
```bash
robinpath status -p 6372          # Check if server is running
# Or kill the process
kill $(cat ~/.robinpath/server-6372.pid)
```

**"Not logged in"**
```bash
robinpath login                    # Sign in via browser
robinpath whoami                   # Verify auth status
```

**"Module not found"**
```bash
robinpath modules list             # Check installed modules
robinpath add @robinpath/module    # Install missing module
```

**"Command not found: robinpath"**
```bash
# Reinstall
curl -fsSL https://dev.robinpath.com/install.sh | bash  # macOS/Linux
irm https://dev.robinpath.com/install.ps1 | iex         # Windows

# Or manually add to PATH
export PATH="$HOME/.robinpath/bin:$PATH"
```

**Scripts work in CLI but not in HTTP server**
- The HTTP server uses the same engine, but `console.log` output is captured differently
- Use the `output` field in the response, not stdout
- Variables persist across requests on the same server instance

### Diagnostics

```bash
robinpath doctor                   # Full environment check
robinpath info                     # System paths and versions
robinpath info --json              # Machine-readable system info
robinpath audit                    # Check module health
```

### Debug Logging

```bash
robinpath --verbose app.rp         # Timing and parse info
robinpath start --log-file rp.log  # JSON logs to file
```

---

## Complete Command Reference

```
USAGE:
  robinpath [command] [flags] [file]
  rp [command] [flags] [file]

COMMANDS:
  <file.rp>              Run a RobinPath script
  -e, --eval <code>      Execute inline script
  fmt <file|dir>         Format code (-w, --check, --diff)
  check <file>           Syntax check (--json)
  ast <file>             Dump AST (--compact)
  test [dir|file]        Run tests (--json)

MODULE MANAGEMENT:
  add <pkg>[@ver]        Install module (--force)
  remove <pkg>           Uninstall module
  upgrade <pkg>          Upgrade module
  search <query>         Search registry (--category)
  info                   System info (--json) / info <pkg> module details
  modules list           List installed
  modules upgrade        Upgrade all
  modules init           Scaffold new module
  audit                  Check module health

PROJECT:
  init                   Create robinpath.json (--force)
  install                Install project dependencies
  doctor                 Diagnose environment
  env <set|list|rm>      Manage secrets
  cache <list|clean>     Manage cache

SYSTEM:
  install                Install to PATH
  uninstall              Remove from system
  update                 Update to latest

SERVER:
  start                  Start HTTP server
    -p, --port           Port (default: 6372)
    -s, --session        Session secret
    --host               Bind address (default: 127.0.0.1)
    --timeout            Script timeout ms (default: 30000)
    --max-concurrent     Max parallel jobs (default: 5)
    --cors-origin        CORS origin (default: *)
    --log-file           JSON log file path
    --max-body           Max request body bytes (default: 5MB)
  status                 Check if server is running

CLOUD:
  login                  Sign in via browser
  logout                 Remove credentials
  whoami                 Show current user
  publish [dir]          Publish module (--public, --private, --org, --dry-run)
  pack [dir]             Create tarball
  deprecate <pkg>        Mark module deprecated
  sync                   List your published modules

FLAGS:
  -w, --watch            Re-run on file changes
  -q, --quiet            Suppress non-error output
  --verbose              Show timing/debug info
  -v, --version          Show version
  -h, --help             Show help

REPL:
  robinpath              Start interactive REPL (no arguments)
```
