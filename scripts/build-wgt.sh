#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$ROOT_DIR/dist/stage"
USB_DIR="$ROOT_DIR/dist/usb-pendrive-root"
UNSIGNED_WGT="$ROOT_DIR/dist/vertIPTV-unsigned.wgt"
FINAL_WGT="$ROOT_DIR/dist/vertIPTV.wgt"
CERT_PROFILE="${1:-}"

rm -rf "$STAGE_DIR" "$USB_DIR" "$UNSIGNED_WGT" "$FINAL_WGT"
mkdir -p "$STAGE_DIR" "$USB_DIR/SSSP" "$USB_DIR/userwidget"

# Copy strictly runtime Tizen widget assets (keeps package tiny & fast)
cp "$ROOT_DIR/config.xml" "$STAGE_DIR/"
cp "$ROOT_DIR/icon.png" "$STAGE_DIR/"
cp "$ROOT_DIR/index.html" "$STAGE_DIR/"
cp -R "$ROOT_DIR/css" "$STAGE_DIR/css"
cp -R "$ROOT_DIR/js" "$STAGE_DIR/js"
cp -R "$ROOT_DIR/vendor" "$STAGE_DIR/vendor"

# Produce clean W3C .wgt zip archive first
(cd "$STAGE_DIR" && zip -qr "$UNSIGNED_WGT" .)

# Find Tizen Studio CLI if user explicitly requested a Tizen Studio profile
TIZEN_BIN=""
if command -v tizen >/dev/null 2>&1; then
  TIZEN_BIN="$(command -v tizen)"
elif [ -x "$HOME/tizen-studio/tools/ide/bin/tizen" ]; then
  TIZEN_BIN="$HOME/tizen-studio/tools/ide/bin/tizen"
fi

SIGNED_OK=0
if [ -n "$TIZEN_BIN" ] && [ -n "$CERT_PROFILE" ]; then
  echo "🔐 Signing & packaging vertIPTV.wgt with Tizen Studio profile '$CERT_PROFILE'..."
  "$TIZEN_BIN" package -t wgt -s "$CERT_PROFILE" -o "$ROOT_DIR/dist" -- "$STAGE_DIR"
  SIGNED_OK=1
else
  # Sign automatically with local Tizen Public CA via apps2samsung-cli (zero Samsung login, zero Tizen Studio!)
  if A2S_BIN="$(bash "$ROOT_DIR/scripts/ensure-installer.sh" 2>/dev/null)"; then
    if "$A2S_BIN" sign "$UNSIGNED_WGT" -o "$FINAL_WGT" --tizen-cert public --tizen-chain legacy -q >/dev/null 2>&1; then
      SIGNED_OK=1
      echo "✅ Built & pre-signed widget (Tizen Public CA): $FINAL_WGT"
    fi
  fi
fi

if [ "$SIGNED_OK" -eq 0 ]; then
  cp "$UNSIGNED_WGT" "$FINAL_WGT"
  echo "📦 Built unsigned widget: $FINAL_WGT"
fi
rm -f "$UNSIGNED_WGT"

# Create legacy pre-2020 userwidget + Samsung Commercial/Signage (SSSP) USB bundles
WGT_BYTES="$(wc -c < "$FINAL_WGT" | tr -d ' ')"
cp "$FINAL_WGT" "$USB_DIR/userwidget/vertIPTV.wgt"
cp "$FINAL_WGT" "$USB_DIR/SSSP/vertIPTV.wgt"
cat > "$USB_DIR/SSSP/sssp_config.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<widget>
    <ver>1.1.0</ver>
    <size>${WGT_BYTES}</size>
    <widgetname>vertIPTV</widgetname>
    <webtype>tizen</webtype>
</widget>
EOF

# Generate clean Pendrive Playlist Auto-Import template (never embeds .local-config.json unless --include-local-config is passed)
if [ "${CERT_PROFILE:-}" = "--include-local-config" ] && [ -f "$ROOT_DIR/.local-config.json" ]; then
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    fs.writeFileSync(process.argv[2], JSON.stringify({
      m3uUrl: c.m3uUrl || "",
      epgUrl: c.epgUrl || "",
      catchupMode: c.catchupMode || "auto",
      catchupDays: c.catchupDays || 3
    }, null, 2) + "\n");
  ' "$ROOT_DIR/.local-config.json" "$USB_DIR/iptv.json"
else
  cat > "$USB_DIR/iptv.json" << 'EOF'
{
  "m3uUrl": "http://YOUR-PROVIDER-URL/get.php?username=USER&password=PASS&type=m3u_plus&output=ts",
  "epgUrl": "http://YOUR-PROVIDER-URL/xmltv.php?username=USER&password=PASS",
  "catchupMode": "auto",
  "catchupDays": 3
}
EOF
fi

cat > "$USB_DIR/INSTALL-FROM-MAC.command" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
WGT_FILE="$PWD/userwidget/vertIPTV.wgt"
A2S_VERSION="v3.2.0"
CACHE_DIR="${TMPDIR:-/tmp}/vertiptv-a2s-${A2S_VERSION}"
BIN="$CACHE_DIR/apps2samsung-cli"

WIFI_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"

echo "========================================================"
echo "  vertIPTV — Standalone Samsung TV Installer (macOS)"
echo "========================================================"
echo ""
echo "1. Make sure your Samsung TV and this Mac are on the SAME Wi-Fi."
echo "2. On the TV: Home -> Apps -> press 12345"
echo "3. Set Developer Mode = ON, and set Host PC IP to:"
echo ""
echo "      >>>  ${WIFI_IP:-YOUR_MAC_WIFI_IP}  <<<"
echo ""
echo "   (This is ONLY a 10-second permission so this Mac can copy"
echo "    vertIPTV into the TV's memory. Once installed, vertIPTV"
echo "    lives inside the TV permanently and needs NO computer!)"
echo "4. Hold the TV remote Power button for 3 seconds until the TV reboots."
echo ""
read -r -p "Press [Enter] once your Samsung TV has finished rebooting..." _

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE_DIR"
  ARCH="$(uname -m)"
  ASSET="Apps2Samsung-cli-${A2S_VERSION}-osx-arm64.tar.gz"
  [ "$ARCH" = "x86_64" ] && ASSET="Apps2Samsung-cli-${A2S_VERSION}-osx-x64.tar.gz"
  echo "Downloading Samsung TV installer..."
  curl -fsSL "https://github.com/Apps2Samsung/Apps2Samsung/releases/download/${A2S_VERSION}/${ASSET}" -o "$CACHE_DIR/cli.tar.gz"
  tar -xzf "$CACHE_DIR/cli.tar.gz" -C "$CACHE_DIR"
  chmod +x "$BIN"
  xattr -cr "$CACHE_DIR" 2>/dev/null || true
fi

echo "Scanning Wi-Fi for your Samsung TV..."
TV_IP="$("$BIN" scan --json 2>/dev/null | sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([0-9.]*\)".*/\1/p' | head -n 1)"
if [ -z "$TV_IP" ]; then
  read -r -p "Could not auto-detect TV. Type your TV's IP (Settings -> General -> Network -> Network Status): " TV_IP
fi

echo "Installing vertIPTV onto Samsung TV ($TV_IP)..."
if ! "$BIN" install "$WGT_FILE" --tv "$TV_IP" --tizen-cert public --tizen-chain legacy --launch -y; then
  echo "Switching to 1-time Samsung certificate sign-in..."
  "$BIN" install "$WGT_FILE" --tv "$TV_IP" --samsung-cert --launch --allow-remove -y
fi
echo ""
echo "DONE! vertIPTV is now permanently installed inside your Samsung TV!"
read -r -p "Press [Enter] to close..." _
EOF
chmod +x "$USB_DIR/INSTALL-FROM-MAC.command"

cat > "$USB_DIR/INSTALL-FROM-WINDOWS.bat" << 'EOF'
@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; " ^
  "$wgt = Join-Path $PWD 'userwidget\vertIPTV.wgt'; " ^
  "$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Select-Object -First 1).IPv4Address.IPAddress; " ^
  "Write-Host '========================================================' -ForegroundColor Cyan; " ^
  "Write-Host '  vertIPTV - Standalone Samsung TV Installer (Windows)' -ForegroundColor Cyan; " ^
  "Write-Host '========================================================'; " ^
  "Write-Host ''; " ^
  "Write-Host '1. Connect your Samsung TV and this PC to the SAME Wi-Fi/router.'; " ^
  "Write-Host '2. On the TV: Home -> Apps -> press 12345 on the remote.'; " ^
  "Write-Host '3. Turn Developer Mode ON, and enter this PC IP in Host PC IP:'; " ^
  "Write-Host ('      >>>  ' + $ip + '  <<<') -ForegroundColor Yellow; " ^
  "Write-Host '   (Only used for 10 seconds to send the app to the TV; no PC needed after!)'; " ^
  "Write-Host '4. Hold the TV remote Power button for 3 seconds until the TV reboots.'; " ^
  "Read-Host 'Press Enter once the TV is back on'; " ^
  "$dir = Join-Path $env:TEMP 'vertiptv-a2s-v3.2.0'; " ^
  "$exe = Join-Path $dir 'apps2samsung-cli.exe'; " ^
  "if (!(Test-Path $exe)) { " ^
  "  New-Item -ItemType Directory -Force -Path $dir | Out-Null; " ^
  "  $zip = Join-Path $dir 'cli.zip'; " ^
  "  Write-Host 'Downloading Samsung TV installer...'; " ^
  "  Invoke-WebRequest -UseBasicParsing 'https://github.com/Apps2Samsung/Apps2Samsung/releases/download/v3.2.0/Apps2Samsung-cli-v3.2.0-win-x64.zip' -OutFile $zip; " ^
  "  Expand-Archive -Force $zip $dir; " ^
  "} " ^
  "$scan = & $exe scan --json | ConvertFrom-Json; " ^
  "$tvIp = if ($scan.tvs.Count -gt 0) { $scan.tvs[0].ip } else { Read-Host 'Enter Samsung TV IP (Settings -> General -> Network -> Network Status)' }; " ^
  "Write-Host ('Installing vertIPTV to ' + $tvIp + '...'); " ^
  "& $exe install $wgt --tv $tvIp --tizen-cert public --tizen-chain legacy --launch -y; " ^
  "if ($LASTEXITCODE -ne 0) { & $exe install $wgt --tv $tvIp --samsung-cert --launch --allow-remove -y }; " ^
  "Write-Host 'DONE! vertIPTV is permanently installed on your Samsung TV!' -ForegroundColor Green; " ^
  "Read-Host 'Press Enter to exit'"
EOF

cat > "$USB_DIR/README-INSTALL.txt" << 'EOF'
vertIPTV — Samsung TV USB & Install Guide
=========================================

WHY CONSUMER SAMSUNG TVs DO NOT AUTO-INSTALL .WGT FROM USB:
Retail Samsung Tizen TVs (2016–2026) have no APK-style file installer UI and block
consumer USB "userwidget" sideloading.

1) EASIEST WAY TO INSTALL vertIPTV ON YOUR SAMSUNG TV (NO TIZEN STUDIO!):
   • On your TV: Open Apps -> press 12345 (on 2024+ TVs: Apps -> Settings gear -> 12345)
     -> toggle Developer Mode ON -> enter your computer's Wi-Fi IP -> hold Power 3s to reboot.
   • On your Mac/PC: Run ONE command:
       npm run tv:install
     (Or run `npm start` and open http://localhost:8787/install for 1-click browser install!)

2) OPTIONAL — INSTALL FUTURE BUILDS DIRECTLY ON THE TV WITHOUT A PC:
   • Run `npm run tv:arm-store` once. Then upload any .wgt to http://<TV_IP>:8077/upload
     from your phone or laptop and press OK ("Install on this TV") on your Samsung remote!

3) WHAT THIS USB STICK DOES ON RETAIL SAMSUNG TVs:
   • Edit `iptv.json` (or drop `playlist.m3u` + `epg.xml`) in the root of this FAT32 USB stick.
   • Plug into your Samsung TV and click "Import from USB" inside vertIPTV — zero remote typing!

4) SAMSUNG COMMERCIAL / HOSPITALITY / SIGNAGE DISPLAYS (SSSP ONLY):
   • The `SSSP/` folder contains `sssp_config.xml` + `vertIPTV.wgt` for Home -> URL Launcher -> Install from USB.
EOF

echo "💾 USB bundle ready at: $USB_DIR"
(cd "$USB_DIR" && rm -f "$ROOT_DIR/dist/vertIPTV-usb-kit.zip" && zip -qr "$ROOT_DIR/dist/vertIPTV-usb-kit.zip" .)
echo "📦 Portable USB & Windows/Mac/Phone kit zipped at: $ROOT_DIR/dist/vertIPTV-usb-kit.zip"
echo "🚀 Ready to install onto your Samsung TV in 1 command (no Tizen Studio needed):"
echo "   npm run tv:install"
