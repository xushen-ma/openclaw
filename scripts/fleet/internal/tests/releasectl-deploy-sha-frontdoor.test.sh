#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASECTL="$FLEET_DIR/releasectl"
INTERNAL_DIR="$SCRIPT_DIR/tmp/releasectl-deploy-frontdoor/internal"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

mkdir -p "$INTERNAL_DIR"

cat >"$INTERNAL_DIR/permissions.sh" <<'EOS'
#!/usr/bin/env bash
normalize_repo_permissions() { :; }
EOS

cat >"$INTERNAL_DIR/fleet.env" <<'EOS'
#!/usr/bin/env bash
: "${RELEASECTL_EXEC_PATH:=/tmp/nonexistent}"
EOS

cat >"$INTERNAL_DIR/deploy.sh" <<'EOS'
#!/usr/bin/env bash
echo "DEPLOY_SHA:${FLEET_TARGET_SHA:-unset}"
echo "DEPLOY_ARGS:$*"
EOS

chmod +x "$INTERNAL_DIR/deploy.sh"

out_sha="$({
  RELEASECTL_SKIP_SUDO_HANDOFF=1 \
  RELEASECTL_INTERNAL_DIR="$INTERNAL_DIR" \
  RELEASECTL_ALLOW_SUDO=0 \
  bash "$RELEASECTL" deploy --sha abc123 --dry-run
} 2>&1)" || fail "deploy with --sha should succeed"

[[ "$out_sha" == *"DEPLOY_SHA:abc123"* ]] || fail "expected --sha to map to FLEET_TARGET_SHA"
[[ "$out_sha" == *"DEPLOY_ARGS:--dry-run"* ]] || fail "expected non-sha args passed through"

out_no_sha="$({
  RELEASECTL_SKIP_SUDO_HANDOFF=1 \
  RELEASECTL_INTERNAL_DIR="$INTERNAL_DIR" \
  RELEASECTL_ALLOW_SUDO=0 \
  bash "$RELEASECTL" deploy --dry-run
} 2>&1)" || fail "deploy without --sha should succeed"

[[ "$out_no_sha" == *"DEPLOY_SHA:unset"* ]] || fail "expected no FLEET_TARGET_SHA when --sha omitted"
[[ "$out_no_sha" == *"DEPLOY_ARGS:--dry-run"* ]] || fail "expected args passthrough without --sha"

pass "releasectl deploy front door maps --sha to FLEET_TARGET_SHA"
