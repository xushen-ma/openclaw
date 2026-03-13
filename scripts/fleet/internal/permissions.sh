#!/usr/bin/env bash
set -euo pipefail

# Permission policy for governed release repos:
# - Directories: 0755
# - Regular files: 0644 baseline
# - Git-tracked executable files: restored to 0755 from index mode
# - Runtime executable entrypoints (node_modules/.bin targets + package.json bin targets + dist shebang files): 0755
# - Extension directories remain traversable (0755) and openclaw.plugin.json manifests readable (0644)
#
# This keeps oc-release as the writer while ensuring normal users retain
# read/execute access needed for runtime and tooling operations without
# smearing executable bits across tracked source files.

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

  local dir_count=0
  while IFS= read -r -d '' _; do
    ((dir_count++))
  done < <(find "$repo_root" -xdev -type d \
    ! -path "$repo_root/.git" \
    ! -path '*/.git/*' \
    -print0)

  local file_count=0
  while IFS= read -r -d '' _; do
    ((file_count++))
  done < <(find "$repo_root" -xdev -type f \
    ! -path '*/.git/*' \
    -print0)

  local -a tracked_exec_targets=()
  while IFS= read -r rec; do
    [[ -n "$rec" ]] || continue
    local entry_path="${rec#*$'\t'}"
    local full_path="$repo_root/$entry_path"
    [[ -f "$full_path" ]] || continue
    tracked_exec_targets+=("$full_path")
  done < <(git -C "$repo_root" ls-files --stage | awk '$1 ~ /^100755$/')

  local -a runtime_exec_targets=()

  local bin_dir="$repo_root/node_modules/.bin"
  if [[ -d "$bin_dir" ]]; then
    while IFS= read -r -d '' bin_path; do
      if [[ -L "$bin_path" ]]; then
        local resolved
        resolved="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$bin_path" 2>/dev/null || true)"
        if [[ -n "$resolved" && -f "$resolved" ]]; then
          runtime_exec_targets+=("$resolved")
        fi
      elif [[ -f "$bin_path" ]]; then
        runtime_exec_targets+=("$bin_path")
      fi
    done < <(find "$bin_dir" -mindepth 1 -maxdepth 1 -print0)
  fi

  local node_modules_dir="$repo_root/node_modules"
  if [[ -d "$node_modules_dir" ]]; then
    while IFS= read -r -d '' pkg_json; do
      while IFS= read -r rel_bin; do
        [[ -n "$rel_bin" ]] || continue
        local candidate
        candidate="$(python3 -c 'import os,sys; print(os.path.realpath(os.path.join(sys.argv[1], sys.argv[2])))' "$(dirname "$pkg_json")" "$rel_bin" 2>/dev/null || true)"
        if [[ -n "$candidate" && -f "$candidate" ]]; then
          runtime_exec_targets+=("$candidate")
        fi
      done < <(python3 - "$pkg_json" <<'PY'
import json,sys
p = sys.argv[1]
try:
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
bins = data.get('bin')
if isinstance(bins, str):
    print(bins)
elif isinstance(bins, dict):
    for v in bins.values():
        if isinstance(v, str):
            print(v)
PY
)
    done < <(find "$node_modules_dir" -xdev -type f -name package.json -print0)
  fi

  local dist_dir="$repo_root/dist"
  if [[ -d "$dist_dir" ]]; then
    while IFS= read -r -d '' dist_file; do
      if head -n 1 "$dist_file" | grep -q '^#!'; then
        runtime_exec_targets+=("$dist_file")
      fi
    done < <(find "$dist_dir" -xdev -type f -print0)
  fi

  local -a extension_dir_targets=()
  local -a extension_manifest_targets=()
  local extensions_dir="$repo_root/extensions"
  if [[ -d "$extensions_dir" ]]; then
    while IFS= read -r -d '' extension_dir_path; do
      extension_dir_targets+=("$extension_dir_path")
    done < <(find "$extensions_dir" -xdev -type d -print0)

    while IFS= read -r -d '' manifest_path; do
      extension_manifest_targets+=("$manifest_path")
    done < <(find "$extensions_dir" -xdev -type f -name 'openclaw.plugin.json' -print0)
  fi

  if [[ "$mode" == "dry-run" ]]; then
    echo "[dry-run] normalize dirs to 0755: $dir_count"
    echo "[dry-run] normalize files to 0644 baseline: $file_count"
    echo "[dry-run] restore git executable files to 0755: ${#tracked_exec_targets[@]}"
    echo "[dry-run] restore runtime entrypoint files to 0755: ${#runtime_exec_targets[@]}"
    echo "[dry-run] normalize extension dirs to 0755: ${#extension_dir_targets[@]}"
    echo "[dry-run] normalize extension manifests to 0644: ${#extension_manifest_targets[@]}"
    return 0
  fi

  find "$repo_root" -xdev -type d \
    ! -path "$repo_root/.git" \
    ! -path '*/.git/*' \
    -print0 | xargs -0 "$chmod_bin" 755

  find "$repo_root" -xdev -type f \
    ! -path '*/.git/*' \
    -print0 | xargs -0 "$chmod_bin" 644

  if ((${#tracked_exec_targets[@]} > 0)); then
    "$chmod_bin" 755 "${tracked_exec_targets[@]}"
  fi

  if ((${#runtime_exec_targets[@]} > 0)); then
    "$chmod_bin" 755 "${runtime_exec_targets[@]}"
  fi

  if ((${#extension_dir_targets[@]} > 0)); then
    "$chmod_bin" 755 "${extension_dir_targets[@]}"
  fi

  if ((${#extension_manifest_targets[@]} > 0)); then
    "$chmod_bin" 644 "${extension_manifest_targets[@]}"
  fi

  echo "normalized permissions in $repo_root"
}
