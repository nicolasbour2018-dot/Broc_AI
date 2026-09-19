#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare
for key in BROCAI_OPS_TUNNEL_ID BROCAI_OPS_HOSTNAME BROCAI_OPS_TOKEN; do ops_require_var "$key"; done
ops_need docker
ops_need git
ops_need cloudflared
ops_need python3

CF_DIR="$HOME/.cloudflared"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
STATE_DIR="$BROCAI_STANDBY_ROOT/state"
APP_DIR="$BROCAI_STANDBY_ROOT/app"
mkdir -p "$CF_DIR" "$LAUNCH_DIR" "$STATE_DIR" "$BROCAI_STANDBY_ROOT/data"
chmod 700 "$CF_DIR"

for tid in "$BROCAI_MAC_TUNNEL_ID" "$BROCAI_OPS_TUNNEL_ID"; do
  [[ -f "$CF_DIR/${tid}.json" ]] || ops_die "credential tunnel introuvable: $CF_DIR/${tid}.json"
  chmod 600 "$CF_DIR/${tid}.json"
done

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$BROCAI_REPOSITORY_URL" "$APP_DIR"
fi
git -C "$APP_DIR" fetch --quiet origin "$BROCAI_STANDBY_BRANCH"
git -C "$APP_DIR" checkout --quiet --detach "origin/$BROCAI_STANDBY_BRANCH"

cat > "$CF_DIR/brocai-mac.yml" <<EOF2
tunnel: ${BROCAI_MAC_TUNNEL_ID}
credentials-file: ${CF_DIR}/${BROCAI_MAC_TUNNEL_ID}.json
ingress:
  - hostname: ${BROCAI_PUBLIC_HOSTNAME}
    service: http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}
  - service: http_status:404
EOF2
cat > "$CF_DIR/brocai-ops.yml" <<EOF2
tunnel: ${BROCAI_OPS_TUNNEL_ID}
credentials-file: ${CF_DIR}/${BROCAI_OPS_TUNNEL_ID}.json
ingress:
  - hostname: ${BROCAI_OPS_HOSTNAME}
    service: http://127.0.0.1:${BROCAI_OPS_PORT}
  - service: http_status:404
EOF2
chmod 600 "$CF_DIR/brocai-mac.yml" "$CF_DIR/brocai-ops.yml"

CLOUDFLARED_BIN="$(command -v cloudflared)"
PYTHON_BIN="$(command -v python3)"
DOCKER_BIN="$(command -v docker)"
DOCKER_DIR="$(dirname "$DOCKER_BIN")"
CLOUDFLARED_DIR="$(dirname "$CLOUDFLARED_BIN")"
LAUNCH_PATH="${DOCKER_DIR}:${CLOUDFLARED_DIR}:/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"
OPS_ENV_ABS="$(cd "$(dirname "$OPS_ENV_FILE")" && pwd)/$(basename "$OPS_ENV_FILE")"

write_agent() {
  local label="$1" program="$2" args_xml="$3" interval="${4:-}"
  local plist="$LAUNCH_DIR/${label}.plist"
  cat > "$plist" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${program}</string>${args_xml}</array>
  <key>EnvironmentVariables</key><dict><key>BROCAI_OPS_ENV_FILE</key><string>${OPS_ENV_ABS}</string><key>PATH</key><string>${LAUNCH_PATH}</string></dict>
  <key>RunAtLoad</key><true/>
  ${interval}
  <key>StandardOutPath</key><string>${STATE_DIR}/${label}.out.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/${label}.err.log</string>
</dict></plist>
EOF2
  plutil -lint "$plist" >/dev/null
  launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
}

write_agent "com.brocai.tunnel.mac" "$CLOUDFLARED_BIN" \
  "<string>tunnel</string><string>--config</string><string>${CF_DIR}/brocai-mac.yml</string><string>--no-autoupdate</string><string>run</string><string>${BROCAI_MAC_TUNNEL_ID}</string>"
write_agent "com.brocai.tunnel.ops" "$CLOUDFLARED_BIN" \
  "<string>tunnel</string><string>--config</string><string>${CF_DIR}/brocai-ops.yml</string><string>--no-autoupdate</string><string>run</string><string>${BROCAI_OPS_TUNNEL_ID}</string>"
write_agent "com.brocai.ops" "$PYTHON_BIN" \
  "<string>${APP_DIR}/ops/control_plane.py</string>"
write_agent "com.brocai.sync" "/bin/bash" \
  "<string>${APP_DIR}/scripts/sync-standby.sh</string>" \
  "<key>StartInterval</key><integer>120</integer>"

ops_log "launch agents installés; synchronisation initiale"
"$APP_DIR/scripts/sync-standby.sh"
ops_log "Mac standby prêt sur 127.0.0.1:${BROCAI_STANDBY_APP_PORT}; Ops sur 127.0.0.1:${BROCAI_OPS_PORT}"
