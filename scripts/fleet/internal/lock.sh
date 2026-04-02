#!/usr/bin/env bash
# lock.sh — shared lock helpers for governed scripts

set -euo pipefail

: "${FLEET_LOCK_DIR:=${TMPDIR:-/tmp}/openclaw-fleet-locks}"

_lock_owner_file() {
  local lock_file="$1"
  printf '%s.owner' "$lock_file"
}

lock_acquire() {
  local lock_file="$1"
  local owner="${2:-unknown}"

  mkdir -p "$FLEET_LOCK_DIR"
  exec 9>"$lock_file"

  if ! flock -n 9; then
    local owner_file
    owner_file="$(_lock_owner_file "$lock_file")"
    local current_owner="unknown"
    if [[ -f "$owner_file" ]]; then
      current_owner="$(cat "$owner_file" 2>/dev/null || echo unknown)"
    fi
    echo "lock busy: $lock_file owner=$current_owner" >&2
    return 1
  fi

  printf '%s\n' "$owner" >"$(_lock_owner_file "$lock_file")"
}

lock_release() {
  local lock_file="$1"
  rm -f "$(_lock_owner_file "$lock_file")"
  flock -u 9 || true
}
