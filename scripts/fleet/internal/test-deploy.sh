#!/usr/bin/env bash
# test-deploy.sh — reset test repo to a target SHA and build
# Usage: test-deploy.sh --sha <sha>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"
source "$SCRIPT_DIR/lock.sh"

TARGET_SHA=""
while (($#)); do
  case "$1" in
    --sha)
      TARGET_SHA="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --sha <sha>"
      exit 0
      ;;
    *)
      echo "❌ Unknown flag: $1" >&2
      echo "Usage: $0 --sha <sha>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_SHA" ]]; then
  echo "❌ Missing required --sha" >&2
  echo "Usage: $0 --sha <sha>" >&2
  exit 1
fi

export FLEET_AGENT="${FLEET_AGENT:-Kero}"
export FLEET_SESSION="${FLEET_SESSION:-unknown}"
export FLEET_PURPOSE="test-deploy"
export FLEET_TARGET_SHA="$TARGET_SHA"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"

lock_acquire "$TEST_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$TEST_LOCK_FILE"' EXIT

[[ -d "$TEST_REPO/.git" ]] || { echo "❌ Invalid test repo: $TEST_REPO" >&2; exit 1; }

cd "$TEST_REPO"
git fetch origin --tags --quiet 2>/dev/null || true

RESOLVE_REF="$TARGET_SHA"
if ! git rev-parse --verify --quiet "$RESOLVE_REF^{commit}" >/dev/null; then
  echo "📥 Target SHA not reachable locally; fetching from origin: $TARGET_SHA"
  git fetch origin "$TARGET_SHA" --quiet || true
fi

if ! git rev-parse --verify --quiet "$RESOLVE_REF^{commit}" >/dev/null; then
  echo "❌ Could not resolve target commit: $TARGET_SHA" >&2
  exit 1
fi

RESOLVED_SHA="$(git rev-parse "$RESOLVE_REF^{commit}")"
echo "📌 Test target SHA: $RESOLVED_SHA"

echo "🧹 Cleaning untracked files (keeping .test-instance/)"
git clean -fd --exclude='.test-instance/'

echo "🔀 Resetting test checkout"
git reset --hard "$RESOLVED_SHA"

echo "🔨 Installing dependencies"
pnpm install --frozen-lockfile

echo "🏗️  Building test checkout"
pnpm build

mkdir -p "$(dirname "$TEST_STATE_FILE")"
cat > "$TEST_STATE_FILE" <<EOF
TEST_REPO=$TEST_REPO
TEST_DEPLOYED_SHA=$RESOLVED_SHA
TEST_DEPLOYED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
TEST_DEPLOYED_BY=$OWNER_NAME
EOF

echo "TEST-DEPLOY-OK"
echo "test_sha=$RESOLVED_SHA"
