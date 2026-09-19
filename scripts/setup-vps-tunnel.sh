#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

TUNNEL_ID="${1:-}"
PUBLIC_HOSTNAME="${2:-}"
SOURCE_CREDENTIAL="${3:-}"
[[ "$TUNNEL_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "usage: $0 <tunnel-uuid> <public-hostname> <credential-json>" >&2; exit 2; }
[[ -n "$PUBLIC_HOSTNAME" && -f "$SOURCE_CREDENTIAL" ]] || { echo "hostname ou credential JSON invalide" >&2; exit 2; }

if ! command -v cloudflared >/dev/null 2>&1; then
  echo '[brocai-vps-tunnel] installation cloudflared depuis le dépôt Cloudflare'
  apt-get update
  apt-get install -y ca-certificates curl
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y cloudflared
fi

install -d -m 0700 /etc/cloudflared
install -m 0600 "$SOURCE_CREDENTIAL" "/etc/cloudflared/${TUNNEL_ID}.json"
cat > /etc/cloudflared/brocai-vps.yml <<EOF2
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: ${PUBLIC_HOSTNAME}
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF2
chmod 600 /etc/cloudflared/brocai-vps.yml

CLOUDFLARED_BIN="$(command -v cloudflared)"
cat > /etc/systemd/system/cloudflared-brocai-vps.service <<EOF2
[Unit]
Description=BrocAI Cloudflare Tunnel - VPS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${CLOUDFLARED_BIN} tunnel --config /etc/cloudflared/brocai-vps.yml --no-autoupdate run ${TUNNEL_ID}
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF2

OPS_USER="${SUDO_USER:-ubuntu}"
SYSTEMCTL="$(command -v systemctl)"
cat > /etc/sudoers.d/brocai-ops <<EOF2
${OPS_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL} restart cloudflared-brocai-vps.service, ${SYSTEMCTL} reboot
EOF2
chmod 0440 /etc/sudoers.d/brocai-ops
visudo -cf /etc/sudoers.d/brocai-ops >/dev/null

systemctl daemon-reload
systemctl enable --now cloudflared-brocai-vps.service
sleep 2
systemctl --no-pager --full status cloudflared-brocai-vps.service || true
systemctl is-active --quiet cloudflared-brocai-vps.service
printf '[brocai-vps-tunnel] tunnel actif pour %s\n' "$PUBLIC_HOSTNAME"
