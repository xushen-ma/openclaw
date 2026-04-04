#!/usr/bin/env bash
# promote-production.sh — Merge a validated candidate onto production lineage
# Usage: promote-production.sh --sha <branch|sha|ref> [--allow-untagged]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"

usage() {
  cat <<'EOF'
Usage: promote-production.sh --sha <branch|sha|ref> [--allow-untagged]

Merges the validated candidate into origin/production with a non-fast-forward
merge commit, pushes origin/production, and prints the resulting commit SHA.

Flags:
  --sha <ref>       Candidate commit/ref to promote (required)
  --allow-untagged  Skip validated-tag presence check (not recommended)
EOF
}

TARGET_REF=""
ALLOW_UNTAGGED=0

while (($#)); do
  case "$1" in
    --sha)
      TARGET_REF="${2:-}"
      shift 2
      ;;
    --allow-untagged)
      ALLOW_UNTAGGED=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown flag: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$TARGET_REF" ]]; then
  echo "error: missing required flag --sha <branch|sha|ref>" >&2
  exit 2
fi

cd "$DEV_REPO"

git fetch "$FORK_REMOTE" --tags --quiet

MAIN_REF="refs/remotes/$FORK_REMOTE/$MAIN_BRANCH"
PROD_REF="refs/remotes/$FORK_REMOTE/$PROD_BRANCH"

git rev-parse --verify "$MAIN_REF" >/dev/null 2>&1 || {
  echo "❌ Missing main lineage ref: $MAIN_REF"
  exit 1
}

git rev-parse --verify "$PROD_REF" >/dev/null 2>&1 || {
  echo "❌ Missing production lineage ref: $PROD_REF"
  exit 1
}

git rev-parse --verify "$TARGET_REF^{commit}" >/dev/null 2>&1 || {
  echo "❌ Candidate ref not found: $TARGET_REF"
  exit 1
}

TARGET_SHA="$(git rev-parse "$TARGET_REF^{commit}")"
PROD_HEAD="$(git rev-parse "$PROD_REF")"

git merge-base --is-ancestor "$TARGET_SHA" "$MAIN_REF" >/dev/null 2>&1 || {
  echo "❌ Refusing promotion: candidate is not on main lineage"
  echo "   candidate: $TARGET_SHA"
  echo "   main ref:  $MAIN_REF"
  exit 1
}

VALIDATED_TAGS="$(git tag --points-at "$TARGET_SHA" | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+(-[0-9]+)?-x\.[0-9]+$' || true)"
if [[ "$ALLOW_UNTAGGED" -ne 1 && -z "$VALIDATED_TAGS" ]]; then
  echo "❌ Refusing promotion: candidate has no validated v*-x.* tag at this commit"
  echo "   candidate: $TARGET_SHA"
  echo "   hint: pass --allow-untagged only for exceptional/manual recoveries"
  exit 1
fi

if git merge-base --is-ancestor "$TARGET_SHA" "$PROD_HEAD" >/dev/null 2>&1; then
  echo "✅ Candidate is already on production lineage"
  echo "result_sha=$PROD_HEAD"
  echo "next: releasectl deploy --sha $PROD_HEAD"
  exit 0
fi

SHORT_SHA="$(git rev-parse --short "$TARGET_SHA")"
PROMOTE_BRANCH="releasectl/promote-production/$SHORT_SHA"
WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/releasectl-promote.XXXXXX")"
cleanup() {
  git -C "$DEV_REPO" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add --detach "$WORKTREE_DIR" "$PROD_REF" >/dev/null

cd "$WORKTREE_DIR"
git checkout -B "$PROMOTE_BRANCH" "$PROD_REF" >/dev/null

MERGE_MSG="Merge ${TARGET_SHA} into production for governed release promotion"

git merge --no-ff --no-edit -m "$MERGE_MSG" "$TARGET_SHA"
RESULT_SHA="$(git rev-parse HEAD)"

git push "$FORK_REMOTE" "HEAD:$PROD_BRANCH"

echo "✅ Promoted candidate onto production lineage"
echo "candidate_sha=$TARGET_SHA"
if [[ -n "$VALIDATED_TAGS" ]]; then
  echo "validated_tag=$(printf '%s' "$VALIDATED_TAGS" | head -n1)"
fi
echo "result_sha=$RESULT_SHA"
echo "next: releasectl deploy --sha $RESULT_SHA"
