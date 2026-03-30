#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASECTL="$(cd "$SCRIPT_DIR/../.." && pwd)/releasectl"

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cat > "$tmpdir/installed-releasectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "INSTALLED $*"
EOF
chmod +x "$tmpdir/installed-releasectl"

cat > "$tmpdir/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${SUDO_TEST_LOG:?missing SUDO_TEST_LOG}"
: "${SUDO_TEST_PASSWORD:?missing SUDO_TEST_PASSWORD}"

echo "$*" >> "$SUDO_TEST_LOG"

non_interactive=0
stdin_mode=0
args=("$@")
idx=0
while [[ $idx -lt ${#args[@]} ]]; do
  arg="${args[$idx]}"
  case "$arg" in
    -n)
      non_interactive=1
      idx=$((idx + 1))
      ;;
    -S)
      stdin_mode=1
      idx=$((idx + 1))
      ;;
    -p)
      idx=$((idx + 2))
      ;;
    -u)
      idx=$((idx + 2))
      ;;
    *)
      break
      ;;
  esac
done

if [[ $non_interactive -eq 1 ]]; then
  echo "sudo: a password is required" >&2
  exit 1
fi

if [[ $stdin_mode -eq 1 ]]; then
  IFS= read -r pw
  [[ "$pw" == "$SUDO_TEST_PASSWORD" ]] || {
    echo "sudo: incorrect password" >&2
    exit 1
  }
fi

cmd=("${args[@]:$idx}")
"${cmd[@]}"
EOF
chmod +x "$tmpdir/sudo"

log_file="$tmpdir/sudo.log"
out="$({
  PATH="$tmpdir:$PATH" \
  SUDO_TEST_LOG="$log_file" \
  SUDO_TEST_PASSWORD="test-secret" \
  RELEASECTL_CONFIG=/dev/null \
  RELEASECTL_ALLOW_SUDO=1 \
  RELEASECTL_EXEC_PATH="$tmpdir/installed-releasectl" \
  RELEASECTL_SUDO_PASSWORD="test-secret" \
  bash "$RELEASECTL" bundle-sync --check
} 2>&1)" || fail "expected fallback handoff to succeed with configured sudo password"

[[ "$out" == *"INSTALLED bundle-sync --check"* ]] || fail "expected installed front door to receive forwarded action"

line_count="$(wc -l < "$log_file" | tr -d ' ')"
[[ "$line_count" == "2" ]] || fail "expected exactly two sudo calls (non-interactive probe + password fallback), got $line_count"

grep -q -- "-n -u oc-release" "$log_file" || fail "expected non-interactive sudo handoff attempt"
grep -q -- "-S -p  -u oc-release" "$log_file" || fail "expected password sudo fallback invocation"

pass "governed handoff falls back to internal passworded sudo when NOPASSWD sudo is unavailable"
