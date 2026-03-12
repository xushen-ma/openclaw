#!/usr/bin/env bash
set -euo pipefail

# Permission policy for governed release repos:
# - Directories: 0755
# - Regular files: 0644
# - Executable files tracked by git: 0755
#
# This keeps oc-release as the writer while ensuring normal users retain
# read/execute access needed for git/status/tooling operations.

normalize_repo_permissions() {
  local repo_root="$1"
  local mode="${2:-apply}" # apply|dry-run

  if [[ ! -d "$repo_root/.git" ]]; then
    echo "error: not a git repository: $repo_root" >&2
    return 1
  fi

  local chmod_bin="chmod"
  if command -v gchmod >/dev/null 2>&1; then
    chmod_bin="gchmod"
  fi

  local -a dir_targets=()
  local -a file_targets=()
  local -a exec_targets=()

  while IFS= read -r -d '' p; do
    dir_targets+=("$p")
  done < <(find "$repo_root" -xdev -type d \
    ! -path '*/.git/*' \
    ! -path "$repo_root/.git" \
    -print0)

  while IFS= read -r -d '' p; do
    file_targets+=("$p")
  done < <(find "$repo_root" -xdev -type f \
    ! -path '*/.git/*' \
    -print0)

  while IFS= read -r rec; do
    [[ -n "$rec" ]] || continue
    # format: <mode> <type> <object>\t<path>
    local entry_path
    entry_path="${rec#*$'\t'}"
    [[ -n "$entry_path" ]] || continue
    exec_targets+=("$repo_root/$entry_path")
  done < <(git -C "$repo_root" ls-files --stage | awk '$1 ~ /^100755$/')

  if [[ "$mode" == "dry-run" ]]; then
    echo "[dry-run] normalize dirs to 0755: ${#dir_targets[@]}"
    echo "[dry-run] normalize files to 0644: ${#file_targets[@]}"
    echo "[dry-run] normalize git executables to 0755: ${#exec_targets[@]}"
    return 0
  fi

  if ((${#dir_targets[@]} > 0)); then
    "$chmod_bin" 755 "${dir_targets[@]}"
  fi

  if ((${#file_targets[@]} > 0)); then
    "$chmod_bin" 644 "${file_targets[@]}"
  fi

  if ((${#exec_targets[@]} > 0)); then
    "$chmod_bin" 755 "${exec_targets[@]}"
  fi

  echo "normalized permissions in $repo_root"
}
