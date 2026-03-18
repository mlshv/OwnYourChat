#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  exit 1
fi

PLIST_NAME="com.${USER}.ownyourchat.agent.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LABEL="com.${USER}.ownyourchat.agent"

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Uninstalled LaunchAgent: $LABEL"
