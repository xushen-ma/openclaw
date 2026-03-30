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
echo "SANITY_SHA:${FLEET_TARGET_SHA:-unset}"
echo "SANITY_ARGS:$*"
EOF
chmod +x "$internal_dir/sanity-check.sh"

out="$({
  RELEASECTL_SKIP_SUDO_HANDOFF=1 \
  RELEASECTL_INTERNAL_DIR="$internal_dir" \
  RELEASECTL_CONFIG=/dev/null \
  bash "$RELEASECTL" sanity-check --sha deadbeef --skip-smoke
} 2>&1)" || fail "front-door sanity-check should execute internal script"

[[ "$out" == *"SANITY_SHA:deadbeef"* ]] || fail "expected --sha to map to FLEET_TARGET_SHA"
[[ "$out" == *"SANITY_ARGS:--skip-smoke"* ]] || fail "expected non-sha args passthrough"

out_no_sha="$({
  RELEASECTL_SKIP_SUDO_HANDOFF=1 \
  RELEASECTL_INTERNAL_DIR="$internal_dir" \
  RELEASECTL_CONFIG=/dev/null \
  bash "$RELEASECTL" sanity-check --skip-smoke
} 2>&1)" || fail "front-door sanity-check without --sha should execute internal script"

[[ "$out_no_sha" == *"SANITY_SHA:unset"* ]] || fail "expected no FLEET_TARGET_SHA when --sha omitted"
[[ "$out_no_sha" == *"SANITY_ARGS:--skip-smoke"* ]] || fail "expected args passthrough without --sha"

pass "releasectl sanity-check front door maps --sha to FLEET_TARGET_SHA"
