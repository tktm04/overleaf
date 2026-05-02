#!/usr/bin/env bash
# Installs claude-sidecar as a per-user LaunchAgent so it starts at login
# and is restarted on crash. Idempotent — safe to re-run.

set -euo pipefail

LABEL="com.overleaf.claude-sidecar"
SIDECAR_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd -P )"
PLIST_TEMPLATE="${SIDECAR_DIR}/launchd/${LABEL}.plist.template"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/claude-sidecar"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "${NODE_BIN}" ]]; then
  echo "Could not find 'node' on PATH. Set NODE_BIN=/path/to/node and re-run." >&2
  exit 1
fi

if [[ ! -d "${SIDECAR_DIR}/node_modules" ]]; then
  echo "Running npm install in ${SIDECAR_DIR}…"
  ( cd "${SIDECAR_DIR}" && npm install )
fi

mkdir -p "${LOG_DIR}"
mkdir -p "$(dirname "${PLIST_DEST}")"

# Substitute paths into the template.
sed \
  -e "s|__NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__SIDECAR_DIR__|${SIDECAR_DIR}|g" \
  -e "s|__HOME__|${HOME}|g" \
  "${PLIST_TEMPLATE}" > "${PLIST_DEST}"

# Reload if already loaded.
if launchctl list | grep -q "${LABEL}"; then
  launchctl unload "${PLIST_DEST}" || true
fi
launchctl load "${PLIST_DEST}"

echo "Installed ${PLIST_DEST}"
echo "Logs:   ${LOG_DIR}/{out,err}.log"
echo
echo "Sidecar should now be reachable at http://127.0.0.1:8888/health"
echo "  curl http://127.0.0.1:8888/health"
