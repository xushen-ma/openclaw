#!/usr/bin/env bash
# rollback.sh — Revert production to a previous tag or commit
# Usage: rollback.sh <version-tag-or-sha>
# Example: rollback.sh v2026.3.7.1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"
source "$SCRIPT_DIR/lock.sh"

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: rollback.sh <version-tag-or-sha>"
  echo ""
  echo "Available tags:"
  cd "$DEV_REPO" && git tag --sort=-creatordate | grep "^v[0-9]" | grep "\." | head -10
  exit 1
fi

export FLEET_AGENT="${FLEET_AGENT:-Mini}"
export FLEET_SESSION="${FLEET_SESSION:-agent:main:discord:direct:965214128090255411}"
export FLEET_PURPOSE="rollback"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"
lock_acquire "$RELEASE_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$RELEASE_LOCK_FILE"' EXIT

echo "════════════════════════════════════"
echo "  🚨 ROLLBACK to $TARGET"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "════════════════════════════════════"
echo ""

cd "$DEV_REPO"
git fetch "$FORK_REMOTE" --tags --quiet 2>/dev/null || true

# Resolve SHA
TARGET_SHA=$(git rev-parse "$TARGET" 2>/dev/null || echo "")
if [[ -z "$TARGET_SHA" ]]; then
  echo "❌ Cannot resolve '$TARGET' to a commit"
  exit 1
fi

echo "📌 Rolling back to $TARGET ($TARGET_SHA)"

# Reset production pointer
git push "$FORK_REMOTE" "$TARGET_SHA:production" --force
echo "✅ Fork production reset to $TARGET"

# Pull release workspace
cd "$RELEASE_DIR"
git fetch origin --tags --quiet
git checkout production
git pull origin production
echo "✅ Release workspace at: $(git log --oneline -1)"

# Build
echo "🔨 Building..."
pnpm install --frozen-lockfile 2>&1 | tail -5
pnpm build 2>&1 | tail -5
echo "✅ Build complete"

# Deploy
echo "🚀 Restarting gateway..."
openclaw daemon restart --fast
sleep 8

STATUS=$(openclaw gateway status 2>&1 || echo "unknown")
echo "Gateway status: $STATUS"

echo ""
echo "════════════════════════════════════"
echo "  ✅ Rolled back to $TARGET"
echo "════════════════════════════════════"
