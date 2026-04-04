#!/usr/bin/env bash
# rebase-upstream.sh — Rebase xushen/main onto a new upstream release tag
# Usage: rebase-upstream.sh <upstream-tag>
# Example: rebase-upstream.sh v2026.3.12
#
# This script:
#   1. Fetches the upstream tag
#   2. Creates a rebuild branch from it
#   3. Cherry-picks our 3 squashed patches
#   4. Runs pnpm check + build
#   5. Pushes xushen/main if all passes
#   6. Reports any conflicts for Mini/Xushen to resolve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/internal/fleet.env"
source "$SCRIPT_DIR/internal/lock.sh"

UPSTREAM_TAG="${1:-}"

if [[ -z "$UPSTREAM_TAG" ]]; then
  echo "Usage: rebase-upstream.sh <upstream-tag>"
  echo ""
  echo "Recent upstream tags:"
  cd "$DEV_REPO" && git tag --sort=-creatordate | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+$' | head -8
  exit 1
fi

if [[ ! "$UPSTREAM_TAG" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Upstream tag must be plain vYYYY.M.D (got: $UPSTREAM_TAG)"
  echo "   Fork tags use -x.N and are created automatically by this script."
  exit 1
fi

export FLEET_AGENT="${FLEET_AGENT:-Mini}"
export FLEET_SESSION="${FLEET_SESSION:-agent:main:discord:direct:965214128090255411}"
export FLEET_PURPOSE="rebase-upstream"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"
lock_acquire "$RELEASE_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$RELEASE_LOCK_FILE"' EXIT

echo "════════════════════════════════════"
echo "  Rebase xushen/main → $UPSTREAM_TAG"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "════════════════════════════════════"
echo ""

cd "$DEV_REPO"
git fetch origin --tags --quiet
git fetch "$FORK_REMOTE" --quiet 2>/dev/null || true

# Verify tag exists
if ! git rev-parse "$UPSTREAM_TAG" &>/dev/null; then
  echo "❌ Tag '$UPSTREAM_TAG' not found in upstream"
  echo "Available tags: $(git tag --sort=-creatordate | grep -v beta | head -5 | tr '\n' ' ')"
  exit 1
fi

# Find our 3 patch commits on current main (by subject match)
echo "🔍 Finding our patch commits on current xushen/main..."

SMART_RESET_SHA=$(git log --oneline "$FORK_REMOTE/main" | grep -i "smart.reset\|smart reset" | head -1 | awk '{print $1}')
FAST_RESTART_SHA=$(git log --oneline "$FORK_REMOTE/main" | grep -i "fast.*launchd\|--fast.*restart\|launchd.*fast\|daemon.*fast" | head -1 | awk '{print $1}')
MATRIX_HEAL_SHA=$(git log --oneline "$FORK_REMOTE/main" | grep -i "self.heal\|matrix.*sdk\|sdk.*self" | head -1 | awk '{print $1}')

echo "  Smart reset:   ${SMART_RESET_SHA:-NOT FOUND}"
echo "  Fast restart:  ${FAST_RESTART_SHA:-NOT FOUND}"
echo "  Matrix heal:   ${MATRIX_HEAL_SHA:-NOT FOUND}"
echo ""

MISSING=false
[[ -z "$SMART_RESET_SHA" ]] && echo "❌ Cannot find smart-reset commit" && MISSING=true
[[ -z "$FAST_RESTART_SHA" ]] && echo "❌ Cannot find --fast restart commit" && MISSING=true
[[ -z "$MATRIX_HEAL_SHA" ]] && echo "❌ Cannot find matrix self-heal commit" && MISSING=true
[[ "$MISSING" == true ]] && exit 1

# Create rebuild branch
REBUILD_BRANCH="xushen/main-rebase-$(date +%Y%m%d)"
echo "🌿 Creating rebuild branch: $REBUILD_BRANCH"
git checkout -b "$REBUILD_BRANCH" "$UPSTREAM_TAG"

# Cherry-pick our patches
CONFLICT=false

echo "🍒 Cherry-picking smart-reset..."
if ! git cherry-pick "$SMART_RESET_SHA"; then
  echo "⚠️  Conflict in smart-reset patch. Stopping."
  echo "   Resolve manually, then run: git cherry-pick --continue"
  echo "   Then cherry-pick remaining: $FAST_RESTART_SHA $MATRIX_HEAL_SHA"
  CONFLICT=true
fi

if [[ "$CONFLICT" == false ]]; then
  echo "🍒 Cherry-picking --fast restart..."
  if ! git cherry-pick "$FAST_RESTART_SHA"; then
    echo "⚠️  Conflict in --fast restart patch. Stopping."
    CONFLICT=true
  fi
fi

if [[ "$CONFLICT" == false ]]; then
  echo "🍒 Cherry-picking matrix self-heal..."
  if ! git cherry-pick "$MATRIX_HEAL_SHA"; then
    echo "⚠️  Conflict in matrix self-heal patch. Stopping."
    CONFLICT=true
  fi
fi

if [[ "$CONFLICT" == true ]]; then
  echo ""
  echo "🚫 Rebase halted due to conflicts."
  echo "   Branch $REBUILD_BRANCH left in place for manual resolution."
  echo "   Report to Mini with conflict details."
  exit 1
fi

echo ""
echo "🔨 Running checks..."
pnpm install --frozen-lockfile 2>&1 | tail -5
if ! pnpm check 2>&1 | tail -10; then
  echo "❌ pnpm check failed — do not push"
  exit 1
fi
if ! pnpm build 2>&1 | tail -10; then
  echo "❌ pnpm build failed — do not push"
  exit 1
fi
echo "✅ Build clean"

# Push to fork
echo "📤 Pushing xushen/main to fork..."
git push "$FORK_REMOTE" "$REBUILD_BRANCH:main" --force-with-lease
echo "✅ Fork main updated"

# Tag first fork release on top of the new upstream base.
# Scheme: v<upstream-base>-x.1
REBASED_SHA=$(git rev-parse "$REBUILD_BRANCH")
NEW_FORK_TAG="${UPSTREAM_TAG}-x.1"
if git rev-parse "$NEW_FORK_TAG" >/dev/null 2>&1; then
  echo "⚠️  Tag $NEW_FORK_TAG already exists; leaving existing tag unchanged"
else
  echo "🏷️  Tagging rebased main: $NEW_FORK_TAG"
  git tag "$NEW_FORK_TAG" "$REBASED_SHA"
  git push "$FORK_REMOTE" "$NEW_FORK_TAG"
  echo "✅ Pushed tag $NEW_FORK_TAG"
fi

# Update local xushen/main
git branch -f xushen/main "$REBUILD_BRANCH"
git checkout xushen/main
git branch -D "$REBUILD_BRANCH"

echo ""
echo "════════════════════════════════════"
echo "  ✅ xushen/main rebased onto $UPSTREAM_TAG"
echo "  ✅ Initial fork tag: ${UPSTREAM_TAG}-x.1"
echo "  Next: run sanity-check.sh, then deploy.sh"
echo "════════════════════════════════════"
echo ""
echo "── Version preview:"
bash "$SCRIPT_DIR/internal/deploy.sh" --dry-run 2>&1 | grep -E "Upstream base|Next version|would deploy" | sed 's/^/  /'
echo ""
echo "  (Version is auto-generated — do not pass it manually)"
