#!/usr/bin/env bash
# Test: import-source basic flow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

echo "TEST import-source-basic"

# Create mock source repo
SOURCE_REPO="$TEST_ROOT/source"
git init -q "$SOURCE_REPO"
mkdir -p "$SOURCE_REPO/scripts/fleet/internal"

cat > "$SOURCE_REPO/scripts/fleet/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "test releasectl"
EOF
chmod +x "$SOURCE_REPO/scripts/fleet/releasectl"

cat > "$SOURCE_REPO/scripts/fleet/internal/test.sh" <<'EOF'
#!/usr/bin/env bash
echo "test script"
EOF
chmod +x "$SOURCE_REPO/scripts/fleet/internal/test.sh"

cat > "$SOURCE_REPO/scripts/fleet/internal/fleet.env" <<'EOF'
TEST_VAR=test
EOF

git -C "$SOURCE_REPO" add .
git -C "$SOURCE_REPO" commit -qm "Initial commit"
SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse HEAD)"

# Create mock controlled repo
CONTROLLED_REPO="$TEST_ROOT/controlled"
git init -q "$CONTROLLED_REPO"
echo "# Controlled repo" > "$CONTROLLED_REPO/README.md"
git -C "$CONTROLLED_REPO" add README.md
git -C "$CONTROLLED_REPO" commit -qm "Initial controlled"

# Create bare remote for controlled
CONTROLLED_REMOTE="$TEST_ROOT/controlled-remote.git"
git init -q --bare "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" remote add origin "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" push -q origin main

OUTPUT="$(
  RELEASECTL_SOURCE_REPO="$SOURCE_REPO" \
  RELEASECTL_CONTROLLED_REPO="$CONTROLLED_REPO" \
  RELEASECTL_CONTROLLED_REMOTE="origin" \
  RELEASECTL_CONTROLLED_BRANCH="main" \
  bash "$SCRIPT_DIR/import-source.sh" \
    "$SOURCE_SHA" \
    2>&1
)"

# Verify output contains expected markers
if ! grep -q "SOURCE-REF" <<< "$OUTPUT"; then
  echo "FAIL missing SOURCE-REF in output"
  echo "$OUTPUT"
  exit 1
fi

if ! grep -q "VERIFY-OK" <<< "$OUTPUT"; then
  echo "FAIL missing VERIFY-OK in output"
  echo "$OUTPUT"
  exit 1
fi

if ! grep -q "✅ Source import complete" <<< "$OUTPUT"; then
  echo "FAIL missing success marker"
  echo "$OUTPUT"
  exit 1
fi

# Verify files were imported
if ! cmp -s "$SOURCE_REPO/scripts/fleet/releasectl" "$CONTROLLED_REPO/bin/releasectl"; then
  echo "FAIL bin/releasectl content mismatch"
  exit 1
fi

if ! cmp -s "$SOURCE_REPO/scripts/fleet/internal/test.sh" "$CONTROLLED_REPO/internal/test.sh"; then
  echo "FAIL internal/test.sh content mismatch"
  exit 1
fi

if ! cmp -s "$SOURCE_REPO/scripts/fleet/internal/fleet.env" "$CONTROLLED_REPO/internal/fleet.env"; then
  echo "FAIL internal/fleet.env content mismatch"
  exit 1
fi

# Verify commit has provenance
LAST_COMMIT_MSG="$(git -C "$CONTROLLED_REPO" log -1 --pretty=%B)"

if ! grep -q "Import fleet scripts from source" <<< "$LAST_COMMIT_MSG"; then
  echo "FAIL missing import message"
  exit 1
fi

if ! grep -q "Source-SHA: $SOURCE_SHA" <<< "$LAST_COMMIT_MSG"; then
  echo "FAIL missing Source-SHA in commit"
  exit 1
fi

if ! grep -q "Imported-By:" <<< "$LAST_COMMIT_MSG"; then
  echo "FAIL missing Imported-By in commit"
  exit 1
fi

# Verify was pushed to remote
REMOTE_HEAD="$(git -C "$CONTROLLED_REMOTE" rev-parse HEAD)"
LOCAL_HEAD="$(git -C "$CONTROLLED_REPO" rev-parse HEAD)"

if [[ "$REMOTE_HEAD" != "$LOCAL_HEAD" ]]; then
  echo "FAIL remote not updated"
  exit 1
fi

echo "PASS"
