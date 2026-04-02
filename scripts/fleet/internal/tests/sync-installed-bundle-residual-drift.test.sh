#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/sync-installed-bundle.sh"

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

SOURCE_ROOT="$tmpdir/source"
mutated_source="$tmpdir/mutated-source"
mkdir -p "$SOURCE_ROOT"
create_source_bundle "$SOURCE_ROOT"

cp -R "$SOURCE_ROOT/." "$mutated_source/"
rm -f "$mutated_source/internal/fleet.env"

set +e
out="$(
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$mutated_source" \
  RELEASECTL_INSTALL_ROOT="$tmpdir/installed-bundle" \
  RELEASECTL_CONTROLLED_REPO="$tmpdir/no-controlled-repo" \
  bash "$SYNC_SCRIPT" --sync
)"
rc=$?
set -e
if [[ "$rc" -eq 0 ]]; then
  fail "expected bundle sync to fail when source manifest is incomplete"
fi

[[ "$out" == *"SOURCE-MISSING internal/fleet.env"* ]] || fail "expected source-missing report for removed file"
[[ "$out" == *"Residual drift remains after sync"* ]] || fail "expected explicit residual-drift failure message"

pass "bundle-sync --sync fails closed when residual drift remains"
