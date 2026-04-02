#!/usr/bin/env bash

set -euo pipefail

RELEASECTL_SECRET_MODE="600"

sanity_check_secrets() {
  local target
  local -a sorted_targets=()
  if [[ $# -lt 1 ]]; then
    echo "sanity-check requires at least one path" >&2
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
      chmod "$RELEASECTL_SECRET_MODE" "$target"
      continue
    fi

    if [[ -d "$target" ]]; then
      local -a files=()
      local secret_file

      while IFS= read -r secret_file; do
        files+=("$secret_file")
      done < <(LC_ALL=C find "$target" -type f -print | sort)

      for secret_file in "${files[@]}"; do
        chmod "$RELEASECTL_SECRET_MODE" "$secret_file"
      done
      continue
    fi

    echo "Unsupported path: $target" >&2
    return 1
  done
}
