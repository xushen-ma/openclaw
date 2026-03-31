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

src_root="$tmpdir/source-fleet"
dst_root="$tmpdir/installed-bundle"
mkdir -p "$src_root" "$dst_root"
cp -R "$SOURCE_ROOT"/. "$src_root"/

# Simulate incomplete source manifest; sync must not report success.
rm -f "$src_root/internal/fleet.env"

set +e
out="$({
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$src_root" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$tmpdir/no-controlled-repo" \
  bash "$SYNC_SCRIPT" --sync
} 2>&1)"
rc=$?
set -e

[[ "$rc" -ne 0 ]] || fail "expected bundle sync to fail when source manifest is incomplete"
[[ "$out" == *"SOURCE-MISSING internal/fleet.env"* ]] || fail "expected source-missing report for removed file"
[[ "$out" == *"Residual drift remains after sync"* ]] || fail "expected explicit residual-drift failure message"

pass "bundle-sync --sync fails closed when residual drift remains"
