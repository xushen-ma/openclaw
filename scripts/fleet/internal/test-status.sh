#!/usr/bin/env bash
# test-status.sh — show current test lane status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/fleet.env"

echo "== releasectl test status =="
echo "test_repo=$TEST_REPO"

if [[ ! -d "$TEST_REPO/.git" ]]; then
  echo "repo_valid=no"
  echo "error=invalid test repo ($TEST_REPO)"
  exit 1
fi

echo "repo_valid=yes"
echo "test_head_sha=$(git -C "$TEST_REPO" rev-parse HEAD)"
echo "test_head_ref=$(git -C "$TEST_REPO" rev-parse --abbrev-ref HEAD)"

if [[ -f "$TEST_STATE_FILE" ]]; then
  echo "state_file=$TEST_STATE_FILE"
  cat "$TEST_STATE_FILE"
else
  echo "state_file=missing"
fi

if [[ -f "$TEST_LOCK_FILE" ]]; then
  lock_pid=$(grep '^PID=' "$TEST_LOCK_FILE" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "test_lock=busy"
  else
    echo "test_lock=stale"
  fi
  echo "test_lock_file=$TEST_LOCK_FILE"
  cat "$TEST_LOCK_FILE"
else
  echo "test_lock=free"
fi
