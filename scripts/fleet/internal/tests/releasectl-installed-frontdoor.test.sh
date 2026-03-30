#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_FLEET_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

install_root="$tmpdir/openclaw-fleet"
mkdir -p "$install_root/internal"
install -m 0755 "$SOURCE_FLEET_DIR/releasectl" "$install_root/releasectl"
install -m 0644 "$SOURCE_FLEET_DIR/internal/fleet.env" "$install_root/internal/fleet.env"
install -m 0755 "$SOURCE_FLEET_DIR/internal/permissions.sh" "$install_root/internal/permissions.sh"

run_handoff() {
  local action="$1"
  shift || true
  RELEASECTL_CAPTURE_HANDOFF=1 \
  RELEASECTL_ALLOW_SUDO=1 \
  RELEASECTL_EXEC_PATH="$install_root/releasectl" \
  RELEASECTL_CONFIG=/dev/null \
  bash "$install_root/releasectl" "$action" "$@" 2>&1
}

bundle_out="$(run_handoff bundle-sync --check)" || fail "installed bundle-sync should reach governed handoff"
[[ "$bundle_out" == *"HANDOFF action=bundle-sync"* ]] || fail "expected bundle-sync handoff output from installed front door"

promote_out="$(run_handoff promote-production --sha demo-branch)" || fail "installed promote-production should reach governed handoff"
[[ "$promote_out" == *"HANDOFF action=promote-production"* ]] || fail "expected promote-production handoff output from installed front door"

sanity_out="$(run_handoff sanity-check --sha demo-branch --skip-smoke)" || fail "installed sanity-check should reach governed handoff"
[[ "$sanity_out" == *"HANDOFF action=sanity-check"* ]] || fail "expected sanity-check handoff output from installed front door"

deploy_out="$(run_handoff deploy --sha demo-branch)" || fail "installed deploy should reach governed handoff"
[[ "$deploy_out" == *"HANDOFF action=deploy"* ]] || fail "expected deploy handoff output from installed front door"

pass "installed releasectl resolves internal path without RELEASECTL_INTERNAL_DIR and supports bundle-sync/promote-production/sanity-check/deploy"
