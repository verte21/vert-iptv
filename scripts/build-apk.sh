#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android-tv"
ASSETS_WWW="$ANDROID_DIR/app/src/main/assets/www"
FINAL_APK="$ROOT_DIR/dist/vertIPTV-tv.apk"
USB_DIR="$ROOT_DIR/dist/usb-pendrive-root"

# Locate OpenJDK 17+ if JAVA_HOME is not already set
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version >/dev/null 2>&1; then
  if [ -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif [ -d "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif command -v /usr/libexec/java_home >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home 2>/dev/null || true)"
  fi
fi

export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$HOME/.local/bin:$PATH"

# Locate Android SDK
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi

if [ -n "${ANDROID_HOME:-}" ]; then
  printf "sdk.dir=%s\n" "$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
fi

echo "📂 Syncing vertIPTV web core into Android TV assets ($ASSETS_WWW)..."
rm -rf "$ASSETS_WWW"
mkdir -p "$ASSETS_WWW" "$ROOT_DIR/dist"

cp "$ROOT_DIR/index.html" "$ASSETS_WWW/"
cp "$ROOT_DIR/icon.png" "$ASSETS_WWW/"
cp -R "$ROOT_DIR/css" "$ASSETS_WWW/css"
cp -R "$ROOT_DIR/js" "$ASSETS_WWW/js"
cp -R "$ROOT_DIR/vendor" "$ASSETS_WWW/vendor"

echo "🔨 Building Android TV / Fire TV APK (Media3 ExoPlayer + Leanback)..."
chmod +x "$ANDROID_DIR/gradlew"
(cd "$ANDROID_DIR" && ./gradlew assembleRelease --no-daemon --console=plain)

BUILT_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$BUILT_APK" ]; then
  echo "❌ Expected APK not found at $BUILT_APK" >&2
  exit 1
fi

cp "$BUILT_APK" "$FINAL_APK.tmp"
mv -f "$FINAL_APK.tmp" "$FINAL_APK"
echo "✅ Built & signed Android TV APK: $FINAL_APK ($(du -h "$FINAL_APK" | awk '{print $1}'))"

if [ -d "$USB_DIR" ]; then
  cp "$FINAL_APK" "$USB_DIR/vertIPTV-tv.apk.tmp"
  mv -f "$USB_DIR/vertIPTV-tv.apk.tmp" "$USB_DIR/vertIPTV-tv.apk"
  echo "💾 Copied vertIPTV-tv.apk to USB pendrive bundle: $USB_DIR/vertIPTV-tv.apk"
fi
