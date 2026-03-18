#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_NAME="com.${USER}.ownyourchat.agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs/ownyourchat"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.${USER}.ownyourchat.agent</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd \"$REPO_DIR\" && OYC_BACKGROUND=1 OYC_SYNC_INTERVAL_MS=1800000 pnpm start</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/agent.out.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/agent.err.log</string>
</dict>
</plist>
EOF

# Reload launchd job
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/com.${USER}.ownyourchat.agent"
launchctl kickstart -k "gui/$(id -u)/com.${USER}.ownyourchat.agent"

echo "Installed and started: $PLIST_PATH"
echo "Logs: $LOG_DIR"
