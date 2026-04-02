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

create_source_bundle() {
  local dir="$1"
  mkdir -p "$dir/internal"
  cat > "$dir/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "test releasectl"
EOF
chmod +x "$dir/releasectl"
cat > "$dir/internal/fleet.env" <<'EOF'
TEST_VAR=1
EOF
cat > "$dir/internal/deploy.sh" <<'EOF'
#!/usr/bin/env bash
echo "deploy"
EOF
chmod +x "$dir/internal/deploy.sh"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

remote="$tmpdir/remote.git"
upstream="$tmpdir/upstream"
controlled="$tmpdir/controlled"
dst_root="$tmpdir/installed-bundle"
source_root="$tmpdir/source"

mkdir -p "$dst_root"
create_source_bundle "$source_root"

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

(
  cd "$upstream"
  echo "v2" > controlled.txt
  git commit -am "update" >/dev/null
  git push >/dev/null
)

before="$(git -C "$controlled" rev-parse HEAD)"

set +e
out="$(
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$source_root" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$controlled" \
  RELEASECTL_CONTROLLED_REMOTE=origin \
  RELEASECTL_CONTROLLED_BRANCH=main \
  RELEASECTL_ENFORCE_CONTROLLED_PARITY=0 \
  bash "$SYNC_SCRIPT" --sync
) 2>&1"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  fail "expected bundle sync with controlled-repo sync to succeed"
fi

after="$(git -C "$controlled" rev-parse HEAD)"

[[ "$before" != "$after" ]] || fail "expected controlled repo HEAD to advance"
[[ "$out" == *"SYNCED   controlled-repo (origin/main)"* ]] || fail "expected controlled repo sync message"

pass "bundle-sync --sync fast-forwards controlled repo before syncing installed bundle"
