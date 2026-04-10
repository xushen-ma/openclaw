#!/usr/bin/env bash
# deploy.sh — Tag a release and deploy to production
# Usage: deploy.sh [--dry-run]
#
# Version is auto-generated from git history using our fork tag scheme:
#   v<upstream-base>-x.<increment>
#   e.g. v2026.3.9-x.1, v2026.3.9-x.2, ...
#
# Generation logic:
#   1. Walk back from xushen/main first-parent history to find the upstream
#      base tag (plain vYYYY.M.D; no -x suffix)
#   2. Find highest existing tag for that base: v<base>-x.N
#   3. Next version is v<base>-x.<N+1>
#
# Prerequisites:
#   - sanity-check.sh must have passed
#   - origin/main is at the desired commit, OR FLEET_TARGET_SHA pins a merged ancestor candidate
#   - gh CLI authenticated

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"
source "$SCRIPT_DIR/lock.sh"

# If sudo preserved caller HOME, re-anchor to the actual runtime user's home.
RUNTIME_HOME="$(python3 - <<'PY'
import os, pwd
print(pwd.getpwuid(os.getuid()).pw_dir)
PY
)"
if [[ -n "$RUNTIME_HOME" && "${HOME:-}" != "$RUNTIME_HOME" ]]; then
  export HOME="$RUNTIME_HOME"
fi

setup_release_runtime_env() {
  export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
  export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  export TMPDIR="${TMPDIR:-$HOME/tmp}"
  export TMP="${TMP:-$TMPDIR}"
  export TEMP="${TEMP:-$TMPDIR}"
  export CI="${CI:-true}"
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
if not os.access(p, os.R_OK):
    print(f"missing read permission on: {p}", file=sys.stderr)
    sys.exit(1)
PY
}

assert_control_ui_assets() {
  local root="$1"
  for item in "$root/dist/control-ui" "$root/dist/control-ui/index.html"; do
    [[ -e "$item" ]] || { echo "❌ Missing required Control UI asset/path: $item"; exit 1; }
  done
}

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Auto-generate version ─────────────────────────────────────────────────────
# Strategy: find the upstream tag that our patches sit on top of.
# This is NOT necessarily the latest upstream tag — it is the specific tag
# we rebased onto (which may be older if we haven't caught up to upstream yet).
#
# Method: walk first-parent history from the target release candidate until we
# land on a commit that carries a plain upstream tag vYYYY.M.D (no -x suffix).
# That is the exact upstream commit we based this release line on.

cd "$DEV_REPO"
git fetch "$FORK_REMOTE" --tags --quiet 2>/dev/null || true
git fetch origin --tags --quiet 2>/dev/null || true

CANDIDATE_SHA="${FLEET_TARGET_SHA:-}"
MAIN_REF="${FLEET_MAIN_REF:-refs/remotes/$FORK_REMOTE/$MAIN_BRANCH}"
LINEAGE_REF="${FLEET_LINEAGE_REF:-}"

resolve_lineage_ref() {
  local explicit_ref="$1"
  local main_ref="$2"

  if [[ -n "$explicit_ref" ]]; then
    git rev-parse --verify "$explicit_ref" >/dev/null 2>&1 || {
      echo "❌ Refusing deploy: lineage reference not found: $explicit_ref"
      exit 1
    }
    printf '%s\n' "$explicit_ref"
    return 0
  fi

  local candidate
  for candidate in \
    "refs/remotes/$FORK_REMOTE/xushen/$PROD_BRANCH" \
    "refs/remotes/$FORK_REMOTE/$PROD_BRANCH" \
    "$main_ref"
  do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "❌ Refusing deploy: could not resolve a lineage reference"
  exit 1
}

LINEAGE_REF="$(resolve_lineage_ref "$LINEAGE_REF" "$MAIN_REF")"

if [[ -n "$CANDIDATE_SHA" && "$CANDIDATE_SHA" != "unknown" ]]; then
  echo "📌 Using pinned candidate SHA: $CANDIDATE_SHA"
  git merge-base --is-ancestor "$CANDIDATE_SHA" "$LINEAGE_REF" >/dev/null 2>&1 || {
    MAIN_HEAD="$(git rev-parse "$MAIN_REF" 2>/dev/null || echo unknown)"
    PROD_HEAD="$(git rev-parse "$LINEAGE_REF" 2>/dev/null || echo unknown)"
    ON_MAIN=no
    ON_PROD=no
    git merge-base --is-ancestor "$CANDIDATE_SHA" "$MAIN_REF" >/dev/null 2>&1 && ON_MAIN=yes || true
    git merge-base --is-ancestor "$CANDIDATE_SHA" "$LINEAGE_REF" >/dev/null 2>&1 && ON_PROD=yes || true
    echo "❌ Cannot deploy pinned SHA $CANDIDATE_SHA to production directly."
    echo ""
    echo "Reason:"
    echo "- candidate is not an ancestor of resolved production lineage: $LINEAGE_REF"
    echo "- main lane head: $MAIN_HEAD"
    echo "- production lineage head: $PROD_HEAD"
    echo "- candidate on main lane: $ON_MAIN"
    echo "- candidate on production lineage: $ON_PROD"
    echo ""
    echo "What this means:"
    echo "- releasectl deploy is the governed production tag+deploy step"
    echo "- it only accepts candidates that are already on the resolved production lineage"
    echo "- a merged main SHA is not automatically a production deploy candidate"
    echo ""
    echo "What to do next:"
    echo "1. Check whether validation/tagging has already produced a validated v*-x.* tag for this commit"
    echo "2. If yes, let staging-deploy consume that tag and verify staging"
    echo "3. Promote that validated artifact onto production lineage:"
    echo "     releasectl promote-production --sha <validated-tag-or-sha>"
    echo "4. Then deploy the resulting production-lineage commit:"
    echo "     releasectl deploy --sha <resulting-production-lineage-sha>"
    echo "5. If no validated tag exists yet, wait for / fix the main → validation → tag → staging flow first"
    exit 1
  }
else
  CANDIDATE_SHA=$(git rev-parse "$LINEAGE_REF")
fi

# Prefer the active fork release line when one already exists on this candidate.
# Example: if v2026.3.8-x.1 is already merged, the next tag should be v2026.3.8-x.2
# rather than falling back to an older plain upstream tag found deeper in history.
FORK_BASE=""
EXISTING_MAX=""
LATEST_FORK_TAG="$(git tag --merged "$CANDIDATE_SHA" \
  | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+(-[0-9]+)?-x\.[0-9]+$' \
  | sort -V \
  | tail -1 || true)"

if [[ -n "$LATEST_FORK_TAG" ]]; then
  FORK_BASE="${LATEST_FORK_TAG%-x.*}"
  EXISTING_MAX="${LATEST_FORK_TAG##*-x.}"
  echo "📌 Continuing fork release line from: $LATEST_FORK_TAG"
fi

# Otherwise find the latest merged stable upstream base tag on the candidate.
UPSTREAM_BASE=""
if [[ -n "${RELEASE_BASE_VERSION:-}" ]]; then
  if [[ ! "${RELEASE_BASE_VERSION}" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
    echo "❌ RELEASE_BASE_VERSION must be stable vYYYY.M.D or vYYYY.M.D.PATCH (got: ${RELEASE_BASE_VERSION})"
    exit 1
  fi
  UPSTREAM_BASE="$RELEASE_BASE_VERSION"
elif [[ -z "$FORK_BASE" ]]; then
  UPSTREAM_BASE="$(git tag --merged "$CANDIDATE_SHA" \
    | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+(\.[0-9]+)?$' \
    | grep -v beta \
    | sort -V \
    | tail -1 || true)"
fi

if [[ -z "$FORK_BASE" && -z "$UPSTREAM_BASE" ]]; then
  echo "❌ Could not determine release base tag from git history."
  echo "   Expected an existing fork tag vYYYY.M.D-x.N or a stable upstream tag vYYYY.M.D(.PATCH) on the candidate history."
  exit 1
fi

BASE_TAG="${FORK_BASE:-$UPSTREAM_BASE}"
echo "📌 Release base: $BASE_TAG"

GLOBAL_MAX=$(git tag -l "${BASE_TAG}-x.*" \
  | sed -nE "s|^${BASE_TAG//./\\.}-x\\.([0-9]+)$|\\1|p" \
  | sort -n \
  | tail -1)

if [[ -z "$EXISTING_MAX" ]]; then
  EXISTING_MAX="$GLOBAL_MAX"
elif [[ -n "$GLOBAL_MAX" ]] && (( GLOBAL_MAX > EXISTING_MAX )); then
  # Avoid collisions with already-created tags that are outside current lineage.
  EXISTING_MAX="$GLOBAL_MAX"
fi

NEXT_INCREMENT=$((${EXISTING_MAX:-0} + 1))
VERSION="${BASE_TAG}-x.${NEXT_INCREMENT}"

echo "📌 Next version: $VERSION  (existing max increment: ${EXISTING_MAX:-0})"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "── Dry run — would deploy: $VERSION"
  echo "   Upstream base: $UPSTREAM_BASE"
  echo "   Candidate SHA: $CANDIDATE_SHA"
  exit 0
fi

# ── Validate format (sanity guard) ───────────────────────────────────────────
if [[ ! "$VERSION" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+(-[0-9]+)?-x\.[0-9]+$ ]]; then
  echo "❌ Auto-generated version '$VERSION' has unexpected format — aborting."
  exit 1
fi

export FLEET_AGENT="${FLEET_AGENT:-Kero}"
export FLEET_SESSION="${FLEET_SESSION:-agent:main:discord:direct:965214128090255411}"
export FLEET_PURPOSE="deploy"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"
lock_acquire "$RELEASE_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$RELEASE_LOCK_FILE"' EXIT

if [[ ! -f "$SANITY_STATE_FILE" ]]; then
  SANITY_SHA=""
  SANITY_AT=""
  SANITY_BY=""
  SKIP_SMOKE=""
else
  # shellcheck disable=SC1090
  source "$SANITY_STATE_FILE"
fi


echo "════════════════════════════════════"
echo "  Deploy: $VERSION"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "════════════════════════════════════"
echo ""

# ── Guard: tag must not already exist ────────────────────────────────────────
if git tag | grep -q "^${VERSION}$"; then
  echo "❌ Tag $VERSION already exists — this should not happen (auto-increment bug?)."
  exit 1
fi

export FLEET_TARGET_SHA="$CANDIDATE_SHA"

auto_validated_tag="$(git tag --points-at "$CANDIDATE_SHA" | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+(-[0-9]+)?-x\.[0-9]+$' | sort -V | tail -1 || true)"
already_on_production_lineage=false
if git merge-base --is-ancestor "$CANDIDATE_SHA" "$LINEAGE_REF" >/dev/null 2>&1; then
  already_on_production_lineage=true
fi
already_validated_and_promoted=false
if [[ -n "$auto_validated_tag" && "$already_on_production_lineage" == true ]]; then
  already_validated_and_promoted=true
fi

echo "📌 Candidate SHA:       $CANDIDATE_SHA"
echo "📌 Resolved lineage ref: $LINEAGE_REF"
echo "🧾 Last sanity SHA:      ${SANITY_SHA:-missing}"
if [[ "$already_validated_and_promoted" == true ]]; then
  echo "✅ Candidate already validated/promoted (tag $auto_validated_tag on production lineage)"
fi

if [[ "${SANITY_SHA:-}" != "$CANDIDATE_SHA" ]]; then
  if [[ "$already_validated_and_promoted" == true ]]; then
    echo "ℹ️  Skipping stale local sanity guard (candidate already validated/promoted)."
  elif [[ -z "${SANITY_SHA:-}" ]]; then
    echo "❌ No recorded sanity-check state found at $SANITY_STATE_FILE"
    echo "   Run sanity-check.sh successfully before deploy."
    exit 1
  else
    echo "❌ Refusing deploy: sanity check was for a different candidate SHA"
    echo "   sanity: ${SANITY_SHA:-missing}"
    echo "   current: $CANDIDATE_SHA"
    echo "   Rerun sanity-check.sh before deploy."
    exit 1
  fi
fi

echo "📌 Tagging $VERSION at $CANDIDATE_SHA"

# ── Tag ───────────────────────────────────────────────────────────────────────
git tag "$VERSION" "$CANDIDATE_SHA"
git push "$FORK_REMOTE" "$VERSION"
echo "✅ Tag pushed"

# ── Reset production pointer ──────────────────────────────────────────────────
echo "🔀 Resetting production → $VERSION"
git push "$FORK_REMOTE" "$CANDIDATE_SHA:production" --force
echo "✅ production branch updated"

# ── Pull to release workspace ─────────────────────────────────────────────────
echo "📥 Pulling release workspace..."
cd "$RELEASE_DIR"
git fetch origin --tags --quiet
git checkout production
git pull origin production
echo "✅ Release workspace at: $(git log --oneline -1)"

# ── Build ─────────────────────────────────────────────────────────────────────
setup_release_runtime_env
assert_path_traversable "$RELEASE_DIR"
echo "🔨 Building as $(id -un) with HOME=$HOME TMPDIR=$TMPDIR"
pnpm install --frozen-lockfile 2>&1 | tail -5
pnpm build 2>&1 | tail -5
echo "🖥️  Building Control UI"
pnpm ui:build 2>&1 | tail -5
assert_control_ui_assets "$RELEASE_DIR"

# Extension-local runtime deps/materialization
if [[ -d extensions/matrix ]]; then
  echo "📦 Installing matrix extension deps..."
  (cd extensions/matrix && pnpm install --frozen-lockfile 2>&1 | tail -3)
fi
if [[ -d extensions/acpx ]]; then
  echo "📦 Installing ACPX extension deps..."
  (
    cd extensions/acpx
    npm install --omit=dev --no-save 2>&1 | tail -5
    ./node_modules/.bin/acpx --version 2>&1 | tail -1
  )
fi
echo "✅ Build complete (Control UI assets verified)"

# ── Deploy ────────────────────────────────────────────────────────────────────
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
if [[ -z "$OPENCLAW_BIN" ]] && [[ -x /opt/homebrew/bin/openclaw ]]; then
  OPENCLAW_BIN="/opt/homebrew/bin/openclaw"
fi
[[ -n "$OPENCLAW_BIN" ]] || { echo "❌ openclaw CLI not found in PATH"; exit 1; }

echo "🚀 Restarting gateway..."
"$OPENCLAW_BIN" gateway restart
sleep 8

STATUS=$("$OPENCLAW_BIN" gateway status 2>&1 || echo "unknown")
if echo "$STATUS" | grep -qi "running"; then
  echo "✅ Gateway running"
else
  echo "⚠️  Gateway status unclear — check manually: openclaw gateway status"
  echo "$STATUS"
fi

# ── Write deploy log ──────────────────────────────────────────────────────────
DEPLOY_LOG_DIR="${RELEASE_DEPLOY_LOG_DIR:-$HOME/.openclaw/releasectl/deploy-logs}"
if ! mkdir -p "$DEPLOY_LOG_DIR" 2>/dev/null; then
  DEPLOY_LOG_DIR="${TMPDIR:-/tmp}/openclaw-fleet-deploy-logs"
  mkdir -p "$DEPLOY_LOG_DIR"
fi
LOG_FILE="$DEPLOY_LOG_DIR/$(date '+%Y-%m-%d')-deploy-${VERSION}.md"

if cat > "$LOG_FILE" <<EOF
# Deploy Log: $VERSION
Date: $(date '+%Y-%m-%d %H:%M %Z')
Commit: $CANDIDATE_SHA
Upstream base: $UPSTREAM_BASE

## Checks
- Sanity check passed before this deploy (required)

## Deploy
- Tagged: $VERSION
- Deployed: $(date '+%H:%M %Z')
- Post-deploy gateway status: $STATUS

## Notes
EOF
then
  echo "📝 Deploy log: $LOG_FILE"
else
  echo "⚠️  Could not write deploy log at $LOG_FILE"
fi

echo ""
echo "════════════════════════════════════"
echo "  ✅ Deployed $VERSION successfully"
echo "════════════════════════════════════"
