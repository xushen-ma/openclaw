#!/usr/bin/env bash
# sync-installed-bundle.sh — Sync version-controlled fleet scripts into the installed governed bundle
# Usage:
#   sync-installed-bundle.sh [--check]
#   sync-installed-bundle.sh --sync
#
# Rules:
# - Intended as a Mini-approved maintenance path for /usr/local/lib/openclaw-fleet/*
# - Must run through releasectl / privileged ops, not ad-hoc shell habit
# - Source of truth is the version-controlled workspace copy under scripts/fleet/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"

MODE="check"
[[ "${1:-}" == "--sync" ]] && MODE="sync"
[[ "${1:-}" == "--check" ]] && MODE="check"

# Governed control repo sync (optional but enabled by default)
CONTROLLED_REPO="${RELEASECTL_CONTROLLED_REPO:-/Users/openclaw/workspace/openclaw-fleet-mgmt}"
CONTROLLED_REMOTE="${RELEASECTL_CONTROLLED_REMOTE:-origin}"
CONTROLLED_BRANCH="${RELEASECTL_CONTROLLED_BRANCH:-main}"
CONTROLLED_BUNDLE_ROOT="${RELEASECTL_CONTROLLED_BUNDLE_ROOT:-$CONTROLLED_REPO}"
ENFORCE_CONTROLLED_PARITY="${RELEASECTL_ENFORCE_CONTROLLED_PARITY:-1}"

# Operational guardrail: this path is for Mini-approved maintenance only.
# Technical note: after releasectl's sudo handoff, agent identity metadata may not
# survive intact through the privileged runtime. So this script accepts execution
# as the governed release user (`oc-release`) and relies on the password-gated
# `releasectl bundle-sync` command + Mini policy as the actual approval boundary.
FLEET_AGENT_NAME="${FLEET_AGENT:-${AGENT_ID:-unknown}}"
CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
if [[ "$CURRENT_USER" != "oc-release" && "$FLEET_AGENT_NAME" != "Mini" && "$FLEET_AGENT_NAME" != "main" ]]; then
  echo "❌ sync-installed-bundle is Mini-only operationally (FLEET_AGENT=$FLEET_AGENT_NAME user=$CURRENT_USER)"
  exit 1
fi

# Source of truth is Mini's local fleet-ops tree for this machine, not the
# OpenClaw product repo. Keep it on a path the governed user can traverse/read.
SRC_ROOT="${RELEASECTL_SOURCE_ROOT:-/Users/openclaw/workspace/openclaw/scripts/fleet}"
DST_ROOT="${RELEASECTL_INSTALL_ROOT:-/usr/local/lib/openclaw-fleet}"

sha256_of() {
  shasum -a 256 "$1" | awk '{print $1}'
}

controlled_repo_status() {
  if [[ ! -d "$CONTROLLED_REPO/.git" ]]; then
    echo "controlled_repo=missing path=$CONTROLLED_REPO"
    return 0
  fi

  local head branch upstream upstream_head
  head="$(git -C "$CONTROLLED_REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  branch="$(git -C "$CONTROLLED_REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  upstream="$(git -C "$CONTROLLED_REPO" rev-parse --abbrev-ref "@{upstream}" 2>/dev/null || true)"

  if [[ -n "$upstream" ]]; then
    upstream_head="$(git -C "$CONTROLLED_REPO" rev-parse "$upstream" 2>/dev/null || echo unknown)"
    if [[ "$head" == "$upstream_head" ]]; then
      echo "controlled_repo=ok path=$CONTROLLED_REPO branch=$branch head=$head upstream=$upstream"
    else
      echo "controlled_repo=drift path=$CONTROLLED_REPO branch=$branch head=$head upstream=$upstream upstream_head=$upstream_head"
    fi
  else
    echo "controlled_repo=no-upstream path=$CONTROLLED_REPO branch=$branch head=$head"
  fi
}

sync_controlled_repo() {
  [[ "$MODE" == "sync" ]] || return 0

  if [[ ! -d "$CONTROLLED_REPO/.git" ]]; then
    echo "SKIP     controlled-repo ($CONTROLLED_REPO not present)"
    return 0
  fi

  echo "SYNC     controlled-repo ($CONTROLLED_REPO)"
  git -C "$CONTROLLED_REPO" fetch "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"
  git -C "$CONTROLLED_REPO" checkout "$CONTROLLED_BRANCH"
  git -C "$CONTROLLED_REPO" pull --ff-only "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"
  echo "SYNCED   controlled-repo ($CONTROLLED_REMOTE/$CONTROLLED_BRANCH)"
}

sync_controlled_repo

controlled_path_for_rel() {
  local rel="$1"
  case "$rel" in
    releasectl) printf '%s\n' "$CONTROLLED_BUNDLE_ROOT/bin/releasectl" ;;
    *) printf '%s\n' "$CONTROLLED_BUNDLE_ROOT/$rel" ;;
  esac
}

verify_controlled_repo_state() {
  if [[ ! -d "$CONTROLLED_REPO/.git" ]]; then
    echo "CONTROL-STATE missing path=$CONTROLLED_REPO"
    return 1
  fi

  local head upstream upstream_head
  head="$(git -C "$CONTROLLED_REPO" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$head" ]]; then
    echo "CONTROL-STATE unreadable path=$CONTROLLED_REPO"
    return 1
  fi

  upstream="$(git -C "$CONTROLLED_REPO" rev-parse --abbrev-ref "@{upstream}" 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    echo "CONTROL-STATE no-upstream path=$CONTROLLED_REPO head=$head"
    return 1
  fi

  upstream_head="$(git -C "$CONTROLLED_REPO" rev-parse "$upstream" 2>/dev/null || true)"
  if [[ -z "$upstream_head" ]]; then
    echo "CONTROL-STATE unreadable-upstream path=$CONTROLLED_REPO upstream=$upstream"
    return 1
  fi

  if [[ "$head" != "$upstream_head" ]]; then
    echo "CONTROL-STATE stale path=$CONTROLLED_REPO head=$head upstream=$upstream upstream_head=$upstream_head"
    return 1
  fi

  echo "CONTROL-STATE ok path=$CONTROLLED_REPO head=$head upstream=$upstream"
  return 0
}

INTERNAL_SCRIPTS=()
while IFS= read -r rel; do
  INTERNAL_SCRIPTS+=("$rel")
done < <(find "$SRC_ROOT/internal" -maxdepth 1 -type f -name '*.sh' -print | sed "s#^$SRC_ROOT/##" | sort)

FILES=("releasectl" "internal/fleet.env")
for rel in "${INTERNAL_SCRIPTS[@]}"; do
  FILES+=("$rel")
done

verify_source_controlled_alignment() {
  local status=0
  local ok_count=0
  local diff_count=0
  local missing_count=0
  local unreadable_count=0

  for rel in "${FILES[@]}"; do
    local src ctl src_hash ctl_hash
    src="$SRC_ROOT/$rel"
    ctl="$(controlled_path_for_rel "$rel")"

    if [[ ! -f "$src" ]]; then
      echo "CONTROL-SOURCE-MISSING $rel"
      missing_count=$((missing_count + 1))
      status=1
      continue
    fi

    src_hash="$(sha256_of "$src")"

    if [[ ! -e "$ctl" ]]; then
      echo "CONTROL-MISSING $rel expected=$ctl src_sha=$src_hash"
      missing_count=$((missing_count + 1))
      status=1
      continue
    fi

    if [[ ! -r "$ctl" ]]; then
      echo "CONTROL-UNREADABLE $rel path=$ctl src_sha=$src_hash"
      unreadable_count=$((unreadable_count + 1))
      status=1
      continue
    fi

    if cmp -s "$src" "$ctl"; then
      echo "CONTROL-OK $rel sha=$src_hash"
      ok_count=$((ok_count + 1))
    else
      ctl_hash="$(sha256_of "$ctl")"
      echo "CONTROL-DIFF $rel src_sha=$src_hash controlled_sha=$ctl_hash path=$ctl"
      diff_count=$((diff_count + 1))
      status=1
    fi
  done

  echo "CONTROL-SUMMARY ok=$ok_count diff=$diff_count missing=$missing_count unreadable=$unreadable_count"
  return "$status"
}

mode_for() {
  case "$1" in
    *.sh|releasectl) echo 0755 ;;
    *) echo 0644 ;;
  esac
}

verify_bundle() {
  local status=0
  local ok_count=0
  local diff_count=0
  local missing_count=0

  for rel in "${FILES[@]}"; do
    local src dst src_hash dst_hash
    src="$SRC_ROOT/$rel"
    dst="$DST_ROOT/$rel"

    if [[ ! -f "$src" ]]; then
      echo "SOURCE-MISSING $rel"
      missing_count=$((missing_count + 1))
      status=1
      continue
    fi

    src_hash="$(sha256_of "$src")"

    if [[ ! -e "$dst" ]]; then
      echo "MISSING  $rel src_sha=$src_hash"
      missing_count=$((missing_count + 1))
      status=1
      continue
    fi

    if cmp -s "$src" "$dst"; then
      echo "OK       $rel sha=$src_hash"
      ok_count=$((ok_count + 1))
    else
      dst_hash="$(sha256_of "$dst")"
      echo "DIFF     $rel src_sha=$src_hash dst_sha=$dst_hash"
      diff_count=$((diff_count + 1))
      status=1
    fi
  done

  echo "SUMMARY  ok=$ok_count diff=$diff_count missing=$missing_count"
  return "$status"
}

if [[ "$ENFORCE_CONTROLLED_PARITY" == "1" ]]; then
  if ! verify_controlled_repo_state || ! verify_source_controlled_alignment; then
    echo
    echo "❌ Controlled import path is not converged (stale, unreadable, divergent, or incomplete)."
    echo "   Merge source-of-truth changes, import them into controlled repo main, then rerun releasectl bundle-sync."
    exit 1
  fi
fi

if [[ "$MODE" == "sync" ]]; then
  for rel in "${FILES[@]}"; do
    src="$SRC_ROOT/$rel"
    dst="$DST_ROOT/$rel"

    [[ -f "$src" ]] || continue

    if [[ ! -e "$dst" ]] || ! cmp -s "$src" "$dst"; then
      install -d "$(dirname "$dst")"
      install -m "$(mode_for "$rel")" "$src" "$dst"
      echo "SYNCED   $rel"
    fi
  done
fi

echo "CONTROL   source_root=$SRC_ROOT controlled_bundle_root=$CONTROLLED_BUNDLE_ROOT install_root=$DST_ROOT mode=$MODE"
controlled_repo_status

if ! verify_bundle; then
  echo
  if [[ "$MODE" == "sync" ]]; then
    echo "❌ Residual drift remains after sync. Break-glass manual copy is NOT approved; repair source/control path first."
  else
    echo "Bundle drift detected. Run the Mini-approved sync path to reconcile the installed governed bundle."
  fi
  exit 1
fi

echo
if [[ "$MODE" == "sync" ]]; then
  "$DST_ROOT/releasectl" verify-config || true
  echo "✅ Installed governed bundle sync complete (no residual drift)"
else
  echo "Installed governed bundle matches source of truth."
fi
