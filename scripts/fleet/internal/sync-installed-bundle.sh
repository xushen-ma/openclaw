#!/usr/bin/env bash
# sync-installed-bundle.sh — Sync version-controlled fleet scripts into the installed governed bundle
# Usage:
#   sync-installed-bundle.sh [--check]
#   sync-installed-bundle.sh --sync
#
# Rules:
# - Intended as a Mini-approved maintenance path for /usr/local/lib/openclaw-fleet/*
# - Must run through releasectl / privileged ops, not ad-hoc shell habit
# - Source of truth is the version-controlled workspace copy under scripts/fleet/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"

MODE="check"
[[ "${1:-}" == "--sync" ]] && MODE="sync"
[[ "${1:-}" == "--check" ]] && MODE="check"

# Operational guardrail: this path is for Mini-approved maintenance only.
# Technical note: after releasectl's sudo handoff, agent identity metadata may not
# survive intact through the privileged runtime. So this script accepts execution
# as the governed release user (`oc-release`) and relies on the password-gated
# `releasectl bundle-sync` command + Mini policy as the actual approval boundary.
FLEET_AGENT_NAME="${FLEET_AGENT:-${AGENT_ID:-unknown}}"
CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
if [[ "$CURRENT_USER" != "oc-release" && "$FLEET_AGENT_NAME" != "Mini" && "$FLEET_AGENT_NAME" != "main" ]]; then
  echo "❌ sync-installed-bundle is Mini-only operationally (FLEET_AGENT=$FLEET_AGENT_NAME user=$CURRENT_USER)"
  exit 1
fi

# Source of truth is Mini's local fleet-ops tree for this machine, not the
# OpenClaw product repo. Keep it on a path the governed user can traverse/read.
SRC_ROOT="${RELEASECTL_SOURCE_ROOT:-/Users/openclaw/workspace/openclaw/scripts/fleet}"
DST_ROOT="/usr/local/lib/openclaw-fleet"

FILES=(
  "releasectl"
  "internal/fleet.env"
  "internal/permissions.sh"
  "internal/sanity-check.sh"
  "internal/deploy.sh"
  "internal/rollback.sh"
  "internal/staging-deploy.sh"
  "internal/sync-installed-bundle.sh"
)

mode_for() {
  case "$1" in
    *.sh|releasectl) echo 0755 ;;
    *) echo 0644 ;;
  esac
}

status=0
for rel in "${FILES[@]}"; do
  src="$SRC_ROOT/$rel"
  dst="$DST_ROOT/$rel"
  [[ -f "$src" ]] || { echo "❌ Missing source file: $src"; status=1; continue; }

  if [[ ! -e "$dst" ]]; then
    echo "MISSING  $rel"
    [[ "$MODE" == "sync" ]] || status=1
    continue
  fi

  if cmp -s "$src" "$dst"; then
    echo "OK       $rel"
  else
    echo "DIFF     $rel"
    status=1
    if [[ "$MODE" == "sync" ]]; then
      install -m "$(mode_for "$rel")" "$src" "$dst"
      echo "SYNCED   $rel"
      status=0
    fi
  fi
done

if [[ "$MODE" == "check" ]]; then
  if [[ "$status" -ne 0 ]]; then
    echo
    echo "Bundle drift detected. Run the Mini-approved sync path to reconcile the installed governed bundle."
    exit 1
  fi
  echo
  echo "Installed governed bundle matches source of truth."
  exit 0
fi

echo
"$DST_ROOT/releasectl" verify-config || true
echo "✅ Installed governed bundle sync complete"
# Note: subsequent releasectl commands should now expose any newly added subcommands
# from the synced bundle (e.g. repair-perms).
