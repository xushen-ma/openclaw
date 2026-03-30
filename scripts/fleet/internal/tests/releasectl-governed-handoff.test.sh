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

out="$({
  RELEASECTL_CAPTURE_HANDOFF=1 \
  RELEASECTL_ALLOW_SUDO=1 \
  RELEASECTL_EXEC_PATH=/usr/local/lib/openclaw-fleet/releasectl \
  bash "$RELEASECTL" test-deploy --sha demo-branch
} 2>&1)" || fail "expected handoff capture to exit successfully"

[[ "$out" == *"HANDOFF action=test-deploy"* ]] || fail "expected test-deploy handoff capture output"
[[ "$out" == *"release_user=oc-release"* ]] || fail "expected governed handoff to oc-release"
[[ "$out" == *"exec=/usr/local/lib/openclaw-fleet/releasectl"* ]] || fail "expected governed handoff to installed releasectl"

pass "test-deploy triggers governed handoff to installed releasectl"

bundle_out="$({
  RELEASECTL_CAPTURE_HANDOFF=1 \
  RELEASECTL_ALLOW_SUDO=1 \
  RELEASECTL_EXEC_PATH=/usr/local/lib/openclaw-fleet/releasectl \
  bash "$RELEASECTL" bundle-sync --check
} 2>&1)" || fail "expected bundle-sync handoff capture to exit successfully"

[[ "$bundle_out" == *"HANDOFF action=bundle-sync"* ]] || fail "expected bundle-sync handoff capture output"
pass "bundle-sync triggers governed handoff to installed releasectl"

if RELEASECTL_ALLOW_SUDO=0 bash "$RELEASECTL" test-deploy --sha demo-branch >/tmp/releasectl-no-sudo.out 2>&1; then
  fail "expected test-deploy to fail when sudo handoff is disabled"
fi

grep -q "requires oc-release (sudo handoff disabled)" /tmp/releasectl-no-sudo.out \
  || fail "expected explicit error when governed handoff is disabled"

pass "governed write actions fail fast when sudo handoff is disabled"
