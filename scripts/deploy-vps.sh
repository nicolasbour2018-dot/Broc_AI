#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${BROCAI_ENV_FILE:-${ROOT_DIR}/../.env}"

log() {
  printf '[brocai-deploy] %s\n' "$*"
}

die() {
  printf '[brocai-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "commande manquante: $1"
}

env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); value=$0} END {print value}' "$ENV_FILE"
}

need docker
need curl
need git

docker compose version >/dev/null 2>&1 || die "Docker Compose plugin indisponible"
[[ -f "$COMPOSE_FILE" ]] || die "compose production introuvable: $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "fichier de secrets introuvable: $ENV_FILE"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  die "working tree non propre; commit/stash avant un déploiement production"
fi

for key in POSTGRES_PASSWORD GEMINI_API_KEY HF_TOKEN ADMIN_TOKEN; do
  value="$(env_value "$key")"
  [[ -n "$value" ]] || die "$key est vide dans $ENV_FILE"
  [[ "$value" != CHANGE_ME* ]] || die "$key utilise encore une valeur CHANGE_ME"
done

DATA_DIR="$(env_value BROCAI_DATA_DIR)"
DATA_DIR="${DATA_DIR:-/srv/brocai/data}"
[[ "$DATA_DIR" == /* ]] || die "BROCAI_DATA_DIR doit être un chemin absolu"

APP_PORT="$(env_value APP_PORT)"
APP_PORT="${APP_PORT:-8080}"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "APP_PORT invalide: $APP_PORT"

if [[ "$EUID" -eq 0 ]]; then
  SUDO=()
else
  need sudo
  SUDO=(sudo)
fi

log "préparation des répertoires persistants dans $DATA_DIR"
"${SUDO[@]}" install -d -m 0750 \
  "$DATA_DIR" \
  "$DATA_DIR/postgres" \
  "$DATA_DIR/uploads" \
  "$DATA_DIR/backups"

chmod 600 "$ENV_FILE" 2>/dev/null || "${SUDO[@]}" chmod 600 "$ENV_FILE"

log "validation de la configuration Compose"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
log "déploiement du commit $COMMIT"
log "build des images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull

log "démarrage des services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

LIVE_URL="http://127.0.0.1:${APP_PORT}/health/live"
READY_URL="http://127.0.0.1:${APP_PORT}/health/ready"

log "attente des healthchecks applicatifs"
ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 3 "$LIVE_URL" >/dev/null 2>&1 \
    && curl --fail --silent --show-error --max-time 3 "$READY_URL" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  log "les healthchecks ne sont pas devenus verts"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps || true
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 postgres backend frontend || true
  exit 1
fi

log "LIVE:  $(curl --fail --silent --show-error --max-time 3 "$LIVE_URL")"
log "READY: $(curl --fail --silent --show-error --max-time 3 "$READY_URL")"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
log "déploiement VPS prêt sur 127.0.0.1:${APP_PORT}; exposition publique volontairement reportée à l'étape 10.8"
