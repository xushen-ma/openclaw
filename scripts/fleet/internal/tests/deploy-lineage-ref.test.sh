#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/deploy.sh"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT

git -C "$repo" init -q
git -C "$repo" config user.name "Test User"
git -C "$repo" config user.email "test@example.com"

commit() {
  local msg="$1"
  echo "$msg" >> "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "$msg"
}

commit "a1"
A_SHA="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" tag v2026.3.11

commit "b1"
B_SHA="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" tag v2026.3.11-x.1

commit "c1"
C_SHA="$(git -C "$repo" rev-parse HEAD)"

# Remote-tracking refs to emulate governed checkout layout.
# Keep legacy origin/xushen/production pointing at an older commit to assert
# deploy.sh no longer prefers it when resolving the default production lineage.
git -C "$repo" update-ref refs/remotes/origin/main "$C_SHA"
git -C "$repo" update-ref refs/remotes/origin/production "$B_SHA"
git -C "$repo" update-ref refs/remotes/origin/xushen/production "$A_SHA"

out="$({
  export DEV_REPO="$repo"
  export STAGING_DIR="$repo"
  export RELEASE_DIR="$repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  export FLEET_TARGET_SHA="$B_SHA"
  bash "$DEPLOY_SCRIPT" --dry-run
} 2>&1)" || fail "deploy dry-run should accept candidate on origin/production lineage"

[[ "$out" == *"Using pinned candidate SHA"* ]] || fail "expected pinned candidate output"
[[ "$out" == *"Next version: v2026.3.11-x.2"* ]] || fail "expected normal version resolution on accepted lineage"

git -C "$repo" checkout -q "$B_SHA"
commit "d1"
OFF_LINEAGE_SHA="$(git -C "$repo" rev-parse HEAD)"

if ! offline_out="$( {
  export DEV_REPO="$repo"
  export STAGING_DIR="$repo"
  export RELEASE_DIR="$repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  export FLEET_TARGET_SHA="$OFF_LINEAGE_SHA"
  bash "$DEPLOY_SCRIPT" --dry-run
} 2>&1)"; then
  : # expected failure
else
  fail "deploy dry-run should fail for candidate not on lineage"
fi
[[ "$offline_out" == *"candidate is not an ancestor of production lineage"* ]] || \
  [[ "$offline_out" == *"Refusing deploy: candidate is not on the resolved lineage"* ]] || \
  fail "expected lineage rejection message"

pass "pinned candidate ancestry defaults to refs/remotes/origin/production (legacy xushen path ignored)"
