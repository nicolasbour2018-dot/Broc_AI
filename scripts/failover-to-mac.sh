#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare

TRANSITION_LOCK_HELD=0
OPERATION_LOCK_HELD=0
RECOVERY_ARMED=0
MAC_PUBLIC_VALIDATED=0
REMOTE_COMPOSE=""

finish_failover() {
  local exit_code=$?
  local services_restored="not-needed" vps_ready="not-checked" dns_restored="not-needed"
  trap - EXIT
  set +e

  if [[ "$exit_code" -ne 0 && "$RECOVERY_ARMED" -eq 1 ]]; then
    if [[ "$MAC_PUBLIC_VALIDATED" -eq 0 ]]; then
      ops_log "échec failover avant validation publique Mac; restauration du VPS"
      services_restored="failed"
      if ops_ssh "$REMOTE_COMPOSE up -d postgres backend frontend >/dev/null" >/dev/null 2>&1; then
        services_restored="ok"
      else
        ops_log "ERREUR: impossible de restaurer tous les services VPS"
      fi

      vps_ready="failed"
      for _ in $(seq 1 45); do
        if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then
          vps_ready="ok"
          break
        fi
        sleep 2
      done
      if [[ "$vps_ready" != "ok" ]]; then
        ops_log "ERREUR: VPS non READY après tentative de restauration"
      fi

      dns_restored="failed"
      if ops_cf_switch_target "$BROCAI_VPS_TUNNEL_ID" >/dev/null 2>&1; then
        dns_restored="ok"
      else
        ops_log "ERREUR: impossible de confirmer la route Cloudflare vers le VPS"
      fi
      ops_record_action "failover" "mac" "error" \
        "pre-commit rollback; services=${services_restored}; ready=${vps_ready}; dns=${dns_restored}; exit ${exit_code}" \
        >/dev/null 2>&1 || true
    else
      ops_log "échec après validation publique Mac; route Mac conservée sans rollback"
      ops_record_action "failover" "mac" "error" \
        "Mac public committed; route retained; exit ${exit_code}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "$OPERATION_LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "operation" || true
  fi
  if [[ "$TRANSITION_LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "transition" || true
  fi
  exit "$exit_code"
}
trap finish_failover EXIT

ops_lock_acquire "transition" "wait"
TRANSITION_LOCK_HELD=1
ops_lock_acquire "operation" "wait"
OPERATION_LOCK_HELD=1

origin="$(ops_route_origin)"
if [[ "$origin" == "mac" ]]; then
  ops_log "le trafic public pointe déjà vers le Mac"
  exit 0
fi
[[ "$origin" == "vps" ]] || ops_die "origine publique indéterminée; failover refusé"

REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
RECOVERY_ARMED=1
ops_log "fencing VPS: arrêt frontend/backend, PostgreSQL reste disponible"
ops_ssh "$REMOTE_COMPOSE stop frontend backend >/dev/null"

ops_log "synchronisation finale VPS → Mac"
"$ROOT_DIR/scripts/sync-standby.sh" --force-from-vps --operation-lock-held

ops_log "validation Mac standby"
curl -fsS --max-time 5 "http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}/health/ready" >/dev/null \
  || ops_die "Mac standby non READY"
ops_launch_label_active "com.brocai.tunnel.mac" || ops_die "tunnel Mac non actif"

ops_log "bascule DNS Cloudflare vers brocai-mac"
ops_cf_switch_target "$BROCAI_MAC_TUNNEL_ID"

public_ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${BROCAI_PUBLIC_HOSTNAME}/health/ready" >/dev/null 2>&1; then public_ok=1; break; fi
  sleep 2
done
[[ "$public_ok" -eq 1 ]] || ops_die "Mac non joignable publiquement"
MAC_PUBLIC_VALIDATED=1

vps_standby="ready"
ops_log "Mac validé publiquement; restauration du VPS comme standby non public"
if ! ops_ssh "$REMOTE_COMPOSE up -d postgres backend frontend >/dev/null" >/dev/null 2>&1; then
  vps_standby="service-restore-failed"
  ops_log "AVERTISSEMENT: services VPS non restaurés; route publique maintenue sur le Mac"
else
  vps_ready=0
  for _ in $(seq 1 45); do
    if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then
      vps_ready=1
      break
    fi
    sleep 2
  done
  if [[ "$vps_ready" -ne 1 ]]; then
    vps_standby="ready-check-failed"
    ops_log "AVERTISSEMENT: VPS restauré mais non READY; route publique maintenue sur le Mac"
  fi
fi

if [[ "$vps_standby" == "ready" ]]; then
  ops_record_action "failover" "mac" "success" \
    "${BROCAI_PUBLIC_HOSTNAME} → brocai-mac; VPS standby=ready"
  ops_log "FAILOVER OK — ${BROCAI_PUBLIC_HOSTNAME} sert désormais le Mac"
else
  ops_record_action "failover" "mac" "warning" \
    "Mac committed; ${BROCAI_PUBLIC_HOSTNAME} → brocai-mac; VPS standby=${vps_standby}"
  ops_log "FAILOVER COMMITTÉ — Mac public; remise en standby VPS incomplète"
fi
