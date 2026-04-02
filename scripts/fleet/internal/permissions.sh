#!/usr/bin/env bash

set -euo pipefail

RELEASECTL_DIR_MODE="755"
RELEASECTL_FILE_MODE="644"

repair_permissions() {
  local target
  local -a sorted_targets=()
  if [[ $# -lt 1 ]]; then
    echo "repair-perms requires at least one path" >&2
    return 1
  fi

  while IFS= read -r target; do
    sorted_targets+=("$target")
  done < <(printf '%s\n' "$@" | LC_ALL=C sort -u)

  for target in "${sorted_targets[@]}"; do
    if [[ -L "$target" ]]; then
      echo "Unsupported symlink path: $target" >&2
      return 1
    fi

    if [[ -f "$target" ]]; then
      chmod "$RELEASECTL_FILE_MODE" "$target"
      continue
    fi

    if [[ -d "$target" ]]; then
      normalize_permissions_in_dir "$target"
      continue
    fi

    echo "Unsupported path: $target" >&2
    return 1
  done
}

normalize_permissions_in_dir() {
  local root="$1"
  local -a dirs=()
  local -a files=()

  while IFS= read -r path; do
    dirs+=("$path")
  done < <(LC_ALL=C find "$root" -type d -print | sort)

  while IFS= read -r path; do
    files+=("$path")
  done < <(LC_ALL=C find "$root" -type f -print | sort)

  local path
  for path in "${dirs[@]}"; do
    chmod "$RELEASECTL_DIR_MODE" "$path"
  done

  for path in "${files[@]}"; do
    chmod "$RELEASECTL_FILE_MODE" "$path"
  done
}
