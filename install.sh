#!/bin/sh
# RobinPath installer for macOS and Linux
# Usage: curl -fsSL https://dev.robinpath.com/install.sh | sh
set -e

REPO="nabivogedu/robinpath-cli"
INSTALL_DIR="$HOME/.robinpath/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DCYAN='\033[0;36m'
DIM='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m'

echo ""
echo "  ${CYAN}RobinPath${NC} Installer"
echo ""

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
    linux)  PLATFORM="linux" ;;
    darwin) PLATFORM="macos" ;;
    *)
        echo "  ${RED}error:${NC} Unsupported OS: $OS"
        echo "         Visit https://github.com/$REPO/releases"
        echo ""
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64|amd64) ARCH_SUFFIX="x64" ;;
    arm64|aarch64) ARCH_SUFFIX="arm64" ;;
    *)
        echo "  ${RED}error:${NC} Unsupported architecture: $ARCH"
        echo ""
        exit 1
        ;;
esac

BINARY_NAME="robinpath-${PLATFORM}-${ARCH_SUFFIX}"

# Fetch latest release
echo "  ${DCYAN}>${NC} Fetching latest release"
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || {
    echo "  ${RED}error:${NC} Could not reach GitHub. Check your connection."
    echo ""
    exit 1
}

DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url.*$BINARY_NAME" | head -1 | cut -d '"' -f 4)
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)
LATEST_CLEAN=$(echo "$VERSION" | sed 's/^v//')

# Skip if already on latest version
if [ -n "$ROBINPATH_CURRENT_VERSION" ] && [ "$ROBINPATH_CURRENT_VERSION" = "$LATEST_CLEAN" ]; then
    echo "  ${GREEN}success:${NC} Already on the latest version (v$ROBINPATH_CURRENT_VERSION)."
    echo ""
    exit 0
fi

if [ -n "$ROBINPATH_CURRENT_VERSION" ]; then
    echo "  ${DCYAN}>${NC} Upgrading v$ROBINPATH_CURRENT_VERSION -> $VERSION"
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo "  ${RED}error:${NC} No binary found for $PLATFORM/$ARCH_SUFFIX in $VERSION."
    echo "         ${DIM}Visit https://github.com/$REPO/releases${NC}"
    echo ""
    exit 1
fi

# Download
echo "  ${DCYAN}>${NC} Downloading $VERSION ${DIM}($PLATFORM $ARCH_SUFFIX)${NC}"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/robinpath"
chmod +x "$INSTALL_DIR/robinpath"

# Install alias
echo "  ${DCYAN}>${NC} Installing to $INSTALL_DIR"
ln -sf "$INSTALL_DIR/robinpath" "$INSTALL_DIR/rp"

# Verify
if "$INSTALL_DIR/robinpath" --version > /dev/null 2>&1; then
    INSTALLED_VERSION=$("$INSTALL_DIR/robinpath" --version)
else
    echo "  ${RED}error:${NC} Binary downloaded but failed to execute."
    echo ""
    exit 1
fi

# Add to PATH if not already there
ADDED_PATH=false
SHELL_NAME=$(basename "$SHELL")
PROFILE=""

case "$SHELL_NAME" in
    zsh)  PROFILE="$HOME/.zshrc" ;;
    bash)
        if [ -f "$HOME/.bashrc" ]; then
            PROFILE="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            PROFILE="$HOME/.bash_profile"
        fi
        ;;
    fish) PROFILE="$HOME/.config/fish/config.fish" ;;
esac

PATH_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
if [ "$SHELL_NAME" = "fish" ]; then
    PATH_LINE="set -gx PATH $INSTALL_DIR \$PATH"
fi

if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    if [ -n "$PROFILE" ]; then
        if ! grep -q "$INSTALL_DIR" "$PROFILE" 2>/dev/null; then
            echo "" >> "$PROFILE"
            echo "# RobinPath" >> "$PROFILE"
            echo "$PATH_LINE" >> "$PROFILE"
        fi
        ADDED_PATH=true
    fi
fi

echo ""
echo "  ${GREEN}success:${NC} $INSTALLED_VERSION installed."
echo ""

if [ "$ADDED_PATH" = "true" ]; then
    echo "  ${DIM}Restart your terminal, then run:${NC}"
elif ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    echo "  ${DIM}Add this to your shell profile:${NC}"
    echo "    ${CYAN}$PATH_LINE${NC}"
    echo ""
    echo "  ${DIM}Then run:${NC}"
else
    echo "  ${DIM}To get started, run:${NC}"
fi

echo ""
echo "    ${WHITE}robinpath --help${NC}"
echo ""
