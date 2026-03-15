# RobinPath CLI

AI-powered scripting CLI — automate anything from your terminal.

## Install

```
npm install -g @robinpath/cli
```

Requires Node.js 18+.

## Getting Started

```
robinpath
```

First run guides you through:
1. **Login** — authenticate with your RobinPath account
2. **API key** — paste your OpenRouter key (get one at [openrouter.ai/keys](https://openrouter.ai/keys))
3. **Ready** — start chatting with the AI

## Usage

```sh
# Interactive AI assistant
robinpath

# Headless AI prompt (for scripts/piping)
robinpath -p "create a script that fetches weather data"

# Run a script
robinpath hello.rp

# Inline code
robinpath -e 'log "Hello World"'
```

## AI Commands (inside the REPL)

| Command | Description |
|---------|-------------|
| `/model` | Switch AI model (arrow-key selector) |
| `/settings` | View API key, model, shell config |
| `/clear` | Clear conversation |
| `/save` | Save session |
| `/sessions` | List saved sessions |
| `/resume` | Resume a session |
| `/memory` | Persistent memory across sessions |
| `/init` | Create ROBINPATH.md project config |
| `/auto` | Toggle auto-accept for commands |
| `/shell` | Switch shell (bash, powershell, zsh) |
| `/usage` | Token usage and cost |
| `@filename` | Include file contents in prompt |
| `exit` | Quit |

## CLI Commands

```sh
robinpath <file.rp>          # Run a script
robinpath -p "prompt"        # AI headless mode
robinpath -e "code"          # Execute inline code
robinpath fmt <file>         # Format code
robinpath check <file>       # Syntax check
robinpath test [dir]         # Run tests
robinpath add <pkg>          # Install a module
robinpath remove <pkg>       # Remove a module
robinpath search <query>     # Search module registry
robinpath login              # Authenticate
robinpath update             # Self-update to latest
robinpath uninstall          # Clean removal
```

## Flags

| Flag | Description |
|------|-------------|
| `-p "prompt"` | AI headless mode |
| `--save` | Save generated code to .rp file |
| `--run` | Save and run generated code |
| `-o <file>` | Output filename |
| `--auto` | Auto-accept commands |
| `--dev` | Dev mode (auto + verbose) |
| `-v` | Version |
| `-h` | Help |

## ROBINPATH.md

Create a `ROBINPATH.md` file in your project to customize the AI's behavior — like Claude Code's `CLAUDE.md`. The AI reads it automatically on startup.

```
robinpath
> /init
```

## Configuration

```sh
robinpath ai config set-key ...       # Set API key
robinpath ai config set-model <id>    # Set model
robinpath ai config show              # View config
robinpath ai config remove            # Remove config
```

## Links

- Website: [dev.robinpath.com](https://dev.robinpath.com)
- npm: [@robinpath/cli](https://www.npmjs.com/package/@robinpath/cli)
- GitHub: [wiredwp/robinpath-cli](https://github.com/wiredwp/robinpath-cli)
