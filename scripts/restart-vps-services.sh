#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
ops_log "restart backend + frontend sur VPS"
ops_ssh "$REMOTE_COMPOSE restart backend frontend >/dev/null"
ready=0
for _ in $(seq 1 45); do
  if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || ops_die "VPS non READY après restart services"
ops_record_action "restart-services" "vps" "success"
ops_log "VPS READY"
