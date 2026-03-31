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

remote="$tmpdir/controlled-remote.git"
controlled="$tmpdir/controlled"
dst_root="$tmpdir/installed"
mkdir -p "$dst_root"

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

# Diverge controlled content from source while keeping repo otherwise healthy.
printf '\n# drift\n' >> "$controlled/internal/deploy.sh"

set +e
out="$({
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$SOURCE_ROOT" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$controlled" \
  bash "$SYNC_SCRIPT" --check
} 2>&1)"
rc=$?
set -e

[[ "$rc" -ne 0 ]] || fail "expected check to fail when controlled content diverges from source"
[[ "$out" == *"CONTROL-DIFF internal/deploy.sh"* ]] || fail "expected explicit controlled diff report"
[[ "$out" == *"Controlled import path is not converged"* ]] || fail "expected fail-closed controlled-import message"

pass "bundle-sync fails closed when source->controlled import content diverges"
