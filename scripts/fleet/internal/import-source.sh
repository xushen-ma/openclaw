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

# Resolve source ref to SHA
SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse "$SOURCE_REF" 2>/dev/null || true)"
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
CONTROLLED_STATUS="$(git -C "$CONTROLLED_REPO" status --porcelain 2>/dev/null || true)"
if [[ -n "$CONTROLLED_STATUS" ]]; then
  echo "error: controlled repo has uncommitted changes" >&2
  echo "$CONTROLLED_STATUS" >&2
  exit 1
fi

# Fetch and fast-forward controlled repo
echo "FETCH controlled remote=$CONTROLLED_REMOTE branch=$CONTROLLED_BRANCH"
git -C "$CONTROLLED_REPO" fetch "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"

CONTROLLED_HEAD="$(git -C "$CONTROLLED_REPO" rev-parse HEAD)"
CONTROLLED_UPSTREAM="$(git -C "$CONTROLLED_REPO" rev-parse "$CONTROLLED_REMOTE/$CONTROLLED_BRANCH")"

if [[ "$CONTROLLED_HEAD" != "$CONTROLLED_UPSTREAM" ]]; then
  echo "FF-ONLY controlled head=$CONTROLLED_HEAD upstream=$CONTROLLED_UPSTREAM"
  git -C "$CONTROLLED_REPO" merge --ff-only "$CONTROLLED_REMOTE/$CONTROLLED_BRANCH"
  echo "FAST-FORWARDED to $(git -C "$CONTROLLED_REPO" rev-parse HEAD)"
fi

# Create temporary export directory
EXPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$EXPORT_DIR"' EXIT

# Export source subtree at specified ref
echo "EXPORT source=$SOURCE_REPO/$SOURCE_BUNDLE_PATH@$SOURCE_SHA"
git -C "$SOURCE_REPO" archive --format=tar "$SOURCE_SHA" "$SOURCE_BUNDLE_PATH" \
  | tar -x -C "$EXPORT_DIR"

# Map source bundle structure to controlled repo structure
# Source: scripts/fleet/{releasectl,internal/*.sh,internal/fleet.env}
# Controlled: {bin/releasectl,internal/*.sh,internal/fleet.env}

IMPORT_MANIFEST=()

# In dry-run mode, create a temporary controlled copy to avoid modifying the real one
if [[ "$DRY_RUN" -eq 1 ]]; then
  DRY_RUN_CONTROLLED="$(mktemp -d)"
  trap 'rm -rf "$EXPORT_DIR" "$DRY_RUN_CONTROLLED"' EXIT
  
  # Copy .git directory for git operations
  cp -R "$CONTROLLED_REPO/.git" "$DRY_RUN_CONTROLLED/"
  # Copy existing content
  if [[ -d "$CONTROLLED_REPO/bin" ]]; then
    cp -R "$CONTROLLED_REPO/bin" "$DRY_RUN_CONTROLLED/"
  fi
  if [[ -d "$CONTROLLED_REPO/internal" ]]; then
    cp -R "$CONTROLLED_REPO/internal" "$DRY_RUN_CONTROLLED/"
  fi
  
  WORK_CONTROLLED="$DRY_RUN_CONTROLLED"
else
  WORK_CONTROLLED="$CONTROLLED_REPO"
fi

# Copy releasectl to bin/
if [[ -f "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/releasectl" ]]; then
  mkdir -p "$WORK_CONTROLLED/bin"
  cp "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/releasectl" "$WORK_CONTROLLED/bin/releasectl"
  chmod 0755 "$WORK_CONTROLLED/bin/releasectl"
  IMPORT_MANIFEST+=("bin/releasectl")
fi

# Copy internal/ directory
if [[ -d "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/internal" ]]; then
  mkdir -p "$WORK_CONTROLLED/internal"
  
  for src in "$EXPORT_DIR/$SOURCE_BUNDLE_PATH/internal"/*; do
    [[ -e "$src" ]] || continue
    
    basename_file="$(basename "$src")"
    dest="$WORK_CONTROLLED/internal/$basename_file"
    
    cp "$src" "$dest"
    
    if [[ "$basename_file" == *.sh ]]; then
      chmod 0755 "$dest"
    else
      chmod 0644 "$dest"
    fi
    
    IMPORT_MANIFEST+=("internal/$basename_file")
  done
fi

# Stage changes
cd "$WORK_CONTROLLED"
for rel_path in "${IMPORT_MANIFEST[@]}"; do
  git add "$rel_path"
done

# Check for changes
if git diff --cached --quiet; then
  echo "NO-CHANGES source and controlled already in sync"
  exit 0
fi

# Show diff summary
echo
echo "IMPORT-DIFF:"
git diff --cached --stat
echo

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
  git diff --cached
  echo
  echo "DRY-RUN complete (no commit or push)"
  exit 0
fi

# Switch back to real controlled repo for actual commit
cd "$CONTROLLED_REPO"

# Commit changes
git commit -m "$COMMIT_MSG"
IMPORT_COMMIT="$(git rev-parse HEAD)"
echo "COMMITTED sha=$IMPORT_COMMIT"

# Push to remote
echo "PUSH remote=$CONTROLLED_REMOTE branch=$CONTROLLED_BRANCH"
git push "$CONTROLLED_REMOTE" "$CONTROLLED_BRANCH"
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
  
  if [[ ! -f "$ctl_path" ]]; then
    echo "VERIFY-MISSING-CONTROLLED $rel_path"
    VERIFY_STATUS=1
    VERIFY_DIFF=$((VERIFY_DIFF + 1))
    continue
  fi
  
  if cmp -s "$src_path" "$ctl_path"; then
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
