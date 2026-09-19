#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=ops-lib.sh
source "$ROOT_DIR/scripts/ops-lib.sh"

[[ "$(uname -s)" == "Darwin" ]] || ops_die "cette commande doit être exécutée sur le Mac Ops/standby"
[[ $# -eq 1 ]] || ops_die "usage: $0 YYYY-MM-DD"

EVENT_DATE="$1"
[[ "$EVENT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || ops_die "date événement invalide; format attendu: YYYY-MM-DD"
python3 - "$EVENT_DATE" <<'PY'
import datetime as dt
import sys

value = sys.argv[1]
try:
    parsed = dt.date.fromisoformat(value)
except ValueError as exc:
    raise SystemExit(f"date événement invalide: {exc}") from exc
if parsed.isoformat() != value:
    raise SystemExit("date événement non canonique")
PY

ops_require_base
ops_require_cloudflare
ops_need git
ops_need tar

[[ -d "$BROCAI_STANDBY_ROOT" ]] || ops_die "racine standby introuvable: $BROCAI_STANDBY_ROOT"
EXPORT_ROOT="$BROCAI_STANDBY_ROOT/event-exports"
RUN_NAME="brocai-event-$EVENT_DATE"
FINAL_DIR="$EXPORT_ROOT/$RUN_NAME"
mkdir -p "$EXPORT_ROOT"
chmod 700 "$EXPORT_ROOT"

LOCK_HELD=0
STAGING_DIR=""
CLEANUP_STAGING=1
cleanup() {
  local exit_code=$?
  if [[ "$CLEANUP_STAGING" -eq 1 && -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    case "$STAGING_DIR" in
      "$EXPORT_ROOT"/.brocai-event-*.staging.*) rm -rf -- "$STAGING_DIR" ;;
      *) ops_log "staging inattendu conservé par sécurité: $STAGING_DIR" ;;
    esac
  fi
  if [[ "$LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "operation" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

ops_lock_acquire "operation" "wait"
LOCK_HELD=1
[[ ! -e "$FINAL_DIR" ]] || ops_die "bundle déjà présent; aucun écrasement: $FINAL_DIR"
STAGING_DIR="$(mktemp -d "$EXPORT_ROOT/.${RUN_NAME}.staging.XXXXXX")"
mkdir -p "$STAGING_DIR/raw" "$STAGING_DIR/snapshots" "$STAGING_DIR/reports" "$STAGING_DIR/metadata"

ORIGIN="$(ops_route_origin)"
[[ "$ORIGIN" == "vps" || "$ORIGIN" == "mac" ]] || ops_die "origine publique indéterminée; export refusé"
ops_log "export événementiel depuis la source active: $ORIGIN"

REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
APP_DIR="$(ops_standby_app_dir)"
ENV_FILE="$(ops_standby_env_file)"
DATA_DIR="$BROCAI_STANDBY_ROOT/data"

if [[ "$ORIGIN" == "vps" ]]; then
  SOURCE_COMMIT="$(ops_ssh "git -C '$BROCAI_VPS_APP_DIR' rev-parse HEAD")"
  ops_log "lecture seule du dump PostgreSQL VPS"
  ops_ssh "$REMOTE_COMPOSE exec -T postgres sh -lc 'pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=custom --no-owner --no-privileges'" \
    > "$STAGING_DIR/raw/postgres.dump"
  ops_log "lecture seule de l'archive uploads VPS"
  printf -v REMOTE_UPLOADS_DIR '%q' "$BROCAI_VPS_DATA_DIR/uploads"
  ops_ssh "tar -C $REMOTE_UPLOADS_DIR -cf - ." > "$STAGING_DIR/raw/uploads.tar"
else
  ops_need docker
  [[ -f "$ENV_FILE" && -f "$APP_DIR/docker-compose.prod.yml" ]] || ops_die "standby Mac incomplet"
  [[ -d "$DATA_DIR/uploads" ]] || ops_die "uploads Mac introuvables"
  SOURCE_COMMIT="$(git -C "$APP_DIR" rev-parse HEAD)"
  compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml")
  ops_log "lecture seule du dump PostgreSQL Mac"
  "${compose[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    > "$STAGING_DIR/raw/postgres.dump"
  ops_log "lecture seule de l'archive uploads Mac"
  tar -C "$DATA_DIR/uploads" -cf "$STAGING_DIR/raw/uploads.tar" .
fi

[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || ops_die "commit source invalide"
EXPORTER_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
[[ "$EXPORTER_COMMIT" == "$SOURCE_COMMIT" ]] \
  || ops_die "le checkout qui produit le bundle ne correspond pas au commit actif $SOURCE_COMMIT"

export_csv() {
  local filename="$1"
  local query="$2"
  local destination="$STAGING_DIR/raw/$filename"
  if [[ "$ORIGIN" == "vps" ]]; then
    printf '\\copy (%s) TO STDOUT WITH (FORMAT CSV, HEADER true)\n' "$query" \
      | ops_ssh "$REMOTE_COMPOSE exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'" \
      > "$destination"
  else
    printf '\\copy (%s) TO STDOUT WITH (FORMAT CSV, HEADER true)\n' "$query" \
      | "${compose[@]}" exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
      > "$destination"
  fi
}

EVENTS_QUERY='SELECT id, session_id, event_name, created_at, properties::text AS properties FROM events ORDER BY created_at, id'
AI_JOBS_QUERY="SELECT id, session_id, feature, related_id, status, result ->> 'analysis_mode' AS analysis_mode, result::text AS result, error_code, error_message, attempts, duration_ms, CASE WHEN started_at IS NULL THEN NULL ELSE round(extract(epoch FROM (started_at - created_at)) * 1000)::bigint END AS queue_wait_ms, created_at, started_at, completed_at FROM ai_jobs ORDER BY created_at, id"
LISTINGS_QUERY='SELECT id, image_key, title, description, fun_line, category, price_eur, stand_number, seller_alias, created_at, sold_at FROM listings ORDER BY created_at, id'
ASSISTANT_SCANS_QUERY='SELECT id, session_id, analysis::text AS analysis, question_count, created_at FROM assistant_scans ORDER BY created_at, id'
METRIC_SNAPSHOTS_QUERY='SELECT captured_at, snapshot::text AS snapshot FROM metric_snapshots ORDER BY captured_at, id'

ops_log "export des données applicatives"
export_csv "events.csv" "$EVENTS_QUERY"
export_csv "ai_jobs.csv" "$AI_JOBS_QUERY"
export_csv "listings.csv" "$LISTINGS_QUERY"
export_csv "assistant_scans.csv" "$ASSISTANT_SCANS_QUERY"
export_csv "metric_snapshots.csv" "$METRIC_SNAPSHOTS_QUERY"

RUNTIME_CONFIG_PY='import json, os; keys = ("ENVIRONMENT", "AI_PROVIDER", "AI_ROUTING_MODE", "GEMINI_MODEL", "GEMINI_QUALITY_MODEL", "AI_FORCE_QUALITY_SCALE_UP", "HF_QWEN_MODEL", "HF_TIMEOUT_SECONDS", "HF_FALLBACK_MAX_ATTEMPTS", "MAX_AI_IN_FLIGHT", "MAX_FUN_IN_FLIGHT", "AI_JOB_TIMEOUT_SECONDS", "AI_WORKER_POLL_MS", "AI_JOB_RETENTION_HOURS", "MAX_UPLOAD_MB", "IMAGE_MAX_EDGE_PX", "IMAGE_JPEG_QUALITY", "IMAGE_WEBP_QUALITY"); payload = {key: os.getenv(key) for key in keys}; payload["fallback_configured"] = bool(os.getenv("HF_TOKEN")); print(json.dumps(payload))'
RUNTIME_CONFIG_PATH="$STAGING_DIR/metadata/.runtime-config.json"
if [[ "$ORIGIN" == "vps" ]]; then
  ops_ssh "$REMOTE_COMPOSE exec -T backend python -c '$RUNTIME_CONFIG_PY'" > "$RUNTIME_CONFIG_PATH"
else
  "${compose[@]}" exec -T backend python -c "$RUNTIME_CONFIG_PY" > "$RUNTIME_CONFIG_PATH"
fi

OPS_ACTIONS_PATH="$(ops_state_dir)/ops-actions.jsonl"
python3 "$ROOT_DIR/scripts/export_event_bundle.py" \
  --bundle-dir "$STAGING_DIR" \
  --ops-actions "$OPS_ACTIONS_PATH" \
  --runtime-config "$RUNTIME_CONFIG_PATH" \
  --event-date "$EVENT_DATE" \
  --source-origin "$ORIGIN" \
  --source-commit "$SOURCE_COMMIT" \
  --public-hostname "$BROCAI_PUBLIC_HOSTNAME" \
  --repo-root "$ROOT_DIR"

[[ -s "$STAGING_DIR/SHA256SUMS" ]] || ops_die "manifeste SHA-256 absent"
[[ ! -e "$FINAL_DIR" ]] || ops_die "bundle créé pendant l'export; publication refusée"
mv "$STAGING_DIR" "$FINAL_DIR"
CLEANUP_STAGING=0
ops_log "bundle événementiel publié: $FINAL_DIR"
