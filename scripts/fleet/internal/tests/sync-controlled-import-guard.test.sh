#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/sync-installed-bundle.sh"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

create_source_bundle() {
  local dir="$1"
  mkdir -p "$dir/internal"
  cat > "$dir/releasectl" <<'EOF'
#!/usr/bin/env bash
echo "test releasectl"
EOF
chmod +x "$dir/releasectl"
cat > "$dir/internal/fleet.env" <<'EOF'
TEST_VAR=1
EOF
cat > "$dir/internal/deploy.sh" <<'EOF'
#!/usr/bin/env bash
echo "deploy"
EOF
chmod +x "$dir/internal/deploy.sh"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

remote="$tmpdir/controlled-remote.git"
controlled="$tmpdir/controlled"
dst_root="$tmpdir/installed"
source_root="$tmpdir/source"
create_source_bundle "$source_root"

git init --bare "$remote" >/dev/null
git clone "$remote" "$controlled" >/dev/null
(
  cd "$controlled"
  git checkout -b main >/dev/null
  git config user.email "test@example.com"
  git config user.name "test"
  mkdir -p bin internal
  cp "$source_root/releasectl" "bin/releasectl"
  for src in "$source_root/internal/"*; do
    [[ -e "$src" ]] || continue
    cp "$src" "internal/$(basename "$src")"
  done
  git add bin/releasectl internal
  git commit -m "seed controlled bundle" >/dev/null
  git push -u origin main >/dev/null
)

printf '\n# drift\n' >> "$controlled/internal/deploy.sh"

set +e
out="$(
  FLEET_AGENT=Mini \
  RELEASECTL_SOURCE_ROOT="$source_root" \
  RELEASECTL_INSTALL_ROOT="$dst_root" \
  RELEASECTL_CONTROLLED_REPO="$controlled" \
  bash "$SYNC_SCRIPT" --check
) 2>&1"
rc=$?
set -e
if [[ "$rc" -eq 0 ]]; then
  fail "expected check to fail when controlled content diverges from source"
fi

[[ "$out" == *"CONTROL-DIFF internal/deploy.sh"* ]] || fail "expected explicit controlled diff report"
[[ "$out" == *"Controlled import path is not converged"* ]] || fail "expected fail-closed controlled-import message"

pass "bundle-sync fails closed when source->controlled import content diverges"
