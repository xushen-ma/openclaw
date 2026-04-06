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

make_fake_bin_dir() {
  local bin_dir="$1"
  local log_file="$2"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/pnpm" <<EOF
#!/usr/bin/env bash
set -euo pipefail

echo "\$1:\$PWD" >> "$log_file"

if [[ "\$1" == "install" ]]; then
  exit 0
fi

if [[ "\$1" == "build" ]]; then
  mkdir -p "\$PWD/dist"
  printf 'entry' > "\$PWD/dist/entry.js"
  exit 0
fi

if [[ "\$1" == "ui:build" ]]; then
  mkdir -p "\$PWD/dist/control-ui"
  printf '<html>ok</html>' > "\$PWD/dist/control-ui/index.html"
  exit 0
fi

exit 0
EOF
  chmod +x "$bin_dir/pnpm"

  cat > "$bin_dir/openclaw" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "gateway" && "\${2:-}" == "restart" ]]; then
  exit 0
fi

if [[ "\${1:-}" == "gateway" && "\${2:-}" == "status" ]]; then
  echo "running"
  exit 0
fi

exit 0
EOF
  chmod +x "$bin_dir/openclaw"
}

make_fake_bin_dir_with_build_failure() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "install" ]]; then
  exit 0
fi

if [[ "$1" == "build" ]]; then
  mkdir -p "$PWD/dist"
  printf 'entry' > "$PWD/dist/entry.js"
  exit 0
fi

if [[ "$1" == "ui:build" ]]; then
  mkdir -p "$PWD/dist/control-ui"
  exit 0
fi

if [[ "$1" == "install" && "$PWD" == *"/extensions/matrix" ]]; then
  touch "$PWD/.matrix-install-attempted"
fi

exit 0
EOF
  chmod +x "$bin_dir/pnpm"

  cat > "$bin_dir/openclaw" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "gateway" && "${2:-}" == "restart" ]]; then
  exit 0
fi
if [[ "${1:-}" == "gateway" && "${2:-}" == "status" ]]; then
  echo "running"
  exit 0
fi
exit 0
EOF
  chmod +x "$bin_dir/openclaw"
}

create_repo_with_commits() {
  local repo="$1"
  git -C "$repo" init -q
  git -C "$repo" config user.name "Test User"
  git -C "$repo" config user.email "test@example.com"

  echo "base" > "$repo/file.txt"
  mkdir -p "$repo/bin"
  cat > "$repo/bin/run.sh" <<'EOF'
#!/usr/bin/env bash
echo run
EOF
  chmod +x "$repo/bin/run.sh"
  git -C "$repo" add file.txt
  git -C "$repo" add bin/run.sh
  git -C "$repo" commit -q -m "base"
  echo "$1_base" >> "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -q -m "a1"
  local a_sha
  a_sha="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" tag v2026.3.14

  echo "$1_candidate" >> "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -q -m "b1"
  local b_sha
  b_sha="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" tag v2026.3.14-1-x.30

  echo "$1_head" >> "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -q -m "c1"
  local c_sha
  c_sha="$(git -C "$repo" rev-parse HEAD)"

  cat <<EOF
$a_sha
$b_sha
$c_sha
EOF
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# ── Success: staged-swap deploy with backup + candidate export ────────────────────
remote="$tmpdir/remote.git"
dev_repo="$tmpdir/dev"
release_repo="$tmpdir/release"
fake_bin="$tmpdir/bin"
fake_log="$tmpdir/pnpm.log"
mkdir -p "$fake_bin"
make_fake_bin_dir "$fake_bin" "$fake_log"

git init --bare -q "$remote"
git init -q "$dev_repo"
sha_lines="$(create_repo_with_commits "$dev_repo")"
A_SHA="$(printf '%s\n' "$sha_lines" | sed -n '1p')"
B_SHA="$(printf '%s\n' "$sha_lines" | sed -n '2p')"
C_SHA="$(printf '%s\n' "$sha_lines" | sed -n '3p')"

mkdir -p "$dev_repo/extensions/matrix"
cat > "$dev_repo/extensions/matrix/package.json" <<'EOF'
{
  "name": "matrix",
  "version": "1.0.0"
}
EOF
cat > "$dev_repo/package.json" <<'EOF'
{
  "name": "releasectl-staged-swap-fixture",
  "version": "1.0.0"
}
EOF

git -C "$dev_repo" add extensions/matrix/package.json package.json
git -C "$dev_repo" commit -q -m "add matrix extension"
C_SHA="$(git -C "$dev_repo" rev-parse HEAD)"
git -C "$dev_repo" branch -M main
git -C "$dev_repo" checkout -q main

git -C "$dev_repo" remote add origin "$remote"
git -C "$dev_repo" push -q origin main
git -C "$dev_repo" push -q origin "$C_SHA":refs/heads/production
git -C "$dev_repo" push -q origin v2026.3.14-1-x.30

git clone -q "$remote" "$release_repo"
git -C "$release_repo" checkout -q production

tmp_home="$tmpdir/home"
tmp_tmpdir="$tmpdir/tmp"
mkdir -p "$tmp_home" "$tmp_tmpdir/openclaw-fleet-locks"
sanity_state="$tmp_tmpdir/openclaw-fleet-locks/last-sanity.env"
cat > "$sanity_state" <<EOF
SANITY_SHA="$C_SHA"
SANITY_AT="old"
SANITY_BY="test"
SKIP_SMOKE="false"
EOF

success_out="$({
  export PATH="$fake_bin:$PATH"
  export HOME="$tmp_home"
  export TMPDIR="$tmp_tmpdir"
  export PNPM_HOME="$fake_bin"
  export OPENCLAW_BIN="$fake_bin/openclaw"
  export DEV_REPO="$dev_repo"
  export STAGING_DIR="$dev_repo"
  export RELEASE_DIR="$release_repo"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  export FLEET_TARGET_SHA="$C_SHA"
  export FLEET_LINEAGE_REF="refs/remotes/origin/production"
  export SANITY_STATE_FILE="$sanity_state"
  bash "$DEPLOY_SCRIPT"
} 2>&1)"

[[ "$success_out" == *"Candidate path:"* ]] || fail "expected candidate path log"
[[ "$success_out" == *"Backup path:"* ]] || fail "expected backup path log"
[[ "$success_out" == *"Promoted commit/ref:"* ]] || fail "expected promoted metadata log"
[[ "$success_out" == *"Candidate build and validation complete"* ]] || fail "expected build completion log"

[[ ! -d "$release_repo/.git" ]] || fail "expected deployed release tree to contain no .git"
[[ -f "$release_repo/dist/entry.js" ]] || fail "expected dist/entry.js in deployed release"
[[ -f "$release_repo/dist/control-ui/index.html" ]] || fail "expected dist/control-ui/index.html in deployed release"
[[ -x "$release_repo/bin/run.sh" ]] || fail "expected executable artifact to remain executable after normalization and promotion"

backup_path="$(printf '%s\n' "$success_out" | grep -F 'Backup path:' | tail -n1 | sed 's/.*Backup path: //')"
[[ -n "$backup_path" ]] || fail "expected backup path output"
[[ -d "$backup_path" ]] || fail "expected timestamped backup directory to be created"

grep -q "extensions/matrix" "$fake_log" || fail "expected matrix extension install attempt in candidate tree"

pass "successful staged-swap deploy creates backup and promoted candidate artifacts"

# ── Failure: validation failure leaves live RELEASE_DIR untouched ─────────────────
tmpdir_fail="$tmpdir/failure"
mkdir -p "$tmpdir_fail"
remote_fail="$tmpdir_fail/remote.git"
dev_repo_fail="$tmpdir_fail/dev"
release_repo_fail="$tmpdir_fail/release"
fake_bin_fail="$tmpdir_fail/bin"

make_fake_bin_dir_with_build_failure "$fake_bin_fail"
git init --bare -q "$remote_fail"
git init -q "$dev_repo_fail"
sha_lines_fail="$(create_repo_with_commits "$dev_repo_fail")"
A_SHA_FAIL="$(printf '%s\n' "$sha_lines_fail" | sed -n '1p')"
B_SHA_FAIL="$(printf '%s\n' "$sha_lines_fail" | sed -n '2p')"
C_SHA_FAIL="$(printf '%s\n' "$sha_lines_fail" | sed -n '3p')"

mkdir -p "$dev_repo_fail/extensions/matrix"
cat > "$dev_repo_fail/extensions/matrix/package.json" <<'EOF'
{
  "name": "matrix",
  "version": "1.0.0"
}
EOF
cat > "$dev_repo_fail/package.json" <<'EOF'
{
  "name": "releasectl-staged-swap-fixture-failure",
  "version": "1.0.0"
}
EOF

git -C "$dev_repo_fail" add extensions/matrix/package.json package.json
git -C "$dev_repo_fail" commit -q -m "add matrix extension"
C_SHA_FAIL="$(git -C "$dev_repo_fail" rev-parse HEAD)"
git -C "$dev_repo_fail" branch -M main
git -C "$dev_repo_fail" checkout -q main

git -C "$dev_repo_fail" remote add origin "$remote_fail"
git -C "$dev_repo_fail" push -q origin main
git -C "$dev_repo_fail" push -q origin "$C_SHA_FAIL":refs/heads/production
git -C "$dev_repo_fail" push -q origin v2026.3.14-1-x.30

git clone -q "$remote_fail" "$release_repo_fail" >/dev/null 2>&1
git -C "$release_repo_fail" checkout -q production
release_sha_before="$(git -C "$release_repo_fail" rev-parse HEAD)"

tmp_home_fail="$tmpdir_fail/home"
tmp_tmpdir_fail="$tmpdir_fail/tmp"
mkdir -p "$tmp_home_fail" "$tmp_tmpdir_fail/openclaw-fleet-locks"
sanity_state_fail="$tmp_tmpdir_fail/openclaw-fleet-locks/last-sanity.env"
cat > "$sanity_state_fail" <<EOF
SANITY_SHA="$C_SHA_FAIL"
SANITY_AT="old"
SANITY_BY="test"
SKIP_SMOKE="false"
EOF

tmp_fail_out="$tmpdir_fail/deploy.fail.out"
if ({
  export PATH="$fake_bin_fail:$PATH"
  export HOME="$tmp_home_fail"
  export TMPDIR="$tmp_tmpdir_fail"
  export PNPM_HOME="$fake_bin_fail"
  export OPENCLAW_BIN="$fake_bin_fail/openclaw"
  export DEV_REPO="$dev_repo_fail"
  export STAGING_DIR="$dev_repo_fail"
  export RELEASE_DIR="$release_repo_fail"
  export FORK_REMOTE="origin"
  export MAIN_BRANCH="main"
  export PROD_BRANCH="production"
  export FLEET_TARGET_SHA="$C_SHA_FAIL"
  export FLEET_LINEAGE_REF="refs/remotes/origin/production"
  export SANITY_STATE_FILE="$sanity_state_fail"
  bash "$DEPLOY_SCRIPT"
} 2>&1) >"$tmp_fail_out"; then
  fail "expected staged-swap validation failure to fail deploy"
fi

release_sha_after="$(git -C "$release_repo_fail" rev-parse HEAD)"
[[ "$release_sha_after" == "$release_sha_before" ]] || fail "release HEAD changed after failed deploy"
[[ -d "$release_repo_fail/.git" ]] || fail "expected untouched live release tree to remain a git checkout on failure"

backup_path_fail="$(sed -n 's/.*Backup path: //p' "$tmp_fail_out" | tail -n1)"
if [[ -n "$backup_path_fail" ]]; then
  [[ ! -d "$backup_path_fail" ]] || fail "backup should not persist after failed candidate validation"
fi

pass "validation failure keeps original RELEASE_DIR intact and unused"
