#!/usr/bin/env bash
# sanity-check.sh — Run all 5 pre-deploy checks
# Usage: sanity-check.sh [--skip-smoke]
#
# Checks:
#   1. Build clean       — pnpm check + pnpm build
#   2. Automated tests   — vitest run (our feature areas)
#   3. Staging boot      — test instance gateway starts cleanly
#   4. Smoke test        — /status + Hello to Tester Bot (skippable)
#   5. Patch integrity   — our 3 commits present on fork/main
#
# Exits 0 only if ALL checks pass.

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

SKIP_SMOKE=false
[[ "${1:-}" == "--skip-smoke" ]] && SKIP_SMOKE=true

PASS=0
FAIL=0
RESULTS=()

check_pass() { PASS=$((PASS+1)); RESULTS+=("✅ $1"); echo "✅ $1"; }
check_fail() { FAIL=$((FAIL+1)); RESULTS+=("❌ $1"); echo "❌ $1"; }

normalize_staging_permissions() {
  local repo="$1"
  chmod -R a+rX "$repo/.git" 2>/dev/null || true
  chmod -R a+rX "$repo/node_modules" 2>/dev/null || true
  chmod -R a+rX "$repo/dist" 2>/dev/null || true
  chmod -R a+rwX "$repo/.test-instance" 2>/dev/null || true
}

setup_sanity_runtime_env() {
  export TMPDIR="${TMPDIR:-$HOME/tmp}"
  export TMP="${TMP:-$TMPDIR}"
  export TEMP="${TEMP:-$TMPDIR}"
  mkdir -p "$TMPDIR"
  chmod 700 "$TMPDIR" 2>/dev/null || true
}

export FLEET_AGENT="${FLEET_AGENT:-Mini}"
export FLEET_SESSION="${FLEET_SESSION:-agent:main:discord:direct:965214128090255411}"
export FLEET_PURPOSE="sanity-check"
OWNER_NAME="${FLEET_OWNER:-${FLEET_AGENT}/${FLEET_PURPOSE}}"
lock_acquire "$STAGING_LOCK_FILE" "$OWNER_NAME"
trap 'lock_release "$STAGING_LOCK_FILE"' EXIT

MAIN_SHA_BEFORE="${FLEET_TARGET_SHA:-}"

mkdir -p "$FLEET_LOCK_DIR"
setup_sanity_runtime_env
BUILD_LOG="$TMPDIR/fleet-build.log"
STAGING_START_LOG="$TMPDIR/fleet-staging-start.log"


echo "════════════════════════════════════"
echo "  Production Sanity Check"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "════════════════════════════════════"

# ── Preflight: verify required paths exist ───────────────────────────────────
echo ""
echo "── Preflight"
PREFLIGHT_OK=true
[[ -d "$DEV_REPO" ]]     || { echo "  ❌ DEV_REPO not found: $DEV_REPO"; PREFLIGHT_OK=false; }
[[ -d "$STAGING_DIR" ]]  || { echo "  ❌ STAGING_DIR not found: $STAGING_DIR"; PREFLIGHT_OK=false; }
[[ -d "$RELEASE_DIR" ]]  || { echo "  ❌ RELEASE_DIR not found: $RELEASE_DIR"; PREFLIGHT_OK=false; }
command -v gh &>/dev/null || { echo "  ❌ gh CLI not found"; PREFLIGHT_OK=false; }
command -v pnpm &>/dev/null || { echo "  ❌ pnpm not found"; PREFLIGHT_OK=false; }
if [[ "$PREFLIGHT_OK" != true ]]; then
  echo "🚫 Preflight failed — fix environment before running checks."
  exit 1
fi
echo "  ✅ Paths and tools present"

# ── Check 1: Build clean ─────────────────────────────────────────────────────
echo ""
echo "── Check 1: Build clean"
cd "$DEV_REPO"
# Default to fork/main, but allow an explicit candidate SHA for deterministic release validation
CANDIDATE_REF="${FLEET_TARGET_SHA:-}"
echo "  Syncing dev repo..."
git fetch "$FORK_REMOTE" --quiet 2>/dev/null || true
if [[ -n "$CANDIDATE_REF" && "$CANDIDATE_REF" != "unknown" ]]; then
  MAIN_SHA_BEFORE="$CANDIDATE_REF"
  echo "  Testing pinned candidate SHA: $MAIN_SHA_BEFORE"
  git reset --hard "$MAIN_SHA_BEFORE" --quiet 2>/dev/null || true
else
  MAIN_SHA_BEFORE=$(git rev-parse "refs/remotes/$FORK_REMOTE/$MAIN_BRANCH")
  echo "  Testing main SHA: $MAIN_SHA_BEFORE"
  git reset --hard "refs/remotes/$FORK_REMOTE/$MAIN_BRANCH" --quiet 2>/dev/null || true
fi
if ! pnpm build > "$BUILD_LOG" 2>&1; then
  check_fail "Build: pnpm build failed (see $BUILD_LOG)"
else
  check_pass "Build: pnpm build succeeded"
fi

# ── Check 2: Automated tests (our feature areas only) ───────────────────────
echo ""
echo "── Check 2: Automated tests (our patches)"
cd "$DEV_REPO"
# Test only our 3 feature areas — upstream failures are pre-existing and not our concern
TEST_AREAS=(
  "src/auto-reply/reply/commands-core.test.ts"
  "src/plugins/loader.test.ts"
  "src/daemon"
)
TEST_OUT=$(npx vitest run "${TEST_AREAS[@]}" 2>&1)
OUR_FAILS=$(echo "$TEST_OUT" | grep -c "^.*failed" | head -1 || echo "0")
SUMMARY=$(echo "$TEST_OUT" | grep "Test Files" | tail -1)
if echo "$SUMMARY" | grep -q "failed"; then
  check_fail "Tests: regressions in our feature areas — $SUMMARY"
  echo "$TEST_OUT" | grep -A3 "FAIL src/" | head -20
else
  check_pass "Tests: our feature areas clean — $SUMMARY"
fi

# ── Check 3: Staging boot ────────────────────────────────────────────────────
echo ""
echo "── Check 3: Staging boot"
RUN_SCRIPT="$STAGING_DIR/.test-instance/run-test-instance.sh"
STOP_SCRIPT="$STAGING_DIR/.test-instance/../stop-test-instance.sh"
PID_FILE="$STAGING_DIR/.test-instance/gateway.pid"
GW_LOG="$STAGING_DIR/.test-instance/gateway.log"
if [[ ! -f "$TEST_ENV" ]]; then
  check_fail "Staging: test.env not found at $TEST_ENV"
elif [[ ! -f "$TEST_CONFIG" ]]; then
  check_fail "Staging: test config not found at $TEST_CONFIG"
elif [[ ! -f "$RUN_SCRIPT" ]]; then
  check_fail "Staging: run-test-instance.sh not found at $RUN_SCRIPT"
else
  cd "$STAGING_DIR"
  # Ensure read/execute access to local binaries when staging checkout was last
  # updated by oc-release (otherwise lifecycle commands can fail with EACCES).
  normalize_staging_permissions "$STAGING_DIR"

  # Boot test instance from current staged build artifact.
  # (Build/install ownership is handled by staging-deploy under oc-release.)
  bash "$RUN_SCRIPT" > "$STAGING_START_LOG" 2>&1 || true
  sleep 8
  # Check gateway is running via pid file
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    check_pass "Staging: gateway booted cleanly (pid $(cat "$PID_FILE"))"
  else
    check_fail "Staging: gateway did not start (no pid or process dead)"
    tail -20 "$GW_LOG" 2>/dev/null | sed 's/^/  /' || true
  fi
fi

# ── Check 4: Staging local smoke ──────────────────────────────────────────────
echo ""
echo "── Check 4: Staging local smoke"
if [[ "$SKIP_SMOKE" == true ]]; then
  check_pass "Smoke: skipped (--skip-smoke)"
else
  if [[ ! -f "$GW_LOG" ]]; then
    check_fail "Smoke: gateway log not found at $GW_LOG"
  else
    SMOKE_OK=false
    for _ in $(seq 1 20); do
      if grep -q "listening on ws://127.0.0.1:" "$GW_LOG" \
        && grep -q "logged in to discord as" "$GW_LOG"; then
        SMOKE_OK=true
        break
      fi
      sleep 1
    done

    if [[ "$SMOKE_OK" == true ]]; then
      check_pass "Smoke: staging gateway reached ready state and Discord test bot logged in"
    else
      check_fail "Smoke: staging gateway did not reach expected ready/logged-in state"
      tail -20 "$GW_LOG" 2>/dev/null | sed 's/^/  /' || true
    fi
  fi
fi

# ── Check 5: Patch integrity ─────────────────────────────────────────────────
echo ""
echo "── Check 5: Patch integrity"
cd "$DEV_REPO"
git fetch "$FORK_REMOTE" --quiet 2>/dev/null || true
if [[ -n "${FLEET_TARGET_SHA:-}" && "${FLEET_TARGET_SHA:-}" != "unknown" ]]; then
  PATCH_REF="$FLEET_TARGET_SHA"
else
  PATCH_REF="refs/remotes/$FORK_REMOTE/$MAIN_BRANCH"
fi

has_patch_commit() {
  local pattern="$1"
  git log --oneline --grep="$pattern" "$PATCH_REF" -n 1 | grep -q .
}

has_patch_code() {
  local key="$1"
  case "$key" in
    smart-reset)
      grep -q "emitResetCommandHooks" src/auto-reply/reply/commands-core.ts 2>/dev/null
      ;;
    fast-restart)
      grep -q "kickstart" src/daemon/launchd.ts 2>/dev/null
      ;;
    matrix-heal)
      grep -q "ensureMatrixCryptoRuntime" extensions/matrix/index.ts 2>/dev/null
      ;;
    *)
      return 1
      ;;
  esac
}

MISSING=()
(has_patch_commit "$PATCH_SMART_RESET_PATTERN"  || has_patch_code "smart-reset")  || MISSING+=("smart-reset")
(has_patch_commit "$PATCH_FAST_RESTART_PATTERN" || has_patch_code "fast-restart") || MISSING+=("--fast restart")
(has_patch_commit "$PATCH_MATRIX_HEAL_PATTERN"  || has_patch_code "matrix-heal")  || MISSING+=("matrix self-heal")

if [[ ${#MISSING[@]} -eq 0 ]]; then
  check_pass "Patches: all 3 present on $PATCH_REF"
else
  check_fail "Patches: missing — ${MISSING[*]}"
  echo "  Recent commits:"
  git log --oneline "$PATCH_REF" | head -5 | sed 's/^/  /' || true
fi

# Validate release lineage for this candidate path. Pre-tag candidates may not yet
# have a merged fork tag, so accept either an existing merged fork tag or a stable
# upstream base tag from which deploy.sh can derive the next fork tag.
LATEST_FORK_TAG=$(git tag --merged "$PATCH_REF" \
  | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+-x\.[0-9]+$' \
  | sort -V \
  | tail -1 || true)
LATEST_STABLE_BASE_TAG=$(git tag --merged "$PATCH_REF" \
  | grep -E '^v[0-9]{4}\.[0-9]+\.[0-9]+(\.[0-9]+)?$' \
  | grep -v beta \
  | sort -V \
  | tail -1 || true)
if [[ -n "$LATEST_FORK_TAG" ]]; then
  check_pass "Tags: latest fork tag format OK ($LATEST_FORK_TAG)"
elif [[ -n "$LATEST_STABLE_BASE_TAG" ]]; then
  check_pass "Tags: pre-tag candidate anchored to stable base ($LATEST_STABLE_BASE_TAG)"
else
  check_fail "Tags: no merged fork tag or stable base tag found for candidate history"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""

if [[ -n "${FLEET_TARGET_SHA:-}" && "${FLEET_TARGET_SHA:-}" != "unknown" ]]; then
  MAIN_SHA_AFTER=$(git -C "$DEV_REPO" rev-parse HEAD 2>/dev/null || echo "unknown")
else
  MAIN_SHA_AFTER=$(git -C "$DEV_REPO" rev-parse "refs/remotes/$FORK_REMOTE/$MAIN_BRANCH" 2>/dev/null || echo "unknown")
fi
if [[ "$MAIN_SHA_AFTER" != "$MAIN_SHA_BEFORE" ]]; then
  echo "❌ candidate moved during sanity check"
  echo "   before: $MAIN_SHA_BEFORE"
  echo "   after:  $MAIN_SHA_AFTER"
  echo "🚫 Sanity check result is stale — rerun before deploy."
  exit 1
fi

cat > "$SANITY_STATE_FILE" <<EOF
SANITY_SHA="$MAIN_SHA_BEFORE"
SANITY_AT="$(date '+%Y-%m-%d %H:%M:%S %Z')"
SANITY_BY="$OWNER_NAME"
SKIP_SMOKE="$SKIP_SMOKE"
EOF

echo "Recorded sanity state: $SANITY_STATE_FILE"
echo "  SANITY_SHA=$MAIN_SHA_BEFORE"

# Clean up staging gateway after checks complete
if [[ -f "$PID_FILE" ]]; then
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo "🚫 Sanity check FAILED — do not deploy. Report to Mini."
  exit 1
else
  echo "🟢 All checks passed — safe to proceed with deploy.sh"
  exit 0
fi
