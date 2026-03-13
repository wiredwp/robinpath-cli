# RobinPath CLI

Scripting language for automation — with built-in AI that understands your code.

## Install

**Windows** (PowerShell):
```powershell
irm https://dev.robinpath.com/install.ps1 | iex
```

**macOS / Linux**:
```sh
curl -fsSL https://dev.robinpath.com/install.sh | bash
```

Then restart your terminal and verify:
```
robinpath --version
```

## Quick Start

```sh
# Run a script
robinpath app.rp

# Inline code
robinpath -e 'log "Hello World"'

# AI code generation (streaming)
robinpath -p "read a csv and send email to each row"

# AI + save to file
robinpath -p "implement quicksort" --save

# AI + save and run
robinpath -p "fetch weather for London" --save --run

# Interactive AI assistant
robinpath
```

## AI Mode

RobinPath has a built-in AI assistant that knows the entire language and all 210+ modules.

```
robinpath -p "your question"     # Headless (streaming output)
robinpath -p "..." --save        # Generate and save to .rp file
robinpath -p "..." --run         # Generate, save, and run
robinpath -p "..." -o app.rp     # Save to specific file
robinpath                        # Interactive AI REPL
```

The AI works in any language — English, Russian, Romanian, Spanish, Chinese, etc.

To use the interactive REPL with your own model:
```
robinpath ai config set-key <your-openrouter-key>
robinpath ai config set-model anthropic/claude-sonnet-4-20250514
```

## Modules

210+ built-in and installable modules for common tasks:

```sh
robinpath add @robinpath/slack      # Install a module
robinpath remove @robinpath/slack   # Remove a module
robinpath search slack              # Search the registry
robinpath info @robinpath/slack     # Module details
```

## Commands

| Command | Description |
|---------|-------------|
| `<file.rp>` | Run a script |
| `-p "prompt"` | AI code generation |
| `-e "code"` | Execute inline code |
| `add <pkg>` | Install a module |
| `remove <pkg>` | Remove a module |
| `search <query>` | Search modules |
| `fmt <file>` | Format a script |
| `check <file>` | Syntax check |
| `test [dir]` | Run test files |
| `update` | Update CLI to latest |
| `install` / `uninstall` | System install/remove |

## Flags

| Flag | Description |
|------|-------------|
| `-p "prompt"` | AI headless mode |
| `--save` | Save generated code to .rp file |
| `--run` | Save and run generated code |
| `-o <file>` | Output filename for --save |
| `-e` | Execute inline code |
| `-v` | Show version |
| `-h` | Show help |

## Platforms

| Platform | Binary |
|----------|--------|
| Windows x64 | `robinpath-windows-x64.exe` |
| macOS ARM64 | `robinpath-macos-arm64` |
| Linux x64 | `robinpath-linux-x64` |

Binaries install to `~/.robinpath/bin/`. Shorthand `rp` works everywhere.
