#!/usr/bin/env bash
# releasectl-setup.sh — bootstrap protected release workflow
#
# This script prepares the local files/config needed for releasectl.
# It can also print the exact privileged steps needed to create the dedicated
# release user and transfer ownership of the production checkout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/internal/fleet.env"

usage() {
  cat <<'EOF'
Usage:
  releasectl-setup.sh init-config --release-user <user> [--release-repo <path>] [--auth-file <path>] [--config-file <path>]
  releasectl-setup.sh set-password [--auth-file <path>] [--password-stdin]
  releasectl-setup.sh print-privileged-steps --release-user <user> [--release-repo <path>]

Actions:
  init-config            Write releasectl config env file for the current user.
  set-password           Generate PBKDF2 auth material and write auth.env.
  print-privileged-steps Print the sudo/sysadmin steps you or Mini must run manually.
EOF
}

DEFAULT_CONFIG="${RELEASECTL_CONFIG:-$HOME/.openclaw/releasectl/config.env}"
DEFAULT_AUTH="${RELEASECTL_AUTH:-$HOME/.openclaw/releasectl/auth.env}"
DEFAULT_RELEASE_REPO="$HOME/workspace/openclaw-release"
RELEASE_USER=""
RELEASE_REPO="$DEFAULT_RELEASE_REPO"
CONFIG_FILE="$DEFAULT_CONFIG"
AUTH_FILE="$DEFAULT_AUTH"
PASSWORD_STDIN=0
ACTION="${1:-}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-user) RELEASE_USER="${2:-}"; shift 2 ;;
    --release-repo) RELEASE_REPO="${2:-}"; shift 2 ;;
    --config-file) CONFIG_FILE="${2:-}"; shift 2 ;;
    --auth-file) AUTH_FILE="${2:-}"; shift 2 ;;
    --password-stdin) PASSWORD_STDIN=1; shift ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

prompt_password() {
  local pw1 pw2
  read -r -s -p "New approval password: " pw1 >&2
  echo >&2
  read -r -s -p "Confirm approval password: " pw2 >&2
  echo >&2
  [[ "$pw1" == "$pw2" ]] || { echo "Passwords do not match" >&2; exit 1; }
  printf '%s' "$pw1"
}

read_password_stdin() {
  local data
  data="$(cat)"
  printf '%s' "${data%$'\n'}"
}

write_config() {
  [[ -n "$RELEASE_USER" ]] || { echo "--release-user required" >&2; exit 1; }
  mkdir -p "$(dirname "$CONFIG_FILE")"
  cat > "$CONFIG_FILE" <<EOF
# releasectl config (generated)
RELEASE_USER="$RELEASE_USER"
RELEASE_REPO="$RELEASE_REPO"
STAGING_REPO="$STAGING_DIR"
RELEASE_DEV_REPO="$DEV_REPO"
RELEASE_STAGING_DIR="$STAGING_DIR"
RELEASECTL_AUTH_FILE="$AUTH_FILE"
RELEASECTL_LOG_DIR="$HOME/.openclaw/releasectl/logs"
RELEASECTL_ALLOW_SUDO="1"
RELEASECTL_REQUIRE_AUTH="1"
RELEASECTL_ALLOWED_REPO_PREFIX="${RELEASE_REPO%/*}"
EOF
  chmod 600 "$CONFIG_FILE"
  echo "Wrote config: $CONFIG_FILE"
}

write_password() {
  local pw
  if [[ "$PASSWORD_STDIN" == "1" ]]; then
    pw="$(read_password_stdin)"
  else
    pw="$(prompt_password)"
  fi
  mkdir -p "$(dirname "$AUTH_FILE")"
  python3 - "$AUTH_FILE" "$pw" <<'PY'
import binascii, hashlib, os, sys
out_path, password = sys.argv[1:3]
salt = os.urandom(16)
iterations = 310000
derived = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('# releasectl auth (generated)\n')
    f.write('PASSWORD_KDF="pbkdf2_sha256"\n')
    f.write(f'PASSWORD_ITERATIONS="{iterations}"\n')
    f.write(f'PASSWORD_SALT_HEX="{binascii.hexlify(salt).decode()}"\n')
    f.write(f'PASSWORD_HASH_HEX="{binascii.hexlify(derived).decode()}"\n')
PY
  chmod 600 "$AUTH_FILE"
  echo "Wrote auth file: $AUTH_FILE"
}

print_steps() {
  [[ -n "$RELEASE_USER" ]] || { echo "--release-user required" >&2; exit 1; }
  cat <<EOF
# Privileged setup steps for protected production checkout

# 1) Create dedicated release user (skip if already exists)
sudo sysadminctl -addUser "$RELEASE_USER" -home "/Users/$RELEASE_USER" -shell /bin/zsh -password '-'

# 2) Move or clone production checkout under that user
# Option A: move existing repo
sudo mkdir -p "$(dirname "$RELEASE_REPO")"
sudo chown -R "$RELEASE_USER":staff "$(dirname "$RELEASE_REPO")"

# If the repo already exists in place and you want the release user to own it:
sudo chown -R "$RELEASE_USER":staff "$RELEASE_REPO"

# Optional hardening: remove write access for the normal agent user
sudo chmod -R u+rwX,go-w "$RELEASE_REPO"

# 3) Allow the normal agent account to read but not write
sudo chmod -R a+rX "$RELEASE_REPO"

# 4) Allow narrow sudo handoff for releasectl only (recommended)
# Use visudo and add a rule similar to:
# openclaw ALL=($RELEASE_USER) NOPASSWD: /usr/local/lib/openclaw-fleet/releasectl
# (or set RELEASECTL_EXEC_PATH and match that exact absolute path)

# 5) Validate
sudo -u "$RELEASE_USER" git -C "$RELEASE_REPO" status -sb
sudo -u "$RELEASE_USER" test -w "$RELEASE_REPO/.git" && echo writable || echo not-writable
EOF
}

case "$ACTION" in
  init-config) write_config ;;
  set-password) write_password ;;
  print-privileged-steps) print_steps ;;
  help|-h|--help|"") usage ;;
  *) echo "Unknown action: $ACTION" >&2; usage >&2; exit 1 ;;
esac
