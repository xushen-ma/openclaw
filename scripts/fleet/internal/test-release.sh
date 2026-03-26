#!/usr/bin/env bash
# test-release.sh — mark current test checkout as released/ready

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"
source "$SCRIPT_DIR/lock.sh"

export FLEET_AGENT="${FLEET_AGENT:-Kero}"
export FLEET_SESSION="${FLEET_SESSION:-unknown}"
export FLEET_PURPOSE="test-release"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"

lock_acquire "$TEST_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$TEST_LOCK_FILE"' EXIT

[[ -d "$TEST_REPO/.git" ]] || { echo "❌ Invalid test repo: $TEST_REPO" >&2; exit 1; }

CURRENT_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
export FLEET_TARGET_SHA="$CURRENT_SHA"

mkdir -p "$(dirname "$TEST_STATE_FILE")"

existing_deployed_sha="$(grep '^TEST_DEPLOYED_SHA=' "$TEST_STATE_FILE" 2>/dev/null | cut -d= -f2- || true)"
existing_deployed_at="$(grep '^TEST_DEPLOYED_AT=' "$TEST_STATE_FILE" 2>/dev/null | cut -d= -f2- || true)"
existing_deployed_by="$(grep '^TEST_DEPLOYED_BY=' "$TEST_STATE_FILE" 2>/dev/null | cut -d= -f2- || true)"

cat > "$TEST_STATE_FILE" <<EOF
TEST_REPO=$TEST_REPO
TEST_DEPLOYED_SHA=${existing_deployed_sha:-$CURRENT_SHA}
TEST_DEPLOYED_AT=${existing_deployed_at:-unknown}
TEST_DEPLOYED_BY=${existing_deployed_by:-unknown}
TEST_RELEASED_SHA=$CURRENT_SHA
TEST_RELEASED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
TEST_RELEASED_BY=$OWNER_NAME
EOF

echo "TEST-RELEASE-OK"
echo "test_released_sha=$CURRENT_SHA"
