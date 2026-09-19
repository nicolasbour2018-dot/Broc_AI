#!/usr/bin/env bash
# Shared helpers for BrocAI 10.8 operational scripts.

OPS_ENV_FILE="${BROCAI_OPS_ENV_FILE:-$HOME/.config/brocai/ops.env}"

ops_die() {
  printf '[brocai-ops] ERROR: %s\n' "$*" >&2
  exit 1
}

ops_log() {
  printf '[brocai-ops] %s\n' "$*"
}

ops_need() {
  command -v "$1" >/dev/null 2>&1 || ops_die "commande manquante: $1"
}

ops_load_env() {
  [[ -f "$OPS_ENV_FILE" ]] || ops_die "configuration Ops introuvable: $OPS_ENV_FILE"
  # shellcheck disable=SC1090
  set -a
  source "$OPS_ENV_FILE"
  set +a

  : "${BROCAI_VPS_USER:=ubuntu}"
  : "${BROCAI_VPS_APP_DIR:=/srv/brocai/app}"
  : "${BROCAI_VPS_ENV_FILE:=/srv/brocai/.env}"
  : "${BROCAI_VPS_DATA_DIR:=/srv/brocai/data}"
  : "${BROCAI_VPS_TUNNEL_SERVICE:=cloudflared-brocai-vps.service}"
  : "${BROCAI_STANDBY_ROOT:=$HOME/BrocAI-standby}"
  : "${BROCAI_STANDBY_APP_PORT:=8081}"
  : "${BROCAI_REPOSITORY_URL:=https://github.com/nicolasbour2018-dot/Broc_AI.git}"
  : "${BROCAI_STANDBY_BRANCH:=step10.8-cloudflare-standby}"
  : "${BROCAI_OPS_ACTOR:=Nicolas}"
  : "${BROCAI_OPS_BIND_HOST:=127.0.0.1}"
  : "${BROCAI_OPS_PORT:=8765}"

  export BROCAI_VPS_USER BROCAI_VPS_APP_DIR BROCAI_VPS_ENV_FILE BROCAI_VPS_DATA_DIR
  export BROCAI_VPS_TUNNEL_SERVICE BROCAI_STANDBY_ROOT BROCAI_STANDBY_APP_PORT
  export BROCAI_REPOSITORY_URL BROCAI_STANDBY_BRANCH BROCAI_OPS_ACTOR BROCAI_OPS_BIND_HOST BROCAI_OPS_PORT
}

ops_require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || ops_die "$name est absent de $OPS_ENV_FILE"
  [[ "${!name}" != CHANGE_ME* ]] || ops_die "$name utilise encore une valeur CHANGE_ME"
}

ops_require_base() {
  ops_load_env
  ops_need ssh
  ops_need curl
  ops_need python3
  for key in BROCAI_VPS_HOST BROCAI_VPS_SSH_KEY BROCAI_STANDBY_ROOT; do
    ops_require_var "$key"
  done
  [[ -f "$BROCAI_VPS_SSH_KEY" ]] || ops_die "clé SSH introuvable: $BROCAI_VPS_SSH_KEY"
}

ops_require_cloudflare() {
  for key in CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN BROCAI_PUBLIC_HOSTNAME BROCAI_VPS_TUNNEL_ID BROCAI_MAC_TUNNEL_ID; do
    ops_require_var "$key"
  done
}

ops_ssh() {
  local command="$1"
  ssh \
    -i "$BROCAI_VPS_SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=2 \
    "${BROCAI_VPS_USER}@${BROCAI_VPS_HOST}" \
    "$command"
}

ops_compose_remote_prefix() {
  printf 'cd %q && docker compose --env-file %q -f docker-compose.prod.yml' "$BROCAI_VPS_APP_DIR" "$BROCAI_VPS_ENV_FILE"
}

ops_standby_app_dir() {
  printf '%s/app' "$BROCAI_STANDBY_ROOT"
}

ops_standby_env_file() {
  printf '%s/.env' "$BROCAI_STANDBY_ROOT"
}

ops_state_dir() {
  printf '%s/state' "$BROCAI_STANDBY_ROOT"
}

ops_lock_path() {
  local name="$1"
  printf '%s/%s.lock' "$(ops_state_dir)" "$name"
}

ops_lock_is_held() {
  local name="$1" lock_dir owner_pid
  lock_dir="$(ops_lock_path "$name")"
  [[ -d "$lock_dir" ]] || return 1

  owner_pid=""
  if [[ -f "$lock_dir/pid" ]]; then
    owner_pid="$(<"$lock_dir/pid")"
  fi
  if [[ "$owner_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$owner_pid" 2>/dev/null; then
    ops_log "verrou $name obsolète (PID $owner_pid); nettoyage"
    rm -f "$lock_dir/pid"
    if rmdir "$lock_dir" 2>/dev/null; then
      return 1
    fi
    ops_log "impossible de nettoyer le verrou $name: $lock_dir"
  fi
  return 0
}

ops_lock_acquire() {
  local name="$1" wait_mode="${2:-wait}" lock_dir waiting=0
  lock_dir="$(ops_lock_path "$name")"
  mkdir -p "$(ops_state_dir)"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    if ! ops_lock_is_held "$name"; then
      continue
    fi
    if [[ "$wait_mode" == "no-wait" ]]; then
      return 1
    fi
    if [[ "$waiting" -eq 0 ]]; then
      ops_log "attente du verrou $name détenu par une autre opération"
      waiting=1
    fi
    sleep 1
  done
  printf '%s\n' "$$" > "$lock_dir/pid"
}

ops_lock_assert_owner() {
  local name="$1" expected_pid="$2" lock_dir owner_pid=""
  lock_dir="$(ops_lock_path "$name")"
  if [[ -f "$lock_dir/pid" ]]; then
    owner_pid="$(<"$lock_dir/pid")"
  fi
  [[ "$owner_pid" == "$expected_pid" ]] \
    || ops_die "verrou $name absent ou détenu par un autre processus"
}

ops_lock_release() {
  local name="$1" lock_dir owner_pid=""
  lock_dir="$(ops_lock_path "$name")"
  [[ -d "$lock_dir" ]] || return 0
  if [[ -f "$lock_dir/pid" ]]; then
    owner_pid="$(<"$lock_dir/pid")"
  fi
  if [[ "$owner_pid" != "$$" ]]; then
    ops_log "refus de libérer le verrou $name détenu par le PID ${owner_pid:-inconnu}"
    return 1
  fi
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir"
}

ops_cf_api() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local args=(--fail-with-body --silent --show-error --max-time 15 -X "$method" "$url" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json')
  if [[ -n "$payload" ]]; then
    args+=(--data "$payload")
  fi
  curl "${args[@]}"
}

ops_cf_record_id() {
  if [[ -n "${CLOUDFLARE_DNS_RECORD_ID:-}" ]]; then
    printf '%s' "$CLOUDFLARE_DNS_RECORD_ID"
    return 0
  fi

  local response
  response="$(curl --fail-with-body --silent --show-error --max-time 15 --get \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --data-urlencode "type=CNAME" \
    --data-urlencode "name=$BROCAI_PUBLIC_HOSTNAME")"

  python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result") or []; sys.exit("record CNAME introuvable ou ambigu") if len(r)!=1 else print(r[0]["id"], end="")' <<<"$response"
}

ops_cf_current_target() {
  local record_id response
  record_id="$(ops_cf_record_id)" || return 1
  response="$(ops_cf_api GET "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}")" || return 1
  python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("result") or {}).get("content", ""), end="")' <<<"$response"
}

ops_route_origin() {
  local target
  target="$(ops_cf_current_target 2>/dev/null)" || { printf 'unknown'; return 0; }
  case "$target" in
    "${BROCAI_VPS_TUNNEL_ID}.cfargotunnel.com") printf 'vps' ;;
    "${BROCAI_MAC_TUNNEL_ID}.cfargotunnel.com") printf 'mac' ;;
    *) printf 'unknown' ;;
  esac
}

ops_cf_switch_target() {
  local tunnel_id="$1"
  local record_id payload response expected
  if ! record_id="$(ops_cf_record_id)"; then
    printf '[brocai-ops] ERROR: impossible de déterminer le DNS record Cloudflare\n' >&2
    return 1
  fi
  expected="${tunnel_id}.cfargotunnel.com"
  if ! payload="$(python3 - "$expected" <<'PY'
import json, sys
print(json.dumps({"type": "CNAME", "content": sys.argv[1], "proxied": True, "ttl": 1}))
PY
)"; then
    printf '[brocai-ops] ERROR: impossible de préparer la mise à jour DNS Cloudflare\n' >&2
    return 1
  fi
  if ! response="$(ops_cf_api PATCH "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" "$payload")"; then
    printf '[brocai-ops] ERROR: échec de la mise à jour DNS Cloudflare\n' >&2
    return 1
  fi
  if ! python3 -c 'import json,sys; expected=sys.argv[1]; doc=json.load(sys.stdin); success=doc.get("success"); actual=(doc.get("result") or {}).get("content"); sys.exit("Cloudflare a refusé la mise à jour DNS") if not success else None; sys.exit(f"cible DNS inattendue: {actual!r}") if actual != expected else None' "$expected" <<<"$response"; then
    printf '[brocai-ops] ERROR: réponse Cloudflare invalide après mise à jour DNS\n' >&2
    return 1
  fi
}

ops_record_action() {
  local action="$1" target="$2" result="$3" details="${4:-}"
  local state_dir
  state_dir="$(ops_state_dir)"
  mkdir -p "$state_dir"
  python3 - "$state_dir/ops-actions.jsonl" "$BROCAI_OPS_ACTOR" "$action" "$target" "$result" "$details" <<'PY'
import datetime as dt, json, pathlib, sys
path, actor, action, target, result, details = sys.argv[1:]
row = {
    "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
    "actor": actor,
    "action": action,
    "target": target,
    "result": result,
    "details": details,
}
with pathlib.Path(path).open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(row, ensure_ascii=False) + "\n")
PY
}

ops_launch_label_active() {
  local label="$1"
  launchctl print "gui/$(id -u)/${label}" >/dev/null 2>&1
}

ops_launch_start() {
  local label="$1" plist="$2"
  if ! ops_launch_label_active "$label"; then
    launchctl bootstrap "gui/$(id -u)" "$plist" >/dev/null
  fi
  launchctl kickstart -k "gui/$(id -u)/${label}" >/dev/null
}

ops_launch_stop() {
  local label="$1" plist="$2"
  if ops_launch_label_active "$label"; then
    launchctl bootout "gui/$(id -u)" "$plist" >/dev/null
  fi
}
