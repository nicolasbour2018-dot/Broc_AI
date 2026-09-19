#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare

JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

origin="$(ops_route_origin)"
vps_ready=false
mac_ready=false
vps_tunnel=false
mac_tunnel=false
ops_tunnel=false

if ops_ssh "curl -fsS --max-time 3 http://127.0.0.1:8080/health/ready >/dev/null" >/dev/null 2>&1; then vps_ready=true; fi
if curl -fsS --max-time 3 "http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}/health/ready" >/dev/null 2>&1; then mac_ready=true; fi
if [[ "$(ops_ssh "/usr/bin/systemctl is-active '$BROCAI_VPS_TUNNEL_SERVICE'" 2>/dev/null || true)" == "active" ]]; then vps_tunnel=true; fi
if ops_launch_label_active "com.brocai.tunnel.mac"; then mac_tunnel=true; fi
if ops_launch_label_active "com.brocai.tunnel.ops"; then ops_tunnel=true; fi

STATE_DIR="$(ops_state_dir)"
LAST_SYNC="$STATE_DIR/last-sync.json"
sync_age="null"
sync_timestamp=""
sync_commit=""
if [[ -f "$LAST_SYNC" ]]; then
  read -r sync_age sync_timestamp sync_commit < <(python3 - "$LAST_SYNC" <<'PY'
import json, sys, time
d = json.load(open(sys.argv[1], encoding="utf-8"))
age = max(0, int(time.time()) - int(d.get("epoch", 0))) if d.get("epoch") else None
print("null" if age is None else age, d.get("timestamp", ""), d.get("commit", ""))
PY
)
fi

if [[ "$JSON" -eq 1 ]]; then
  python3 - "$origin" "$vps_ready" "$mac_ready" "$vps_tunnel" "$mac_tunnel" "$ops_tunnel" "$sync_age" "$sync_timestamp" "$sync_commit" <<'PY'
import json, sys
origin, vr, mr, vt, mt, ot, age, ts, commit = sys.argv[1:]
print(json.dumps({
    "public_origin": origin,
    "vps_ready": vr == "true",
    "mac_ready": mr == "true",
    "vps_tunnel": vt == "true",
    "mac_tunnel": mt == "true",
    "ops_tunnel": ot == "true",
    "standby_sync_age_seconds": None if age == "null" else int(age),
    "standby_sync_at": ts or None,
    "standby_commit": commit or None,
}))
PY
else
  printf 'PUBLIC_ORIGIN=%s\nVPS_READY=%s\nMAC_READY=%s\nVPS_TUNNEL=%s\nMAC_TUNNEL=%s\nOPS_TUNNEL=%s\nSYNC_AGE_SECONDS=%s\n' \
    "$origin" "$vps_ready" "$mac_ready" "$vps_tunnel" "$mac_tunnel" "$ops_tunnel" "$sync_age"
fi
