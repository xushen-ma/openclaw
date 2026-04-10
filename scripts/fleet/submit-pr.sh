#!/usr/bin/env bash
# submit-pr.sh — Push a feature branch and open a PR against main
# Usage: submit-pr.sh <local-branch> <pr-title> [body-file]
# Any fleet agent can call this to submit their feature for review.
#
# Prerequisites:
#   - gh CLI authenticated as xushen-ma
#   - Branch exists locally in the openclaw dev repo
#   - DEV_REPO env var set, or defaults to ~/.openclaw/workspace-ben/repos/openclaw

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../internal/fleet.env"

BRANCH="${1:-}"
TITLE="${2:-}"
BODY_FILE="${3:-}"

# ── Validate ────────────────────────────────────────────────────────────────
if [[ -z "$BRANCH" || -z "$TITLE" ]]; then
  echo "Usage: submit-pr.sh <branch> <title> [body-file]"
  echo "  branch:    local branch name (e.g. feat/kiki-calendar-sync)"
  echo "  title:     PR title (e.g. 'feat(calendar): add sync feature')"
  echo "  body-file: optional path to markdown file for PR body"
  exit 1
fi

cd "$DEV_REPO"

if ! git rev-parse --verify "$BRANCH" &>/dev/null; then
  echo "❌ Branch '$BRANCH' not found in $DEV_REPO"
  exit 1
fi

# ── Push branch to fork ──────────────────────────────────────────────────────
echo "📤 Pushing $BRANCH to fork..."
git push xushen "$BRANCH:$BRANCH" --force-with-lease

# ── Open PR ──────────────────────────────────────────────────────────────────
echo "🔀 Opening PR against $MAIN_BRANCH..."
PR_ARGS=(
  --repo "$FORK"
  --base "$MAIN_BRANCH"
  --head "$BRANCH"
  --title "$TITLE"
  --draft
)

if [[ -n "$BODY_FILE" && -f "$BODY_FILE" ]]; then
  PR_ARGS+=(--body-file "$BODY_FILE")
else
  PR_ARGS+=(--body "$(cat <<EOF
## Summary
_Submitted via fleet submit-pr script._

## What it does
<!-- Fill in -->

## Config changes
<!-- Any new openclaw.json keys? -->

## Test results
<!-- pnpm check/build/test output -->

## Risk / backward compat
<!-- Does it change default behavior? -->
EOF
  )")
fi

PR_URL=$(gh pr create "${PR_ARGS[@]}")

echo ""
echo "✅ PR created (draft): $PR_URL"
echo "   Branch: $BRANCH → $MAIN_BRANCH"
echo "   Next: ping Mini for review"
