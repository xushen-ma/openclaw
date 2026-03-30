#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMOTE_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/promote-production.sh"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

remote="$tmpdir/remote.git"
repo="$tmpdir/repo"

git init --bare -q "$remote"
git clone -q "$remote" "$repo"

git -C "$repo" config user.name "Test User"
git -C "$repo" config user.email "test@example.com"

commit() {
  local msg="$1"
  echo "$msg" >> "$repo/history.txt"
  git -C "$repo" add history.txt
  git -C "$repo" commit -q -m "$msg"
}

commit "base"
BASE_SHA="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" branch -M main
git -C "$repo" checkout -q -b production

git -C "$repo" push -q origin main production --tags

git -C "$repo" checkout -q main
commit "validated"
CANDIDATE_SHA="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" tag v2026.3.13-1-x.30 "$CANDIDATE_SHA"

git -C "$repo" push -q origin main --tags

out="$({
  export DEV_REPO="$repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  bash "$PROMOTE_SCRIPT" --sha "$CANDIDATE_SHA"
} 2>&1)" || fail "expected promote-production to succeed for validated candidate"

[[ "$out" == *"Promoted candidate onto production lineage"* ]] || fail "missing promotion success text"
[[ "$out" == *"result_sha="* ]] || fail "missing resulting SHA output"
[[ "$out" == *"next: releasectl deploy --sha "* ]] || fail "missing deploy next-step output"

REMOTE_PROD_SHA="$(git -C "$repo" rev-parse refs/remotes/origin/production)"
PARENT_COUNT="$(git -C "$repo" cat-file -p "$REMOTE_PROD_SHA" | grep -c '^parent ')"
[[ "$PARENT_COUNT" -eq 2 ]] || fail "expected production head to be a merge commit"

git -C "$repo" merge-base --is-ancestor "$CANDIDATE_SHA" "$REMOTE_PROD_SHA" || fail "candidate should be ancestor of production head"

git -C "$repo" merge-base --is-ancestor "$BASE_SHA" "$REMOTE_PROD_SHA" || fail "previous production head should remain ancestor"

pass "promote-production creates and pushes production-lineage merge commit"

commit "untagged"
UNTAGGED_SHA="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" push -q origin main

if ({
  export DEV_REPO="$repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  bash "$PROMOTE_SCRIPT" --sha "$UNTAGGED_SHA"
} >/tmp/promote-production-untagged.out 2>&1); then
  fail "expected untagged candidate promotion to fail"
fi

grep -q "candidate has no validated v\*-x\.\* tag" /tmp/promote-production-untagged.out || fail "expected explicit untagged rejection"

pass "promote-production rejects untagged candidates by default"
