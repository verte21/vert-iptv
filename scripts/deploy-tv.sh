#!/usr/bin/env bash
set -euo pipefail

# Zero-Tizen-Studio 1-Command Installer for Samsung Tizen TVs (2017–2026 / Tizen 3.0–10.0)
# Usage:
#   npm run tv:install                       # Auto-find TV on Wi-Fi, build, sign, install & launch!
#   ./scripts/deploy-tv.sh <TV_IP>           # Install to a specific Samsung TV IP
#   npm run tv:scan                          # Scan Wi-Fi & diagnose Developer Mode / Host PC IP
#   npm run tv:arm-store [TV_IP]             # Install & arm TV-Store for future browser uploads (:8077/upload)
#   ./scripts/deploy-tv.sh <TV_IP> <PROFILE> # Legacy Tizen Studio profile mode (optional)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="install"
TV_IP=""
CERT_PROFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --scan|-s)
      MODE="scan"
      shift
      ;;
    --arm-tvstore|--arm-store)
      MODE="arm-tvstore"
      shift
      ;;
    --help|-h)
      echo "Usage:"
      echo "  npm run tv:install                     # Auto-discover TV, build, sign, install & launch"
      echo "  ./scripts/deploy-tv.sh <SAMSUNG_TV_IP> # Target specific TV IP"
      echo "  npm run tv:scan                        # Scan Wi-Fi for Samsung TVs & check Developer Mode"
      echo "  npm run tv:arm-store [SAMSUNG_TV_IP]   # Install & arm TV-Store (:8077/upload on-TV installer)"
      exit 0
      ;;
    *)
      if [ -z "$TV_IP" ]; then
        TV_IP="$1"
      elif [ -z "$CERT_PROFILE" ]; then
        CERT_PROFILE="$1"
      fi
      shift
      ;;
  esac
done

get_mac_lan_ip() {
  node -e '
    const os = require("os");
    const nets = os.networkInterfaces();
    for (const k of Object.keys(nets)) {
      for (const n of nets[k] || []) {
        if (n.family === "IPv4" && !n.internal) { console.log(n.address); process.exit(0); }
      }
    }
    console.log("127.0.0.1");
  '
}

print_devmode_guide() {
  local host_ip="$1"
  echo ""
  echo "📺 Quick 1-Time Samsung TV Developer Mode Checklist:"
  echo "   1. Turn ON your Samsung TV and make sure it is on the same Wi-Fi/LAN as this computer."
  echo "   2. Open 'Apps' on your TV:"
  echo "      • 2015–2023 TVs: Press 1-2-3-4-5 on the remote inside Apps."
  echo "      • 2024–2026 TVs (Tizen 8/9/10): Scroll to 'App Settings' (gear icon at bottom of Apps) -> press 1-2-3-4-5."
  echo "   3. Toggle 'Developer Mode' ON and set 'Host PC IP' to:  ${host_ip}"
  echo "   4. Hold the TV remote Power button for 3 seconds until the Samsung logo reboots the TV."
  echo ""
}

# Legacy Tizen Studio path ONLY if user explicitly passed a Tizen Studio CERT_PROFILE
if [ -n "$CERT_PROFILE" ]; then
  SDB_BIN="$(command -v sdb 2>/dev/null || echo "$HOME/tizen-studio/tools/sdb")"
  TIZEN_BIN="$(command -v tizen 2>/dev/null || echo "$HOME/tizen-studio/tools/ide/bin/tizen")"
  if [ -x "$SDB_BIN" ] && [ -x "$TIZEN_BIN" ]; then
    bash "$ROOT_DIR/scripts/build-wgt.sh" "$CERT_PROFILE"
    "$SDB_BIN" connect "$TV_IP"
    TARGET_NAME="$("$SDB_BIN" devices | awk 'NR>1 && $2=="device" {print $3; exit}')"
    WGT_PATH="$(ls -t "$ROOT_DIR/dist/"*.wgt | head -n 1)"
    "$TIZEN_BIN" install -n "$WGT_PATH" -t "$TARGET_NAME"
    "$TIZEN_BIN" run -p VertIPTV00.vertIPTV -t "$TARGET_NAME" || true
    exit 0
  fi
fi

A2S_BIN="$(bash "$ROOT_DIR/scripts/ensure-installer.sh")"
HOST_IP="$(get_mac_lan_ip)"

if [ "$MODE" = "scan" ]; then
  echo "🔍 Scanning Wi-Fi (Host IP: $HOST_IP) for Samsung Tizen TVs..."
  SCAN_JSON="$("$A2S_BIN" scan --json)"
  node -e '
    const data = JSON.parse(process.argv[1]);
    const hostIp = process.argv[2];
    const tvs = data.tvs || [];
    if (!tvs.length) {
      console.log("⚠️  No powered-on Samsung TVs responded on the local network (" + (data.localIp || hostIp) + ").");
      process.exit(2);
    }
    console.log("Found " + tvs.length + " Samsung TV(s):");
    for (const tv of tvs) {
      console.log("  • " + (tv.name || tv.model || "Samsung TV") + " — IP: " + (tv.ip || tv.address));
      console.log("    Details: " + JSON.stringify(tv));
    }
  ' "$SCAN_JSON" "$HOST_IP" || {
    print_devmode_guide "$HOST_IP"
    exit 1
  }
  exit 0
fi

# Auto-discover TV IP if not supplied
if [ -z "$TV_IP" ]; then
  echo "🔍 Auto-discovering Samsung TV on Wi-Fi (Mac IP: $HOST_IP)..."
  SCAN_JSON="$("$A2S_BIN" scan --json 2>/dev/null || echo '{"tvs":[]}')"
  TV_IP="$(node -e '
    try {
      const d = JSON.parse(process.argv[1]);
      const tvs = d.tvs || [];
      if (tvs.length > 0) {
        const ip = tvs[0].ip || tvs[0].address || "";
        if (ip) process.stdout.write(ip);
      }
    } catch {}
  ' "$SCAN_JSON")"

  if [ -z "$TV_IP" ]; then
    echo "❌ Could not auto-detect a powered-on Samsung TV on your network ($HOST_IP)."
    echo "   • Turn your TV ON, or pass its IP explicitly:  npm run tv:install -- 192.168.x.x"
    print_devmode_guide "$HOST_IP"
    exit 1
  fi
  echo "✅ Found Samsung TV at: $TV_IP"
fi

echo "🩺 Checking Samsung TV readiness at $TV_IP..."
"$A2S_BIN" tv "$TV_IP" --plain || true

if [ "$MODE" = "arm-tvstore" ]; then
  echo ""
  echo "🏪 Installing & arming Apps2Samsung TV-Store on $TV_IP..."
  echo "   (Once armed, you can upload any .wgt build straight to http://${TV_IP}:8077/upload and press OK on your TV remote!)"
  "$A2S_BIN" install "TV-Store" --tv "$TV_IP" --samsung-cert --launch -y
  sleep 3
  "$A2S_BIN" tvstore --tv "$TV_IP" -y
  echo ""
  echo "✅ TV-Store is installed and armed on $TV_IP!"
  echo "   • Optional: Set Developer Mode 'Host PC IP' on your TV to 127.0.0.1 and reboot once."
  echo "   • Anytime you build a new vertIPTV.wgt, open http://${TV_IP}:8077/upload from your Mac or Phone,"
  echo "     drop dist/vertIPTV.wgt, and press OK ('Install on this TV') on your Samsung remote!"
  exit 0
fi

# Build fresh dist/vertIPTV.wgt
bash "$ROOT_DIR/scripts/build-wgt.sh"
WGT_FILE="$ROOT_DIR/dist/vertIPTV.wgt"

# Check if we already have a cached Samsung DUID certificate covering this TV
HAS_SAMSUNG_CERT="$("$A2S_BIN" cert --tv "$TV_IP" --json 2>/dev/null | node -e '
  try {
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const txt = JSON.stringify(d).toLowerCase();
    process.stdout.write(txt.includes("\"covers\":true") || txt.includes("\"covered\":true") ? "1" : "0");
  } catch { process.stdout.write("0"); }
')"

if [ "$HAS_SAMSUNG_CERT" = "1" ]; then
  echo "🔐 Installing vertIPTV using cached Samsung DUID certificate..."
  "$A2S_BIN" install "$WGT_FILE" --tv "$TV_IP" --samsung-cert --launch -y
  echo "✅ vertIPTV is installed and launched on your Samsung TV ($TV_IP)!"
  exit 0
fi

echo "⚡ Step 1/2: Trying instant zero-login Tizen CA install (works on 2017–2021 Tizen 3.0–6.0 TVs)..."
INSTALL_OUT=""
set +e
INSTALL_OUT="$("$A2S_BIN" install "$WGT_FILE" --tv "$TV_IP" --tizen-cert public --tizen-chain legacy --launch -y 2>&1)"
INSTALL_CODE=$?
set -e

if [ "$INSTALL_CODE" -eq 0 ]; then
  echo "$INSTALL_OUT"
  echo "✅ vertIPTV installed & launched on your Samsung TV ($TV_IP) with zero login!"
  exit 0
fi

# Check if the TV rejected the Tizen SDK CA chain (e.g. [118, -12], 118012 on 2015–2018 sets needing device-profile.xml, <-2>, <-3>)
if printf '%s' "$INSTALL_OUT" | grep -qiE 'Invalid certificate|118012|\-12|<-2>|<-3>|Samsung certificate|certificate error'; then
  echo "ℹ️  Your TV requires a free DUID-bound Samsung Certificate (pushes device-profile.xml automatically on 2015–2018 sets)."
  echo "🔐 Step 2/2: Switching automatically to Samsung Certificate sign-in (1-time browser login, cached forever)..."
  "$A2S_BIN" install "$WGT_FILE" --tv "$TV_IP" --samsung-cert --launch --allow-remove -y
  echo "✅ vertIPTV is installed and launched on your Samsung TV ($TV_IP)!"
  exit 0
fi

echo "$INSTALL_OUT" >&2
print_devmode_guide "$HOST_IP"
exit "$INSTALL_CODE"
