#!/usr/bin/env bash
set -euo pipefail

# Auto-bootstraps Apps2Samsung CLI (v3.2.0) into .tools/apps2samsung-cli/
# Zero Tizen Studio, zero Java, zero Docker required.
# Prints ONLY the executable path to stdout; all status logs go to stderr.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
A2S_VERSION="v3.2.0"
INSTALL_DIR="$ROOT_DIR/.tools/apps2samsung-cli"
BIN_PATH="$INSTALL_DIR/apps2samsung-cli"
VER_FILE="$INSTALL_DIR/.version"

if [ -x "$BIN_PATH" ] && [ -f "$VER_FILE" ] && [ "$(cat "$VER_FILE")" = "$A2S_VERSION" ]; then
  printf '%s\n' "$BIN_PATH"
  exit 0
fi

if command -v apps2samsung-cli >/dev/null 2>&1; then
  printf '%s\n' "$(command -v apps2samsung-cli)"
  exit 0
fi

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
ASSET=""
EXPECTED_SHA256=""

case "${OS_NAME}:${ARCH_NAME}" in
  Darwin:arm64)
    ASSET="Apps2Samsung-cli-${A2S_VERSION}-osx-arm64.tar.gz"
    EXPECTED_SHA256="b24979566d475d846f0c7eafdb2a3e8ddf129bcb8bfc7b55781b89f0bea18fab"
    ;;
  Darwin:x86_64)
    ASSET="Apps2Samsung-cli-${A2S_VERSION}-osx-x64.tar.gz"
    EXPECTED_SHA256="376331d61c7bfd3f24d9e368190104c893237ca170612887f8ed5864f5eacd1c"
    ;;
  Linux:aarch64|Linux:arm64)
    ASSET="Apps2Samsung-cli-${A2S_VERSION}-linux-arm64.tar.gz"
    EXPECTED_SHA256="f58d02405dcf195ba0dd1f3e6d29b3f88fb8c085f7ff28befcee8552622d41e7"
    ;;
  Linux:x86_64)
    ASSET="Apps2Samsung-cli-${A2S_VERSION}-linux-x64.tar.gz"
    EXPECTED_SHA256="0c4c8532cb61b2ef53e15537ca9423af04aece0a868de0105bbef9562ca61ce8"
    ;;
  *)
    echo "❌ Unsupported platform for auto-installer: ${OS_NAME} ${ARCH_NAME}" >&2
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/Apps2Samsung/Apps2Samsung/releases/download/${A2S_VERSION}/${ASSET}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "⬇️  Downloading lightweight Samsung TV installer (${ASSET})..." >&2
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/cli.tar.gz"

ACTUAL_SHA256=""
if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(shasum -a 256 "$TMP_DIR/cli.tar.gz" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$TMP_DIR/cli.tar.gz" | awk '{print $1}')"
fi

if [ -n "$ACTUAL_SHA256" ] && [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "❌ SHA-256 mismatch for ${ASSET}!" >&2
  echo "   Expected: ${EXPECTED_SHA256}" >&2
  echo "   Actual:   ${ACTUAL_SHA256}" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/cli.tar.gz" -C "$INSTALL_DIR"
chmod +x "$BIN_PATH"

if [ "$OS_NAME" = "Darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -cr "$INSTALL_DIR" 2>/dev/null || true
fi

printf '%s' "$A2S_VERSION" > "$VER_FILE"
echo "✅ Samsung TV installer cached at .tools/apps2samsung-cli/" >&2
printf '%s\n' "$BIN_PATH"
