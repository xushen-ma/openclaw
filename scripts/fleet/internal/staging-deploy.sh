#!/usr/bin/env bash
# staging-deploy.sh — reset staging repo to a target SHA and build under oc-release
# Usage: staging-deploy.sh <sha-or-ref>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"
source "$SCRIPT_DIR/lock.sh"

TARGET_REF="${1:-}"
if [[ -z "$TARGET_REF" ]]; then
  echo "❌ Usage: $0 <sha-or-ref>" >&2
  exit 1
fi

# If sudo preserved caller HOME, re-anchor to the actual runtime user's home.
RUNTIME_HOME="$(python3 - <<'PY'
import os, pwd
print(pwd.getpwuid(os.getuid()).pw_dir)
PY
)"
if [[ -n "$RUNTIME_HOME" && "${HOME:-}" != "$RUNTIME_HOME" ]]; then
  export HOME="$RUNTIME_HOME"
fi

setup_staging_runtime_env() {
  export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
  export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  export TMPDIR="${TMPDIR:-$HOME/tmp}"
  export TMP="${TMP:-$TMPDIR}"
  export TEMP="${TEMP:-$TMPDIR}"
  mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$PNPM_HOME" "$TMPDIR"
  chmod 700 "$TMPDIR" 2>/dev/null || true
  export PATH="$PNPM_HOME:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
}

assert_path_traversable() {
  local path="$1"
  python3 - "$path" <<'PY'
import os, sys
p = os.path.realpath(sys.argv[1])
cur = '/'
for part in [x for x in p.split('/') if x]:
    cur = os.path.join(cur, part)
    if not os.access(cur, os.X_OK):
        print(f"missing execute permission on: {cur}", file=sys.stderr)
        sys.exit(1)
if not os.access(p, os.R_OK | os.W_OK | os.X_OK):
    print(f"missing rwx permission on: {p}", file=sys.stderr)
    sys.exit(1)
PY
}

export FLEET_AGENT="${FLEET_AGENT:-Kero}"
export FLEET_SESSION="${FLEET_SESSION:-agent:main:discord:direct:965214128090255411}"
export FLEET_PURPOSE="staging-deploy"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"
lock_acquire "$STAGING_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$STAGING_LOCK_FILE"' EXIT

[[ -d "$STAGING_REPO/.git" ]] || { echo "❌ Invalid staging repo: $STAGING_REPO" >&2; exit 1; }

setup_staging_runtime_env
assert_path_traversable "$STAGING_REPO"

cd "$STAGING_REPO"
git fetch "$FORK_REMOTE" --tags --quiet 2>/dev/null || true

RESOLVE_REF="$TARGET_REF"
if ! git rev-parse --verify --quiet "$RESOLVE_REF^{commit}" >/dev/null; then
  echo "📥 Target not reachable locally; fetching from $FORK_REMOTE: $TARGET_REF"
  git fetch "$FORK_REMOTE" "refs/heads/$TARGET_REF:refs/remotes/$FORK_REMOTE/$TARGET_REF" --quiet 2>/dev/null \
    || git fetch "$FORK_REMOTE" "$TARGET_REF" --quiet
  if git rev-parse --verify --quiet "refs/remotes/$FORK_REMOTE/$TARGET_REF^{commit}" >/dev/null; then
    RESOLVE_REF="refs/remotes/$FORK_REMOTE/$TARGET_REF"
  fi
fi

echo "📌 Resolving staging target: $RESOLVE_REF"
RESOLVED_SHA="$(git rev-parse "$RESOLVE_REF^{commit}")"
echo "📌 Staging target SHA: $RESOLVED_SHA"

echo "🧹 Cleaning untracked files (keeping .test-instance/)"
git clean -fd --exclude='.test-instance/'

echo "🔀 Resetting staging checkout"
git reset --hard "$RESOLVED_SHA"

echo "🔨 Installing dependencies"
pnpm install --frozen-lockfile

echo "🏗️  Building staging checkout"
pnpm build

echo "STAGING-DEPLOY-OK"
echo "staging_sha=$RESOLVED_SHA"
