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

remote="$tmpdir/remote.git"
upstream="$tmpdir/upstream"
controlled="$tmpdir/controlled"
dst_root="$tmpdir/installed-bundle"

mkdir -p "$dst_root"

git init --bare "$remote" >/dev/null

git clone "$remote" "$upstream" >/dev/null
(
  cd "$upstream"
  git checkout -b main >/dev/null
  git config user.email "test@example.com"
  git config user.name "test"
  echo "v1" > controlled.txt
  git add controlled.txt
  git commit -m "init" >/dev/null
  git push -u origin main >/dev/null
)

git clone "$remote" "$controlled" >/dev/null
(
  cd "$controlled"
  git checkout main >/dev/null 2>&1 || git checkout -b main origin/main >/dev/null
)

# Add a new upstream commit so controlled repo is behind.
(
  cd "$upstream"
  echo "v2" > controlled.txt
  git commit -am "update" >/dev/null
  git push >/dev/null
)

before="$(git -C "$controlled" rev-parse HEAD)"

out="$({
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$SOURCE_ROOT" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$controlled" \
  RELEASECTL_CONTROLLED_REMOTE=origin \
  RELEASECTL_CONTROLLED_BRANCH=main \
  bash "$SYNC_SCRIPT" --sync
} 2>&1)" || fail "expected bundle sync with controlled-repo sync to succeed"

after="$(git -C "$controlled" rev-parse HEAD)"

[[ "$before" != "$after" ]] || fail "expected controlled repo HEAD to advance"
[[ "$out" == *"SYNCED   controlled-repo (origin/main)"* ]] || fail "expected controlled repo sync message"

pass "bundle-sync --sync fast-forwards controlled repo before syncing installed bundle"
