#!/usr/bin/env bash
# Removes the claude-sidecar LaunchAgent installed by install.sh.

set -euo pipefail

LABEL="com.overleaf.claude-sidecar"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if launchctl list | grep -q "${LABEL}"; then
  launchctl unload "${PLIST_DEST}" 2>/dev/null || true
fi
rm -f "${PLIST_DEST}"
echo "Uninstalled ${PLIST_DEST}"
