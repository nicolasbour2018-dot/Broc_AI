#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare
ops_need docker
ops_need tar

TRANSITION_LOCK_HELD=0
OPERATION_LOCK_HELD=0
MAINTENANCE_ARMED=0
COMMITTED=0
TMP_DIR=""

finish_failback() {
  local exit_code=$?
  local mac_services="not-checked" mac_tunnel="not-checked" mac_ready="not-checked"
  local vps_services="not-checked" dns_restored="not-checked"
  trap - EXIT
  set +e

  if [[ "$exit_code" -ne 0 && "$MAINTENANCE_ARMED" -eq 1 ]]; then
    if [[ "$COMMITTED" -eq 0 ]]; then
      ops_log "échec failback PRE-COMMIT; restauration du Mac writer"
      vps_services="failed"
      if ops_ssh "$REMOTE_COMPOSE up -d postgres backend frontend >/dev/null" >/dev/null 2>&1; then
        vps_services="ok"
      fi
      mac_services="failed"
      if "${compose[@]}" up -d postgres backend frontend >/dev/null 2>&1; then
        mac_services="ok"
      else
        ops_log "ERREUR: impossible de restaurer tous les services Mac"
      fi
      mac_tunnel="failed"
      if ops_launch_start "com.brocai.tunnel.mac" "$MAC_PLIST" >/dev/null 2>&1; then
        mac_tunnel="ok"
      else
        ops_log "ERREUR: impossible de restaurer le tunnel Mac"
      fi
      mac_ready="failed"
      for _ in $(seq 1 45); do
        if curl -fsS --max-time 3 "http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}/health/ready" >/dev/null 2>&1; then
          mac_ready="ok"
          break
        fi
        sleep 2
      done
      dns_restored="failed"
      if ops_cf_switch_target "$BROCAI_MAC_TUNNEL_ID" >/dev/null 2>&1; then
        dns_restored="ok"
      else
        ops_log "ERREUR: impossible de confirmer la route Cloudflare vers le Mac"
      fi
      ops_record_action "failback" "vps" "error" \
        "PRE-COMMIT rollback; Mac services=${mac_services}; tunnel=${mac_tunnel}; ready=${mac_ready}; VPS services=${vps_services}; dns=${dns_restored}; exit ${exit_code}" \
        >/dev/null 2>&1 || true
    else
      ops_log "échec failback POST-COMMIT; VPS reste autoritaire et la route DNS reste inchangée"
      ops_record_action "failback" "vps" "error" \
        "POST-COMMIT failure; VPS route retained; exit ${exit_code}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
  if [[ "$OPERATION_LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "operation" || true
  fi
  if [[ "$TRANSITION_LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "transition" || true
  fi
  exit "$exit_code"
}
trap finish_failback EXIT

ops_lock_acquire "transition" "wait"
TRANSITION_LOCK_HELD=1
ops_lock_acquire "operation" "wait"
OPERATION_LOCK_HELD=1

origin="$(ops_route_origin)"
if [[ "$origin" == "vps" ]]; then
  ops_log "le trafic public pointe déjà vers le VPS"
  exit 0
fi
[[ "$origin" == "mac" ]] || ops_die "origine publique indéterminée; failback refusé"

ops_log "validation du VPS avant maintenance"
ops_ssh "curl -fsS --max-time 5 http://127.0.0.1:8080/health/ready >/dev/null" \
  || ops_die "VPS non READY; failback refusé"

APP_DIR="$(ops_standby_app_dir)"
ENV_FILE="$(ops_standby_env_file)"
DATA_DIR="$BROCAI_STANDBY_ROOT/data"
[[ -f "$ENV_FILE" && -f "$APP_DIR/docker-compose.prod.yml" ]] || ops_die "standby Mac incomplet"
compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml")
MAC_PLIST="$HOME/Library/LaunchAgents/com.brocai.tunnel.mac.plist"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brocai-failback.XXXXXX")"
REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
MAINTENANCE_ARMED=1

ops_log "phase PRE-COMMIT: le Mac reste writer jusqu'à validation publique du VPS"
ops_log "début maintenance courte: arrêt du tunnel public Mac"
ops_launch_stop "com.brocai.tunnel.mac" "$MAC_PLIST"
"${compose[@]}" stop frontend backend >/dev/null

ops_log "snapshot final PostgreSQL Mac"
"${compose[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' > "$TMP_DIR/brocai.sql"
[[ -s "$TMP_DIR/brocai.sql" ]] || ops_die "dump Mac vide"

ops_log "snapshot final uploads Mac"
tar -C "$DATA_DIR/uploads" -cf "$TMP_DIR/uploads.tar" .

ops_log "arrêt backend/frontend VPS pendant restauration"
ops_ssh "$REMOTE_COMPOSE stop frontend backend >/dev/null"

ops_log "restauration PostgreSQL Mac → VPS"
cat "$TMP_DIR/brocai.sql" | ops_ssh "$REMOTE_COMPOSE exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' >/dev/null"

ops_log "restauration uploads Mac → VPS"
ops_ssh "mkdir -p '$BROCAI_VPS_DATA_DIR/uploads' && find '$BROCAI_VPS_DATA_DIR/uploads' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +"
cat "$TMP_DIR/uploads.tar" | ops_ssh "tar -C '$BROCAI_VPS_DATA_DIR/uploads' -xf -"

ops_log "redémarrage VPS"
ops_ssh "$REMOTE_COMPOSE up -d postgres backend frontend >/dev/null"
ready=0
for _ in $(seq 1 45); do
  if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || ops_die "VPS non READY après restauration"

ops_log "bascule DNS Cloudflare vers brocai-vps"
ops_cf_switch_target "$BROCAI_VPS_TUNNEL_ID"
public_ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${BROCAI_PUBLIC_HOSTNAME}/health/ready" >/dev/null 2>&1; then public_ok=1; break; fi
  sleep 2
done
[[ "$public_ok" -eq 1 ]] || ops_die "VPS restauré mais validation publique échouée"
COMMITTED=1
ops_log "COMMIT: VPS validé publiquement et désormais autoritaire"

ops_log "phase POST-COMMIT: remise du Mac en standby sans rollback DNS"
post_commit_warning=""
if ! "${compose[@]}" up -d postgres backend frontend >/dev/null 2>&1; then
  post_commit_warning="Mac services restore failed"
  ops_log "AVERTISSEMENT: services Mac non restaurés; VPS reste public"
fi
if ! ops_launch_start "com.brocai.tunnel.mac" "$MAC_PLIST" >/dev/null 2>&1; then
  if [[ -n "$post_commit_warning" ]]; then
    post_commit_warning="${post_commit_warning}; Mac tunnel restore failed"
  else
    post_commit_warning="Mac tunnel restore failed"
  fi
  ops_log "AVERTISSEMENT: tunnel Mac non restauré; VPS reste public"
fi

if [[ -n "$post_commit_warning" ]]; then
  ops_record_action "failback" "vps" "warning" \
    "VPS committed; ${post_commit_warning}; DNS retained on brocai-vps"
  ops_log "FAILBACK COMMITTÉ — VPS public; remise en standby Mac incomplète"
else
  ops_record_action "failback" "vps" "success" \
    "Mac data restored; ${BROCAI_PUBLIC_HOSTNAME} → brocai-vps"
  ops_log "FAILBACK OK — VPS de nouveau public; Mac repasse standby"
fi
