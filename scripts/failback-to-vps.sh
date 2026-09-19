#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare
ops_need docker
ops_need tar

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
SWITCHED=0
recover_mac() {
  local exit_code=$?
  set +e
  if [[ "$SWITCHED" -eq 1 ]]; then
    ops_log "failback incomplet après bascule DNS; rollback vers le Mac"
    ops_cf_switch_target "$BROCAI_MAC_TUNNEL_ID" >/dev/null 2>&1 || true
  fi
  ops_ssh "$(ops_compose_remote_prefix) up -d postgres backend frontend >/dev/null" >/dev/null 2>&1 || true
  "${compose[@]}" up -d postgres backend frontend >/dev/null 2>&1
  ops_launch_start "com.brocai.tunnel.mac" "$MAC_PLIST" >/dev/null 2>&1
  ops_record_action "failback" "vps" "error" "rollback Mac; exit ${exit_code}" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap recover_mac EXIT

ops_log "début maintenance courte: arrêt du tunnel public Mac"
ops_launch_stop "com.brocai.tunnel.mac" "$MAC_PLIST"
"${compose[@]}" stop frontend backend >/dev/null

ops_log "snapshot final PostgreSQL Mac"
"${compose[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' > "$TMP_DIR/brocai.sql"
[[ -s "$TMP_DIR/brocai.sql" ]] || ops_die "dump Mac vide"

ops_log "snapshot final uploads Mac"
tar -C "$DATA_DIR/uploads" -cf "$TMP_DIR/uploads.tar" .

REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
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
SWITCHED=1
public_ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${BROCAI_PUBLIC_HOSTNAME}/health/ready" >/dev/null 2>&1; then public_ok=1; break; fi
  sleep 2
done
[[ "$public_ok" -eq 1 ]] || ops_die "VPS restauré mais validation publique échouée"

ops_launch_start "com.brocai.tunnel.mac" "$MAC_PLIST"
"${compose[@]}" up -d postgres backend frontend >/dev/null
trap - EXIT
rm -rf "$TMP_DIR"

ops_record_action "failback" "vps" "success" "Mac data restored; ${BROCAI_PUBLIC_HOSTNAME} → brocai-vps"
ops_log "FAILBACK OK — VPS de nouveau public; Mac repasse standby"
