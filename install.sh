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
DIM='\033[0;90m'
WHITE='\033[1;37m'
DCYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "  ${DCYAN}╭─────────────────────────────╮${NC}"
echo "  ${DCYAN}│                             │${NC}"
echo "  ${DCYAN}│   ${CYAN}RobinPath Installer${DCYAN}   │${NC}"
echo "  ${DCYAN}│                             │${NC}"
echo "  ${DCYAN}╰─────────────────────────────╯${NC}"
echo ""

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
    linux)  PLATFORM="linux" ;;
    darwin) PLATFORM="macos" ;;
    *)
        echo "  ${RED}✗ Unsupported OS: $OS${NC}"
        echo "    ${DIM}Visit https://github.com/$REPO/releases${NC}"
        echo ""
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64|amd64) ARCH_SUFFIX="x64" ;;
    arm64|aarch64) ARCH_SUFFIX="arm64" ;;
    *)
        echo "  ${RED}✗ Unsupported architecture: $ARCH${NC}"
        echo ""
        exit 1
        ;;
esac

BINARY_NAME="robinpath-${PLATFORM}-${ARCH_SUFFIX}"

# Step 1: Fetch latest release
echo "  ${DIM}[1/4]${NC} ${WHITE}Fetching latest release...${NC}"
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || {
    echo ""
    echo "  ${RED}✗ No releases found.${NC}"
    echo "    ${DIM}Visit https://github.com/$REPO/releases${NC}"
    echo ""
    exit 1
}

DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url.*$BINARY_NAME" | head -1 | cut -d '"' -f 4)
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)

LATEST_CLEAN=$(echo "$VERSION" | sed 's/^v//')

# Skip if already on latest version
if [ -n "$ROBINPATH_CURRENT_VERSION" ] && [ "$ROBINPATH_CURRENT_VERSION" = "$LATEST_CLEAN" ]; then
    echo ""
    echo "  ${GREEN}✓ Already up to date (v$ROBINPATH_CURRENT_VERSION)${NC}"
    echo ""
    exit 0
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo ""
    echo "  ${RED}✗ Binary not found for $PLATFORM/$ARCH_SUFFIX${NC}"
    echo "    ${DIM}Visit https://github.com/$REPO/releases${NC}"
    echo ""
    exit 1
fi

# Step 2: Download
echo "  ${DIM}[2/4]${NC} ${WHITE}Downloading $VERSION${NC} ${DIM}($PLATFORM $ARCH_SUFFIX)${NC}"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/robinpath"
chmod +x "$INSTALL_DIR/robinpath"

# Step 3: Install alias
echo "  ${DIM}[3/4]${NC} ${WHITE}Installing...${NC}"
ln -sf "$INSTALL_DIR/robinpath" "$INSTALL_DIR/rp"

# Step 4: Verify
echo "  ${DIM}[4/4]${NC} ${WHITE}Verifying...${NC}"
if "$INSTALL_DIR/robinpath" --version > /dev/null 2>&1; then
    INSTALLED_VERSION=$("$INSTALL_DIR/robinpath" --version)
    echo ""
    echo "  ${GREEN}✓ Installed $INSTALLED_VERSION${NC}"
else
    echo ""
    echo "  ${RED}✗ Binary downloaded but failed to execute.${NC}"
    echo ""
    exit 1
fi

# Add to PATH if not already there
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

if echo "$PATH" | grep -q "$INSTALL_DIR"; then
    echo ""
    echo "  ${DIM}Run:${NC}"
    echo "    ${CYAN}robinpath --version${NC}"
else
    if [ -n "$PROFILE" ]; then
        if ! grep -q "$INSTALL_DIR" "$PROFILE" 2>/dev/null; then
            echo "" >> "$PROFILE"
            echo "# RobinPath" >> "$PROFILE"
            echo "$PATH_LINE" >> "$PROFILE"
        fi
        echo "  ${GREEN}✓ Added to PATH${NC}"
        echo ""
        echo "  ${DIM}Restart your terminal, then run:${NC}"
        echo "    ${CYAN}robinpath --version${NC}"
    else
        echo ""
        echo "  ${DIM}Add this to your shell profile:${NC}"
        echo "    ${CYAN}$PATH_LINE${NC}"
    fi
fi
echo ""
