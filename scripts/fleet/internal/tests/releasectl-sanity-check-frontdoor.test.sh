#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASECTL="$(cd "$SCRIPT_DIR/../.." && pwd)/releasectl"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

internal_dir="$tmpdir/internal"
mkdir -p "$internal_dir"

cat > "$internal_dir/fleet.env" <<'EOF'
# test env
EOF
cat > "$internal_dir/permissions.sh" <<'EOF'
normalize_repo_permissions() { :; }
EOF
cat > "$internal_dir/sanity-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "SANITY_INTERNAL args:$*"
EOF
chmod +x "$internal_dir/sanity-check.sh"

out="$({
  RELEASECTL_SKIP_SUDO_HANDOFF=1 \
  RELEASECTL_INTERNAL_DIR="$internal_dir" \
  RELEASECTL_CONFIG=/dev/null \
  bash "$RELEASECTL" sanity-check --sha deadbeef --skip-smoke
} 2>&1)" || fail "front-door sanity-check should execute internal script"

[[ "$out" == *"SANITY_INTERNAL args:--sha deadbeef --skip-smoke"* ]] || fail "expected passthrough args"

pass "releasectl sanity-check is available on front door and passes args to internal script"
