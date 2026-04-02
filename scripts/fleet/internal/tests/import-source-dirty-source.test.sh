#!/usr/bin/env bash
# Test: import-source rejects dirty source working tree

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

echo "TEST import-source-dirty-source"

# Create mock source repo
SOURCE_REPO="$TEST_ROOT/source"
git init -q "$SOURCE_REPO"
mkdir -p "$SOURCE_REPO/scripts/fleet/internal"

cat > "$SOURCE_REPO/scripts/fleet/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "test"
EOF

git -C "$SOURCE_REPO" add .
git -C "$SOURCE_REPO" commit -qm "Initial"
SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse HEAD)"

# Modify without staging
echo "# modified" >> "$SOURCE_REPO/scripts/fleet/releasectl"

# Create mock controlled repo
CONTROLLED_REPO="$TEST_ROOT/controlled"
git init -q "$CONTROLLED_REPO"
echo "# Controlled" > "$CONTROLLED_REPO/README.md"
git -C "$CONTROLLED_REPO" add README.md
git -C "$CONTROLLED_REPO" commit -qm "Initial"

CONTROLLED_REMOTE="$TEST_ROOT/controlled-remote.git"
git init -q --bare "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" remote add origin "$CONTROLLED_REMOTE"
git -C "$CONTROLLED_REPO" push -q origin main

set +e
OUTPUT="$(
  RELEASECTL_SOURCE_REPO="$SOURCE_REPO" \
  RELEASECTL_CONTROLLED_REPO="$CONTROLLED_REPO" \
  RELEASECTL_CONTROLLED_REMOTE="origin" \
  RELEASECTL_CONTROLLED_BRANCH="main" \
  bash "$SCRIPT_DIR/import-source.sh" \
    "$SOURCE_SHA" \
  2>&1
)"
rc=$?
set -e

if [[ "$rc" -eq 0 ]]; then
  echo "FAIL import-source should have failed on dirty source"
  echo "$OUTPUT"
  exit 1
fi

if ! grep -q "uncommitted changes" <<< "$OUTPUT"; then
  echo "FAIL expected 'uncommitted changes' error"
  echo "$OUTPUT"
  exit 1
fi

echo "PASS"
