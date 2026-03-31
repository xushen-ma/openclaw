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
remote="$tmpdir/controlled-remote.git"
controlled="$tmpdir/controlled"
mkdir -p "$src_root" "$dst_root"
cp -R "$SOURCE_ROOT"/. "$src_root"/

git init --bare "$remote" >/dev/null
git clone "$remote" "$controlled" >/dev/null
(
  cd "$controlled"
  git checkout -b main >/dev/null
  git config user.email "test@example.com"
  git config user.name "test"
  mkdir -p bin internal
  cp "$SOURCE_ROOT/releasectl" "bin/releasectl"
  cp "$SOURCE_ROOT/internal/"*.sh "internal/"
  cp "$SOURCE_ROOT/internal/fleet.env" "internal/fleet.env"
  git add bin/releasectl internal
  git commit -m "seed controlled bundle" >/dev/null
  git push -u origin main >/dev/null
)

# Simulate incomplete source manifest; sync must fail-closed before install writes.
rm -f "$src_root/internal/fleet.env"

set +e
out="$({
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$src_root" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$controlled" \
  bash "$SYNC_SCRIPT" --sync
} 2>&1)"
rc=$?
set -e

[[ "$rc" -ne 0 ]] || fail "expected bundle sync to fail when source manifest is incomplete"
[[ "$out" == *"CONTROL-SOURCE-MISSING internal/fleet.env"* ]] || fail "expected controlled-alignment source-missing report"
[[ "$out" == *"Controlled import path is not converged"* ]] || fail "expected explicit controlled-import failure message"

pass "bundle-sync --sync fails closed when residual drift remains"
