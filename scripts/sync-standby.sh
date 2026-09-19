#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=ops-lib.sh
source "$ROOT_DIR/scripts/ops-lib.sh"
ops_require_base
ops_require_cloudflare
ops_need docker
ops_need git
ops_need tar

FORCE=0
if [[ "${1:-}" == "--force-from-vps" ]]; then
  FORCE=1
elif [[ $# -gt 0 ]]; then
  ops_die "usage: $0 [--force-from-vps]"
fi

STATE_DIR="$(ops_state_dir)"
APP_DIR="$(ops_standby_app_dir)"
ENV_FILE="$(ops_standby_env_file)"
DATA_DIR="$BROCAI_STANDBY_ROOT/data"
LOCK_DIR="$STATE_DIR/sync.lock"
mkdir -p "$STATE_DIR" "$DATA_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  ops_log "une synchronisation est déjà en cours; rien à faire"
  exit 0
fi
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brocai-sync.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR" "$LOCK_DIR"
}
trap cleanup EXIT

if [[ "$FORCE" -ne 1 ]]; then
  origin="$(ops_route_origin)"
  if [[ "$origin" == "mac" ]]; then
    ops_log "standby actuellement PUBLIC sur Mac; sync VPS → Mac volontairement suspendue"
    exit 0
  fi
  if [[ "$origin" != "vps" ]]; then
    ops_log "origine publique indéterminée; sync destructive ignorée par sécurité"
    exit 0
  fi
fi

ops_log "lecture du commit VPS"
REMOTE_COMMIT="$(ops_ssh "git -C '$BROCAI_VPS_APP_DIR' rev-parse HEAD")"
[[ "$REMOTE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || ops_die "commit VPS invalide: $REMOTE_COMMIT"

if [[ ! -d "$APP_DIR/.git" ]]; then
  ops_log "clone du dépôt standby"
  mkdir -p "$BROCAI_STANDBY_ROOT"
  git clone "$BROCAI_REPOSITORY_URL" "$APP_DIR"
fi
[[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || ops_die "checkout standby sale: $APP_DIR"
git -C "$APP_DIR" fetch --quiet origin
if ! git -C "$APP_DIR" cat-file -e "${REMOTE_COMMIT}^{commit}" 2>/dev/null; then
  ops_die "le commit VPS $REMOTE_COMMIT n'est pas disponible depuis origin; pousse le commit avant synchronisation"
fi
git -C "$APP_DIR" checkout --quiet --detach "$REMOTE_COMMIT"

ops_log "copie sécurisée de la configuration production"
ops_ssh "cat '$BROCAI_VPS_ENV_FILE'" > "$TMP_DIR/prod.env"
python3 - "$TMP_DIR/prod.env" "$ENV_FILE" "$DATA_DIR" "$BROCAI_STANDBY_APP_PORT" <<'PY'
import pathlib, sys
src, dst, data_dir, port = sys.argv[1:]
replacements = {
    "BROCAI_DATA_DIR": data_dir,
    "APP_BIND_HOST": "127.0.0.1",
    "APP_PORT": port,
}
lines = pathlib.Path(src).read_text(encoding="utf-8").splitlines()
seen = set()
out = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0].strip()
        if key in replacements:
            out.append(f"{key}={replacements[key]}")
            seen.add(key)
            continue
    out.append(line)
for key, value in replacements.items():
    if key not in seen:
        out.append(f"{key}={value}")
pathlib.Path(dst).write_text("\n".join(out) + "\n", encoding="utf-8")
PY
chmod 600 "$ENV_FILE"

REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
ops_log "snapshot PostgreSQL VPS"
ops_ssh "$REMOTE_COMPOSE exec -T postgres sh -lc 'pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists --no-owner --no-privileges'" > "$TMP_DIR/brocai.sql"
[[ -s "$TMP_DIR/brocai.sql" ]] || ops_die "dump PostgreSQL vide"

ops_log "snapshot uploads VPS"
mkdir -p "$TMP_DIR/uploads"
ops_ssh "$REMOTE_COMPOSE exec -T backend python -c 'import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer, mode=\"w|\"); t.add(\"/app/data/uploads\", arcname=\".\"); t.close()'" \
  | tar -xf - -C "$TMP_DIR/uploads"

compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml")
"${compose[@]}" stop frontend backend >/dev/null 2>&1 || true
"${compose[@]}" up -d postgres >/dev/null

ops_log "attente PostgreSQL standby"
ready=0
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || ops_die "PostgreSQL standby indisponible"

ops_log "restauration PostgreSQL standby"
cat "$TMP_DIR/brocai.sql" | "${compose[@]}" exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

ops_log "remplacement atomique des uploads standby"
rm -rf "$DATA_DIR/uploads.next"
mv "$TMP_DIR/uploads" "$DATA_DIR/uploads.next"
rm -rf "$DATA_DIR/uploads"
mv "$DATA_DIR/uploads.next" "$DATA_DIR/uploads"
mkdir -p "$TMP_DIR/uploads"

LAST_COMMIT=""
if [[ -f "$STATE_DIR/last-sync.json" ]]; then
  LAST_COMMIT="$(python3 - "$STATE_DIR/last-sync.json" <<'PY' 2>/dev/null || true
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8")).get("commit", ""), end="")
PY
)"
fi
if [[ "$LAST_COMMIT" != "$REMOTE_COMMIT" ]] || ! docker image inspect brocai-prod-backend >/dev/null 2>&1; then
  ops_log "build standby pour le commit ${REMOTE_COMMIT:0:8}"
  "${compose[@]}" build backend frontend >/dev/null
fi

"${compose[@]}" up -d postgres backend frontend >/dev/null

ops_log "validation READY Mac standby"
ready=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${BROCAI_STANDBY_APP_PORT}/health/ready" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || ops_die "Mac standby non READY après synchronisation"

python3 - "$STATE_DIR/last-sync.json" "$REMOTE_COMMIT" <<'PY'
import datetime as dt, json, pathlib, sys, time
path, commit = sys.argv[1:]
payload = {
    "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
    "epoch": int(time.time()),
    "commit": commit,
}
pathlib.Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
ops_record_action "sync" "mac-standby" "success" "commit ${REMOTE_COMMIT:0:8}"
ops_log "sync terminée — commit ${REMOTE_COMMIT:0:8}, standby READY"
