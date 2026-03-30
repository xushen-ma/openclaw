#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/sync-installed-bundle.sh"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

dst_root="$tmpdir/installed-bundle"
mkdir -p "$dst_root"

out="$({
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$SOURCE_ROOT" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$tmpdir/no-controlled-repo" \
  bash "$SYNC_SCRIPT" --sync
} 2>&1)" || fail "expected bundle sync to succeed"

[[ -f "$dst_root/internal/promote-production.sh" ]] || fail "expected promote-production.sh to be installed when missing"
[[ -x "$dst_root/internal/promote-production.sh" ]] || fail "expected promote-production.sh to be executable"
[[ "$out" == *"SYNCED   internal/promote-production.sh"* ]] || fail "expected sync output to include promote-production.sh"

pass "sync-installed-bundle installs missing internal commands (including promote-production.sh)"
