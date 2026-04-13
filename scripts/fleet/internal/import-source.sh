#!/usr/bin/env bash
# import-source.sh — Import source-of-truth fleet scripts into controlled repo
# Usage:
#   import-source.sh <source-ref> [--dry-run]
#
# Purpose:
#   First-class governed command for source → controlled publish/import path.
#   Replaces ad-hoc operator-side copy scripts as the normal lane.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"

RELEASE_USER="${RELEASE_USER:-oc-release}"
RELEASECTL_ALLOW_SUDO="${RELEASECTL_ALLOW_SUDO:-1}"
RELEASECTL_SUDO_PASSWORD="${RELEASECTL_SUDO_PASSWORD:-}"
RELEASECTL_SUDO_PASSWORD_FILE="${RELEASECTL_SUDO_PASSWORD_FILE:-$HOME/.openclaw/releasectl/sudo-password}"

resolve_user_home() {
  local user="$1"
  local home=""
  home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
  if [[ -z "$home" ]]; then
    home="$(python3 - "$user" <<'PY'
import pwd, sys
try:
  print(pwd.getpwnam(sys.argv[1]).pw_dir)
except KeyError:
  pass
PY
)"
  fi
  printf '%s\n' "$home"
}

resolve_sudo_password() {
  if [[ -n "$RELEASECTL_SUDO_PASSWORD" ]]; then
    printf '%s' "$RELEASECTL_SUDO_PASSWORD"
    return 0
  fi
  if [[ -f "$RELEASECTL_SUDO_PASSWORD_FILE" ]]; then
    head -n 1 "$RELEASECTL_SUDO_PASSWORD_FILE"
    return 0
  fi
  return 1
}

run_controlled() {
  if [[ $# -eq 0 ]]; then
    echo "error: missing controlled command" >&2
    exit 1
  fi

  local current_user
  current_user="$(id -un 2>/dev/null || true)"
  if [[ "$current_user" == "$RELEASE_USER" ]]; then
    "$@"
    return $?
  fi

  [[ "$RELEASECTL_ALLOW_SUDO" == "1" ]] || {
    echo "error: controlled repo operations require $RELEASE_USER (sudo handoff disabled)" >&2
    exit 1
  }

  local release_home
  release_home="$(resolve_user_home "$RELEASE_USER")"
  [[ -n "$release_home" ]] || {
    echo "error: unable to resolve home for governed user $RELEASE_USER" >&2
    exit 1
  }

  local err_file
  err_file="$(mktemp)"
  if sudo -n -u "$RELEASE_USER" env HOME="$release_home" XDG_CONFIG_HOME="$release_home/.config" XDG_CACHE_HOME="$release_home/.cache" "$@" 2>"$err_file"; then
    rm -f "$err_file"
    return 0
  fi

  local rc="$?"
  local sudo_err
  sudo_err="$(cat "$err_file")"
  rm -f "$err_file"

  if [[ "$sudo_err" != *"a password is required"* ]] \
     && [[ "$sudo_err" != *"no tty present"* ]] \
     && [[ "$sudo_err" != *"a terminal is required"* ]]; then
    [[ -n "$sudo_err" ]] && echo "$sudo_err" >&2
    return "$rc"
  fi

  local sudo_pw
  sudo_pw="$(resolve_sudo_password 2>/dev/null || true)"
  if [[ -z "$sudo_pw" ]]; then
    echo "error: governed handoff requires sudo access to $RELEASE_USER" >&2
    exit 1
  fi

  printf '%s\n' "$sudo_pw" | sudo -S -p '' -u "$RELEASE_USER" env HOME="$release_home" XDG_CONFIG_HOME="$release_home/.config" XDG_CACHE_HOME="$release_home/.cache" "$@"
}

controlled_git() {
  run_controlled git -C "$CONTROLLED_REPO" "$@"
}

SOURCE_REF="${1:-}"
DRY_RUN=0

if [[ -z "$SOURCE_REF" ]]; then
  echo "error: missing required argument: source ref" >&2
  echo "usage: import-source.sh <ref> [--dry-run]" >&2
  exit 2
fi

shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "error: unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

# Controlled repo paths
CONTROLLED_REPO="${RELEASECTL_CONTROLLED_REPO:-/Users/openclaw/workspace/openclaw-fleet-mgmt}"
CONTROLLED_REMOTE="${RELEASECTL_CONTROLLED_REMOTE:-origin}"
CONTROLLED_BRANCH="${RELEASECTL_CONTROLLED_BRANCH:-main}"

# Source repo paths
SOURCE_REPO="${RELEASECTL_SOURCE_REPO:-/Users/openclaw/workspace/openclaw}"
SOURCE_BUNDLE_PATH="scripts/fleet"

# Verify source repo exists and is clean
if [[ ! -d "$SOURCE_REPO/.git" ]]; then
  echo "error: source repo not found: $SOURCE_REPO" >&2
  exit 1
fi

echo "SOURCE-REPO path=$SOURCE_REPO"

# Check source working tree status
SOURCE_STATUS="$(git -C "$SOURCE_REPO" status --porcelain "$SOURCE_BUNDLE_PATH" 2>/dev/null || true)"
if [[ -n "$SOURCE_STATUS" ]]; then
  echo "error: source working tree has uncommitted changes in $SOURCE_BUNDLE_PATH" >&2
  echo "$SOURCE_STATUS" >&2
  exit 1
fi

# Resolve source ref to SHA. For remote refs like origin/main, fetch first so the
# governed runtime does not depend on a pre-populated local remote-tracking ref.
SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse "$SOURCE_REF" 2>/dev/null || true)"
if [[ -z "$SOURCE_SHA" ]]; then
  git -C "$SOURCE_REPO" fetch origin main --quiet 2>/dev/null || true
  SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse "$SOURCE_REF" 2>/dev/null || true)"
fi
if [[ -z "$SOURCE_SHA" ]]; then
  echo "error: unable to resolve source ref: $SOURCE_REF" >&2
  exit 1
fi

# Verify source ref exists
if ! git -C "$SOURCE_REPO" cat-file -e "$SOURCE_SHA^{commit}" 2>/dev/null; then
  echo "error: source ref is not a valid commit: $SOURCE_REF" >&2
  exit 1
fi

SOURCE_REF_NAME="$(git -C "$SOURCE_REPO" rev-parse --abbrev-ref "$SOURCE_REF" 2>/dev/null || echo "$SOURCE_REF")"
echo "SOURCE-REF ref=$SOURCE_REF_NAME sha=$SOURCE_SHA"

# Verify controlled repo exists
if [[ ! -d "$CONTROLLED_REPO/.git" ]]; then
  echo "error: controlled repo not found: $CONTROLLED_REPO" >&2
  exit 1
fi

echo "CONTROLLED-REPO path=$CONTROLLED_REPO"

# Check controlled working tree status
CONTROLLED_STATUS="$(controlled_git status --porcelain 2>/dev/null || true)"
if [[ -n "$CONTROLLED_STATUS" ]]; then
  echo "error: controlled repo has uncommitted changes" >&2
  echo "$CONTROLLED_STATUS" >&2
  exit 1
fi

# Fetch and fast-forward controlled repo
echo "FETCH controlled remote=$CONTROLLED_REMOTE branch=$CONTROLLED_BRANCH"
controlled_git fetch "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"

CONTROLLED_HEAD="$(controlled_git rev-parse HEAD)"
CONTROLLED_UPSTREAM="$(controlled_git rev-parse "$CONTROLLED_REMOTE/$CONTROLLED_BRANCH")"

if [[ "$CONTROLLED_HEAD" != "$CONTROLLED_UPSTREAM" ]]; then
  echo "FF-ONLY controlled head=$CONTROLLED_HEAD upstream=$CONTROLLED_UPSTREAM"
  controlled_git merge --ff-only "$CONTROLLED_REMOTE/$CONTROLLED_BRANCH"
  echo "FAST-FORWARDED to $(controlled_git rev-parse HEAD)"
fi

# Create temporary export directory
EXPORT_DIR="$(mktemp -d /tmp/releasectl-import.XXXXXX)"
chmod 755 "$EXPORT_DIR"
trap 'rm -rf "$EXPORT_DIR"' EXIT

# Export source subtree at specified ref
echo "EXPORT source=$SOURCE_REPO/$SOURCE_BUNDLE_PATH@$SOURCE_SHA"
git -C "$SOURCE_REPO" archive --format=tar "$SOURCE_SHA" "$SOURCE_BUNDLE_PATH" \
  | tar -x -C "$EXPORT_DIR"
chmod -R a+rX "$EXPORT_DIR"

# Map source bundle structure to controlled repo structure
# Source: scripts/fleet/{releasectl,internal/*.sh,internal/fleet.env}
# Controlled: {bin/releasectl,internal/*.sh,internal/fleet.env}

IMPORT_MANIFEST=()

# In dry-run mode, create a temporary controlled copy to avoid modifying the real one
if [[ "$DRY_RUN" -eq 1 ]]; then
  DRY_RUN_CONTROLLED="$(mktemp -d /tmp/releasectl-controlled.XXXXXX)"
  chmod 0777 "$DRY_RUN_CONTROLLED"
  trap 'rm -rf "$EXPORT_DIR" "$DRY_RUN_CONTROLLED"' EXIT
  
  run_controlled cp -R "$CONTROLLED_REPO/.git" "$DRY_RUN_CONTROLLED/"
  if run_controlled test -d "$CONTROLLED_REPO/bin"; then
    run_controlled cp -R "$CONTROLLED_REPO/bin" "$DRY_RUN_CONTROLLED/"
  fi
  if run_controlled test -d "$CONTROLLED_REPO/internal"; then
    run_controlled cp -R "$CONTROLLED_REPO/internal" "$DRY_RUN_CONTROLLED/"
  fi
  
  WORK_CONTROLLED="$DRY_RUN_CONTROLLED"
else
  WORK_CONTROLLED="$CONTROLLED_REPO"
fi

# Copy releasectl to bin/
if [[ -f "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/releasectl" ]]; then
  run_controlled mkdir -p "$WORK_CONTROLLED/bin"
  run_controlled cp "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/releasectl" "$WORK_CONTROLLED/bin/releasectl"
  run_controlled chmod 0755 "$WORK_CONTROLLED/bin/releasectl"
  IMPORT_MANIFEST+=("bin/releasectl")
fi

# Copy internal/ directory
if [[ -d "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/internal" ]]; then
  run_controlled mkdir -p "$WORK_CONTROLLED/internal"
  
  for src in "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/internal"/*; do
    [[ -e "$src" ]] || continue
    
    basename_file="$(basename "$src")"
    dest="$WORK_CONTROLLED/internal/$basename_file"
    
    run_controlled rm -rf "$dest"
    if [[ -d "$src" ]]; then
      run_controlled cp -R "$src" "$dest"
      run_controlled find "$dest" -type d -exec chmod 0755 {} +
      run_controlled find "$dest" -type f -exec chmod 0644 {} +
      run_controlled find "$dest" -type f -name '*.sh' -exec chmod 0755 {} +
    else
      run_controlled cp "$src" "$dest"
      if [[ "$basename_file" == *.sh ]]; then
        run_controlled chmod 0755 "$dest"
      else
        run_controlled chmod 0644 "$dest"
      fi
    fi
    
    IMPORT_MANIFEST+=("internal/$basename_file")
  done
fi

# Stage changes
for rel_path in "${IMPORT_MANIFEST[@]}"; do
  if [[ "$WORK_CONTROLLED" == "$CONTROLLED_REPO" ]]; then
    controlled_git add "$rel_path"
  else
    git -C "$WORK_CONTROLLED" add "$rel_path"
  fi
done

# Check for changes
if [[ "$WORK_CONTROLLED" == "$CONTROLLED_REPO" ]]; then
  if controlled_git diff --cached --quiet; then
    echo "NO-CHANGES source and controlled already in sync"
    exit 0
  fi
  echo
  echo "IMPORT-DIFF:"
  controlled_git diff --cached --stat
  echo
else
  if git -C "$WORK_CONTROLLED" diff --cached --quiet; then
    echo "NO-CHANGES source and controlled already in sync"
    exit 0
  fi
  echo
  echo "IMPORT-DIFF:"
  git -C "$WORK_CONTROLLED" diff --cached --stat
  echo
fi

# Build commit message with provenance
COMMIT_MSG="Import fleet scripts from source

Source: $SOURCE_REPO
Source-Ref: $SOURCE_REF_NAME
Source-SHA: $SOURCE_SHA
Imported-By: $(id -un)
Imported-At: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY-RUN commit message:"
  echo "$COMMIT_MSG"
  echo
  git -C "$WORK_CONTROLLED" diff --cached
  echo
  echo "DRY-RUN complete (no commit or push)"
  exit 0
fi

# Commit changes
controlled_git commit -m "$COMMIT_MSG"
IMPORT_COMMIT="$(controlled_git rev-parse HEAD)"
echo "COMMITTED sha=$IMPORT_COMMIT"

# Push to remote
echo "PUSH remote=$CONTROLLED_REMOTE branch=$CONTROLLED_BRANCH"
controlled_git push "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"
echo "PUSHED"

# Verify post-import parity
echo
echo "VERIFY post-import parity"

VERIFY_STATUS=0
VERIFY_OK=0
VERIFY_DIFF=0

for rel_path in "${IMPORT_MANIFEST[@]}"; do
  # Map back to source path
  case "$rel_path" in
    bin/releasectl)
      src_path="$SOURCE_REPO/$SOURCE_BUNDLE_PATH/releasectl"
      ;;
    internal/*)
      basename_file="$(basename "$rel_path")"
      src_path="$SOURCE_REPO/$SOURCE_BUNDLE_PATH/internal/$basename_file"
      ;;
    *)
      echo "VERIFY-ERROR unknown mapping: $rel_path" >&2
      VERIFY_STATUS=1
      continue
      ;;
  esac
  
  ctl_path="$CONTROLLED_REPO/$rel_path"
  
  if [[ ! -f "$src_path" ]]; then
    echo "VERIFY-MISSING-SOURCE $rel_path"
    VERIFY_STATUS=1
    VERIFY_DIFF=$((VERIFY_DIFF + 1))
    continue
  fi
  
  if ! run_controlled test -f "$ctl_path"; then
    echo "VERIFY-MISSING-CONTROLLED $rel_path"
    VERIFY_STATUS=1
    VERIFY_DIFF=$((VERIFY_DIFF + 1))
    continue
  fi
  
  if run_controlled cmp -s "$src_path" "$ctl_path"; then
    src_sha="$(shasum -a 256 "$src_path" | awk '{print $1}')"
    echo "VERIFY-OK $rel_path sha=$src_sha"
    VERIFY_OK=$((VERIFY_OK + 1))
  else
    src_sha="$(shasum -a 256 "$src_path" | awk '{print $1}')"
    ctl_sha="$(shasum -a 256 "$ctl_path" | awk '{print $1}')"
    echo "VERIFY-DIFF $rel_path src_sha=$src_sha ctl_sha=$ctl_sha"
    VERIFY_STATUS=1
    VERIFY_DIFF=$((VERIFY_DIFF + 1))
  fi
done

echo "VERIFY-SUMMARY ok=$VERIFY_OK diff=$VERIFY_DIFF"

if [[ "$VERIFY_STATUS" -ne 0 ]]; then
  echo
  echo "❌ Post-import verification failed: residual diff detected"
  exit 1
fi

echo
echo "✅ Source import complete: $SOURCE_SHA → controlled@$IMPORT_COMMIT"
echo "   Next: releasectl bundle-sync --check (should show clean CONTROL-STATE)"
