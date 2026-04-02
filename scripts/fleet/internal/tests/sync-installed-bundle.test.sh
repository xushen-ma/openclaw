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
cat > "$dir/internal/promote-production.sh" <<'EOF'
#!/usr/bin/env bash
echo "promote"
EOF
chmod +x "$dir/internal/deploy.sh" "$dir/internal/promote-production.sh"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

SOURCE_ROOT="$tmpdir/source"
mkdir -p "$SOURCE_ROOT"
create_source_bundle "$SOURCE_ROOT"
mkdir -p "$tmpdir/installed-bundle"

out="$(
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$SOURCE_ROOT" \
  RELEASECTL_INSTALL_ROOT="$tmpdir/installed-bundle" \
  RELEASECTL_CONTROLLED_REPO="$tmpdir/no-controlled-repo" \
  bash "$SYNC_SCRIPT" --sync
)"

[[ -f "$tmpdir/installed-bundle/internal/promote-production.sh" ]] || fail "expected promote-production.sh to be installed when missing"
[[ -x "$tmpdir/installed-bundle/internal/promote-production.sh" ]] || fail "expected promote-production.sh to be executable"
[[ "$out" == *"SYNCED   internal/promote-production.sh"* ]] || fail "expected sync output to include promote-production.sh"

pass "sync-installed-bundle installs missing internal commands (including promote-production.sh)"
