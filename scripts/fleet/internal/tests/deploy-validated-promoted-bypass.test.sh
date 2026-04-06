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

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

remote="$tmpdir/remote.git"
dev_repo="$tmpdir/dev"
release_repo="$tmpdir/release"
fake_bin="$tmpdir/bin"
pnpm_home="$tmpdir/pnpm-home"
mkdir -p "$fake_bin" "$pnpm_home"

git init --bare -q "$remote"
git init -q "$dev_repo"
git -C "$dev_repo" config user.name "Test User"
git -C "$dev_repo" config user.email "test@example.com"

echo '#!/usr/bin/env bash' > "$pnpm_home/pnpm"
echo 'if [[ "$1" == "install" ]]; then exit 0; fi' >> "$pnpm_home/pnpm"
echo 'if [[ "$1" == "build" ]]; then mkdir -p "$PWD/dist"; printf "dist" > "$PWD/dist/entry.js"; exit 0; fi' >> "$pnpm_home/pnpm"
echo 'if [[ "$1" == "ui:build" ]]; then mkdir -p "$PWD/dist/control-ui"; printf "<html/>" > "$PWD/dist/control-ui/index.html"; exit 0; fi' >> "$pnpm_home/pnpm"
echo 'exit 0' >> "$pnpm_home/pnpm"
chmod +x "$pnpm_home/pnpm"

echo '#!/usr/bin/env bash' > "$fake_bin/openclaw"
echo 'if [[ "$1" == "gateway" && "$2" == "status" ]]; then echo "running"; exit 0; fi' >> "$fake_bin/openclaw"
echo 'if [[ "$1" == "gateway" && "$2" == "restart" ]]; then echo "restarted"; exit 0; fi' >> "$fake_bin/openclaw"
echo 'exit 0' >> "$fake_bin/openclaw"
chmod +x "$fake_bin/openclaw"

cat > "$fake_bin/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "install" ]]; then
  exit 0
fi

if [[ "$1" == "build" ]]; then
  mkdir -p "$PWD/dist"
  printf 'dist' > "$PWD/dist/entry.js"
  exit 0
fi

if [[ "$1" == "ui:build" ]]; then
  mkdir -p "$PWD/dist/control-ui"
  printf '<html/>' > "$PWD/dist/control-ui/index.html"
  exit 0
fi

exit 0
EOF
chmod +x "$fake_bin/pnpm"

commit() {
  local msg="$1"
  echo "$msg" >> "$dev_repo/history.txt"
  git -C "$dev_repo" add history.txt
  git -C "$dev_repo" commit -q -m "$msg"
}

commit "a1"
A_SHA="$(git -C "$dev_repo" rev-parse HEAD)"
git -C "$dev_repo" tag v2026.3.13

commit "validated"
B_SHA="$(git -C "$dev_repo" rev-parse HEAD)"
git -C "$dev_repo" tag v2026.3.13-1-x.30

commit "post-promote-lineage-head"
C_SHA="$(git -C "$dev_repo" rev-parse HEAD)"

# Create an existing higher tag outside current lineage to reproduce allocator collision.
git -C "$dev_repo" checkout -q --detach "$A_SHA"
commit "divergent-tagged-commit"
D_SHA="$(git -C "$dev_repo" rev-parse HEAD)"
git -C "$dev_repo" tag v2026.3.13-1-x.31 "$D_SHA"
git -C "$dev_repo" checkout -q --detach "$C_SHA"

git -C "$dev_repo" remote add origin "$remote"
git -C "$dev_repo" branch -f main "$C_SHA"
git -C "$dev_repo" checkout -q main
git -C "$dev_repo" push -q origin main
git -C "$dev_repo" push -q origin "$C_SHA":refs/heads/production
git -C "$dev_repo" push -q origin v2026.3.13-1-x.31

git clone -q "$remote" "$release_repo"
git -C "$release_repo" checkout -q production
mkdir -p "$release_repo/dist/control-ui"
: > "$release_repo/dist/control-ui/index.html"

tmp_home="$tmpdir/home"
tmp_tmpdir="$tmpdir/tmp"
mkdir -p "$tmp_home" "$tmp_tmpdir/openclaw-fleet-locks"

sanity_state="$tmp_tmpdir/openclaw-fleet-locks/last-sanity.env"
cat > "$sanity_state" <<EOF
SANITY_SHA="$A_SHA"
SANITY_AT="old"
SANITY_BY="test"
SKIP_SMOKE="false"
EOF

out="$({
  export PATH="$fake_bin:$PATH"
  export HOME="$tmp_home"
  export TMPDIR="$tmp_tmpdir"
  export PNPM_HOME="$pnpm_home"
  export OPENCLAW_BIN="$fake_bin/openclaw"
  export DEV_REPO="$dev_repo"
  export STAGING_DIR="$dev_repo"
  export RELEASE_DIR="$release_repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  export FLEET_TARGET_SHA="$B_SHA"
  export FLEET_LINEAGE_REF="refs/remotes/origin/production"
  bash "$DEPLOY_SCRIPT"
} 2>&1)" || {
  echo "$out"
  fail "deploy should allow stale sanity for already validated/promoted candidate"
}

[[ "$out" == *"Candidate already validated/promoted"* ]] || fail "expected validated/promoted bypass message"
[[ "$out" == *"Skipping stale local sanity guard"* ]] || fail "expected stale-sanity bypass log"
[[ "$out" == *"Deployed"* ]] || fail "expected deploy success output"

git -C "$dev_repo" fetch -q origin --tags
new_tag="$(git -C "$dev_repo" tag --points-at "$B_SHA" | grep -E '^v2026\.3\.13-1-x\.32$' || true)"
[[ -n "$new_tag" ]] || fail "expected allocator to skip existing divergent tag and create next increment"

pass "deploy accepts stale sanity when candidate is validated and already on production lineage"
