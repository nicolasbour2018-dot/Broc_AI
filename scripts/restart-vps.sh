#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_log "reboot VPS demandé"
ops_record_action "reboot" "vps" "started"
set +e
ops_ssh "sudo -n /usr/bin/systemctl reboot" >/dev/null 2>&1
set -e
sleep 8
ops_log "attente retour SSH + READY"
ready=0
for _ in $(seq 1 90); do
  if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  ops_record_action "reboot" "vps" "error" "READY timeout"
  ops_die "VPS non READY après reboot"
fi
ops_record_action "reboot" "vps" "success"
ops_log "VPS revenu READY"
