#!/usr/bin/env bash
# Test: import-source --dry-run makes no changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

echo "TEST import-source-dry-run"

# Create mock source repo
SOURCE_REPO="$TEST_ROOT/source"
git init -q "$SOURCE_REPO"
mkdir -p "$SOURCE_REPO/scripts/fleet/internal"

cat > "$SOURCE_REPO/scripts/fleet/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "v2"
EOF
chmod +x "$SOURCE_REPO/scripts/fleet/releasectl"

cat > "$SOURCE_REPO/scripts/fleet/internal/fleet.env" <<'EOF'
VAR=v2
EOF

git -C "$SOURCE_REPO" add .
git -C "$SOURCE_REPO" commit -qm "Version 2"
SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse HEAD)"

# Create mock controlled repo with v1
CONTROLLED_REPO="$TEST_ROOT/controlled"
git init -q "$CONTROLLED_REPO"
mkdir -p "$CONTROLLED_REPO/bin" "$CONTROLLED_REPO/internal"

cat > "$CONTROLLED_REPO/bin/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "v1"
EOF
chmod +x "$CONTROLLED_REPO/bin/releasectl"

cat > "$CONTROLLED_REPO/internal/fleet.env" <<'EOF'
VAR=v1
EOF

git -C "$CONTROLLED_REPO" add .
git -C "$CONTROLLED_REPO" commit -qm "Version 1"

CONTROLLED_REMOTE="$TEST_ROOT/controlled-remote.git"
git init -q --bare "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" remote add origin "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" push -q origin main

BEFORE_HEAD="$(git -C "$CONTROLLED_REPO" rev-parse HEAD)"
BEFORE_REMOTE_HEAD="$(git -C "$CONTROLLED_REMOTE" rev-parse HEAD)"

set +e
OUTPUT="$(
  RELEASECTL_SOURCE_REPO="$SOURCE_REPO" \
  RELEASECTL_CONTROLLED_REPO="$CONTROLLED_REPO" \
  RELEASECTL_CONTROLLED_REMOTE="origin" \
  RELEASECTL_CONTROLLED_BRANCH="main" \
  bash "$SCRIPT_DIR/import-source.sh" \
    "$SOURCE_SHA" \
    --dry-run \
  2>&1
)"
rc=$?
set -e

if [[ "$rc" -ne 0 ]]; then
  echo "FAIL import-source --dry-run failed"
  echo "$OUTPUT"
  exit 1
fi

# Verify dry-run message present
if ! grep -q "DRY-RUN" <<< "$OUTPUT"; then
  echo "FAIL missing DRY-RUN marker"
  echo "$OUTPUT"
  exit 1
fi

# Verify no commit was made
AFTER_HEAD="$(git -C "$CONTROLLED_REPO" rev-parse HEAD)"
if [[ "$BEFORE_HEAD" != "$AFTER_HEAD" ]]; then
  echo "FAIL controlled repo HEAD changed during dry-run"
  exit 1
fi

# Verify remote unchanged
AFTER_REMOTE_HEAD="$(git -C "$CONTROLLED_REMOTE" rev-parse HEAD)"
if [[ "$BEFORE_REMOTE_HEAD" != "$AFTER_REMOTE_HEAD" ]]; then
  echo "FAIL remote changed during dry-run"
  exit 1
fi

# Verify working tree still has v1
if ! grep -q "echo \"v1\"" "$CONTROLLED_REPO/bin/releasectl"; then
  echo "FAIL working tree was modified during dry-run"
  exit 1
fi

echo "PASS"
