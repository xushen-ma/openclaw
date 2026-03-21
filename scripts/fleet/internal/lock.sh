#!/usr/bin/env bash
# lock.sh — shared lock helpers for fleet scripts

lock_init() {
  mkdir -p "$FLEET_LOCK_DIR"
}

lock_acquire() {
  local lock_file="$1"
  local owner="$2"
  lock_init

  if [[ -f "$lock_file" ]]; then
    local current_owner current_agent current_session current_purpose current_target_sha current_pid current_started current_host current_pwd
    current_owner=$(grep '^OWNER=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_agent=$(grep '^AGENT=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_session=$(grep '^SESSION=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_purpose=$(grep '^PURPOSE=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_target_sha=$(grep '^TARGET_SHA=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_pid=$(grep '^PID=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_started=$(grep '^STARTED_AT=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_host=$(grep '^HOST=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)
    current_pwd=$(grep '^PWD=' "$lock_file" 2>/dev/null | cut -d= -f2- || true)

    if [[ -n "$current_pid" ]] && kill -0 "$current_pid" 2>/dev/null; then
      echo "❌ Lock busy: $lock_file"
      echo "   owner:      ${current_owner:-unknown}"
      echo "   agent:      ${current_agent:-unknown}"
      echo "   session:    ${current_session:-unknown}"
      echo "   purpose:    ${current_purpose:-unknown}"
      echo "   target_sha: ${current_target_sha:-unknown}"
      echo "   pid:        $current_pid"
      echo "   since:      ${current_started:-unknown}"
      echo "   host:       ${current_host:-unknown}"
      echo "   pwd:        ${current_pwd:-unknown}"
      echo "   Do not remove this lock manually unless Xushen approves it."
      return 1
    fi

    echo "❌ Stale lock detected: $lock_file"
    echo "   owner:      ${current_owner:-unknown}"
    echo "   agent:      ${current_agent:-unknown}"
    echo "   session:    ${current_session:-unknown}"
    echo "   purpose:    ${current_purpose:-unknown}"
    echo "   target_sha: ${current_target_sha:-unknown}"
    echo "   pid:        ${current_pid:-unknown}"
    echo "   since:      ${current_started:-unknown}"
    echo "   host:       ${current_host:-unknown}"
    echo "   pwd:        ${current_pwd:-unknown}"
    echo "   Do not remove this lock manually unless Xushen approves it."
    return 1
  fi

  cat > "$lock_file" <<EOF
OWNER=$owner
AGENT=${FLEET_AGENT:-unknown}
SESSION=${FLEET_SESSION:-unknown}
PURPOSE=${FLEET_PURPOSE:-unknown}
TARGET_SHA=${FLEET_TARGET_SHA:-unknown}
PID=$$
STARTED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
HOST=$(hostname)
PWD=$(pwd)
EOF
}

lock_release() {
  local lock_file="$1"
  [[ -f "$lock_file" ]] && rm -f "$lock_file"
}
