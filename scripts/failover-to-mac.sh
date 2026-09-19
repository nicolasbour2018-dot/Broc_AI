#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare

origin="$(ops_route_origin)"
if [[ "$origin" == "mac" ]]; then
  ops_log "le trafic public pointe déjà vers le Mac"
  exit 0
fi
[[ "$origin" == "vps" ]] || ops_die "origine publique indéterminée; failover refusé"

ops_log "synchronisation finale VPS → Mac"
"$ROOT_DIR/scripts/sync-standby.sh"

ops_log "validation Mac standby"
curl -fsS --max-time 5 "http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}/health/ready" >/dev/null \
  || ops_die "Mac standby non READY"
MAC_PLIST="$HOME/Library/LaunchAgents/com.brocai.tunnel.mac.plist"
ops_launch_label_active "com.brocai.tunnel.mac" || ops_die "tunnel Mac non actif"

ops_log "bascule DNS Cloudflare vers brocai-mac"
ops_cf_switch_target "$BROCAI_MAC_TUNNEL_ID"

public_ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${BROCAI_PUBLIC_HOSTNAME}/health/ready" >/dev/null 2>&1; then public_ok=1; break; fi
  sleep 2
done
if [[ "$public_ok" -ne 1 ]]; then
  ops_log "validation publique échouée; rollback DNS vers VPS"
  ops_cf_switch_target "$BROCAI_VPS_TUNNEL_ID" || true
  ops_record_action "failover" "mac" "error" "public READY failed; DNS rolled back"
  ops_die "Mac non joignable publiquement; retour VPS demandé"
fi

ops_record_action "failover" "mac" "success" "${BROCAI_PUBLIC_HOSTNAME} → brocai-mac"
ops_log "FAILOVER OK — ${BROCAI_PUBLIC_HOSTNAME} sert désormais le Mac"
