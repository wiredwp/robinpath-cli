# RobinPath CLI Documentation

## Overview

RobinPath is a scripting language and CLI for automation. The CLI includes an AI assistant that can read, create, and execute files on your machine — similar to Claude Code.

**Distribution:** npm package (`@robinpath/cli`)
**Runtime:** Node.js 18+
**UI:** Ink v5 (React for terminal)

## Installation

```
npm install -g @robinpath/cli
```

### First Run

```
robinpath
```

1. **Login** — OAuth via browser
2. **API Key** — paste your OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys))
3. **Trust prompt** — confirm workspace access
4. **AI mode** — ready to chat

### Update

```
robinpath update
```

### Uninstall

```
robinpath uninstall
```

## Architecture

```
src/
  index.ts              Entry point, arg parsing, onboarding
  ink-repl.tsx           Ink React UI — chat app, input, streaming
  repl.ts               Fallback REPL (non-TTY)
  brain.ts              Brain API — SSE streaming, RAG context
  shell.ts              Command execution (spawn)
  models.ts             AI model list + pricing
  config.ts             Encrypted API key storage
  sessions.ts           Session CRUD, memory, compaction
  file-refs.ts          @filename file reference resolver
  runtime.ts            Lazy-loaded language runtime
  input.ts              Raw-mode input handler (fallback)
  help.ts               CLI help text
  ui/
    Markdown.tsx         Markdown renderer (code, tables, diffs)
  commands-core.ts       Auth, modules, install/uninstall
  commands-cloud.ts      Login, publish, sync
  commands-modules.ts    Add, remove, search, info
  commands-snippets.ts   Snippet management
  commands-project.ts    Init, doctor, env, cache
  commands-devtools.ts   Fmt, check, ast, test, REPL
```

## Build

```sh
npm run build          # esbuild -> dist/cli.mjs
npm run typecheck      # tsc --noEmit (strict mode)
npm run lint           # eslint
npm run format         # prettier
```

Build outputs ESM bundle with npm dependencies external (resolved at runtime).

## AI Mode

### How It Works

1. User types message in Ink input area
2. `@filename` references expanded (file contents injected)
3. Message sent to Brain API (`ai-brain.robinpath.com`)
4. Brain does RAG (vector search for relevant docs) + LLM call
5. Response streamed via SSE, displayed with Markdown rendering
6. `<cmd>` tags extracted and executed as shell commands
7. Command results fed back to AI for follow-up
8. Loop up to 5 iterations

### Brain Communication

```
CLI -> POST /docs/generate -> Brain -> OpenRouter -> LLM
                                    |
                             SSE stream back
                                    |
                        event: metadata
                        event: text_delta (tokens)
                        event: done (usage)
                        event: error
```

### cliContext

The CLI sends environment info to the Brain so the AI generates correct commands:

```json
{
  "platform": "win32",
  "shell": "powershell",
  "cwd": "C:\\Users\\Admin\\project",
  "cliVersion": "3.5.2",
  "nativeModules": ["file", "path", "http"],
  "installedModules": ["@robinpath/csv"]
}
```

### ROBINPATH.md

Project-specific instructions file (like Claude Code's CLAUDE.md). Auto-loaded from current directory on startup. Create with `/init`.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/` | Show all commands |
| `/model` | Arrow-key model selector |
| `/settings` | API key, model, shell config |
| `/auto` | Toggle auto-accept for commands |
| `/clear` | Clear conversation and screen |
| `/compact` | Trim to last 10 messages |
| `/save [name]` | Save session |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a session |
| `/delete <id>` | Delete a session |
| `/memory` | Show persistent memory |
| `/remember <fact>` | Save a fact |
| `/forget <n>` | Remove a memory |
| `/usage` | Token count and cost |
| `/shell` | List/switch shells |
| `/init` | Create ROBINPATH.md |
| `/help` | Show all commands |
| `exit` | Quit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Submit message |
| `\` + Enter | New line |
| Esc | Clear input / cancel streaming |
| Ctrl+C | Cancel streaming / exit |
| Up/Down | Input history |
| Tab | Complete / or @ |
| @ | Show file picker |

## File References

Type `@filename` to include file contents in your prompt:

```
> explain @hello.rp and fix the bug
```

- `@hello.rp` shown in cyan if file exists, white if not
- Tab cycles through matching files
- File content injected into the prompt sent to AI

## Models

Available via OpenRouter (API key required):

| Model | Description |
|-------|-------------|
| `anthropic/claude-sonnet-4.6` | Fast + smart (default) |
| `anthropic/claude-opus-4.6` | Most capable |
| `anthropic/claude-haiku-4.5` | Fastest + cheapest |
| `openai/gpt-5.2` | Instant |
| `openai/gpt-5.2-pro` | Reasoning |
| `openai/gpt-5-mini` | Budget-friendly |
| `google/gemini-3-flash-preview` | 1M context |
| `google/gemini-3.1-pro-preview` | 65K output |

## Configuration

Stored in `~/.robinpath/ai.json` (encrypted):

```sh
robinpath ai config set-key <key>     # Set API key (encrypted with AES-256-GCM)
robinpath ai config set-model <id>    # Set default model
robinpath ai config show              # View config
robinpath ai config remove            # Remove all config
```

## Data Storage

All data stored locally in `~/.robinpath/`:

| Path | Contents |
|------|----------|
| `ai.json` | Encrypted API key + model config |
| `auth.json` | Login credentials |
| `ai-sessions/` | Saved conversation sessions |
| `ai-memory.json` | Persistent memory facts |
| `ai-history` | Input history |
| `modules/` | Installed modules |
| `trusted-dirs.json` | Trusted workspace directories |

## Security

- API keys encrypted with AES-256-GCM at rest
- Encryption key derived from hostname + username (machine-specific)
- Keys sent directly to Brain API per-request, never stored server-side
- File permissions set to 600 on Unix
- Trust prompt before accessing any workspace
- Login required for AI features

## CLI Commands Reference

### Script Execution
```sh
robinpath <file.rp>              # Run a script
robinpath -e 'log "hello"'       # Inline code
echo 'log 1' | robinpath         # Pipe stdin
robinpath --watch app.rp         # Watch mode
```

### AI
```sh
robinpath                         # Interactive AI mode
robinpath -p "prompt"             # Headless AI
robinpath -p "..." --save         # Save generated code
robinpath -p "..." --run          # Save and run
robinpath -p "..." -o file.rp     # Save to specific file
```

### Modules
```sh
robinpath add @robinpath/csv      # Install
robinpath remove @robinpath/csv   # Remove
robinpath search csv              # Search registry
robinpath info @robinpath/csv     # Module details
robinpath modules list            # List installed
robinpath modules upgrade         # Upgrade all
```

### Development
```sh
robinpath fmt file.rp             # Format
robinpath check file.rp           # Syntax check
robinpath test                    # Run tests
robinpath ast file.rp             # Dump AST
```

### Account
```sh
robinpath login                   # OAuth login
robinpath logout                  # Remove credentials
robinpath whoami                  # Show account info
robinpath update                  # Self-update
robinpath uninstall               # Clean removal
```

### Server (HTTP API)
```sh
robinpath start -p 6372           # Start HTTP server
robinpath status                  # Check server status
```
