#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
BOOT_ID_BEFORE="$(ops_ssh "cat /proc/sys/kernel/random/boot_id")"
[[ "$BOOT_ID_BEFORE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || ops_die "identifiant de boot VPS invalide avant reboot"
ops_log "reboot VPS demandé"
ops_record_action "reboot" "vps" "started"
set +e
ops_ssh "sudo -n /usr/bin/systemctl reboot" >/dev/null 2>&1
set -e
ops_log "attente du retour SSH avec un nouvel identifiant de boot"
BOOT_ID_AFTER=""
for _ in $(seq 1 90); do
  candidate="$(ops_ssh "cat /proc/sys/kernel/random/boot_id" 2>/dev/null || true)"
  if [[ "$candidate" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    && [[ "$candidate" != "$BOOT_ID_BEFORE" ]]; then
    BOOT_ID_AFTER="$candidate"
    break
  fi
  sleep 2
done
if [[ -z "$BOOT_ID_AFTER" ]]; then
  ops_record_action "reboot" "vps" "error" "boot ID unchanged"
  ops_die "reboot VPS non confirmé: identifiant de boot inchangé"
fi

ops_log "nouvel identifiant de boot confirmé; attente READY"
ready=0
for _ in $(seq 1 90); do
  if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  ops_record_action "reboot" "vps" "error" "READY timeout"
  ops_die "VPS non READY après reboot"
fi
ops_record_action "reboot" "vps" "success" "boot ID changed and READY"
ops_log "VPS revenu READY"
