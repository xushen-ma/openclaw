#!/usr/bin/env bash
# permissions.sh — shared permission utility primitives for governed scripts

set -euo pipefail

file_mode() {
  stat -f '%Lp' "$1"
}

directory_mode() {
  stat -f '%Lp' "$1"
}

ensure_mode() {
  local target="$1"
  local mode="$2"

  [[ -e "$target" ]] || return 0
  local current
  current="$(file_mode "$target")"
  if [[ "$current" != "$mode" ]]; then
    chmod "$mode" "$target"
  fi
}

ensure_ownership() {
  local target="$1"
  local owner_group="$2"

  [[ -e "$target" ]] || return 0
  chown "$owner_group" "$target"
}
