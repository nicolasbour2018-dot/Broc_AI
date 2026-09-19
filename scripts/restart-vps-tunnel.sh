#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
[[ "$BROCAI_VPS_TUNNEL_SERVICE" =~ ^[A-Za-z0-9_.@-]+$ ]] || ops_die "nom de service tunnel invalide"
ops_log "restart tunnel Cloudflare VPS"
ops_ssh "sudo -n /usr/bin/systemctl restart '$BROCAI_VPS_TUNNEL_SERVICE'"
sleep 2
state="$(ops_ssh "/usr/bin/systemctl is-active '$BROCAI_VPS_TUNNEL_SERVICE'" || true)"
[[ "$state" == "active" ]] || ops_die "tunnel VPS non actif après restart: $state"
ops_record_action "restart-tunnel" "vps" "success"
ops_log "tunnel VPS actif"
