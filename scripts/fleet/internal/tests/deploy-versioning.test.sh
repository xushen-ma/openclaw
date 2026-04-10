#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/deploy.sh"

pass_count=0

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
  pass_count=$((pass_count + 1))
}

create_repo() {
  local repo
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  git -C "$repo" config user.name "Test User"
  git -C "$repo" config user.email "test@example.com"
  echo "$repo"
}

make_commit() {
  local repo="$1"
  local msg="$2"
  echo "$msg" >> "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "$msg"
}

run_dry_run() {
  local repo="$1"
  (
    export DEV_REPO="$repo"
    export STAGING_DIR="$repo"
    export RELEASE_DIR="$repo"
    export FORK_REMOTE="origin"
    export MAIN_BRANCH="main"
    bash "$DEPLOY_SCRIPT" --dry-run
  )
}

# Test 1: continue fork release line when merged candidate already has x-tags.
repo1="$(create_repo)"
make_commit "$repo1" "c1"
git -C "$repo1" tag v2026.3.10
make_commit "$repo1" "c2"
git -C "$repo1" tag v2026.3.11
make_commit "$repo1" "c3"
git -C "$repo1" tag v2026.3.11-x.1
make_commit "$repo1" "c4"
git -C "$repo1" tag v2026.3.11-x.2
make_commit "$repo1" "c5"
git -C "$repo1" update-ref refs/remotes/origin/main "$(git -C "$repo1" rev-parse HEAD)"
out1="$(run_dry_run "$repo1")"

[[ "$out1" == *"Continuing fork release line from: v2026.3.11-x.2"* ]] \
  || fail "expected fork-line continuation marker in output"
[[ "$out1" == *"Next version: v2026.3.11-x.3"* ]] \
  || fail "expected next version v2026.3.11-x.3 when x.1/x.2 already merged"
pass "continues existing fork tag line (v2026.3.11-x.2 -> v2026.3.11-x.3)"

# Test 2 (regression): avoid legacy fallback to older plain-tag lineage.
repo2="$(create_repo)"
make_commit "$repo2" "d1"
git -C "$repo2" tag v2026.3.10
make_commit "$repo2" "d2"
git -C "$repo2" tag v2026.3.10-x.9
make_commit "$repo2" "d3"
git -C "$repo2" tag v2026.3.11
make_commit "$repo2" "d4"
git -C "$repo2" tag v2026.3.11-x.1
make_commit "$repo2" "d5"
git -C "$repo2" tag v2026.3.11-x.2
make_commit "$repo2" "d6"
git -C "$repo2" update-ref refs/remotes/origin/main "$(git -C "$repo2" rev-parse HEAD)"
out2="$(run_dry_run "$repo2")"

[[ "$out2" == *"Next version: v2026.3.11-x.3"* ]] \
  || fail "expected newest fork line to win over older plain lineage"
[[ "$out2" != *"Next version: v2026.3.10"* ]] \
  || fail "regression: should not fall back to older v2026.3.10 lineage"
pass "does not regress to older plain-tag lineage when newer fork line exists"

echo "\nAll deploy versioning tests passed ($pass_count)."