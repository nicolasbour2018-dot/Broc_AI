#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=ops-lib.sh
source "$ROOT_DIR/scripts/ops-lib.sh"

[[ "$(uname -s)" == "Darwin" ]] || ops_die "cet export doit être exécuté sur le Mac Ops/standby"
[[ $# -eq 3 ]] || ops_die "usage: $0 {events|listings|ai_jobs} {csv|json} OUTPUT"

DATASET="$1"
FORMAT="$2"
OUTPUT="$3"

case "$DATASET" in
  events)
    QUERY='SELECT id, session_id, event_name, created_at, properties::text AS properties FROM events ORDER BY created_at, id'
    ;;
  listings)
    QUERY='SELECT id, image_key, title, description, fun_line, category, price_eur, stand_number, seller_alias, created_at, sold_at FROM listings ORDER BY created_at, id'
    ;;
  ai_jobs)
    QUERY="SELECT id, session_id, feature, related_id, status, result ->> 'analysis_mode' AS analysis_mode, result::text AS result, error_code, error_message, attempts, duration_ms, CASE WHEN started_at IS NULL THEN NULL ELSE round(extract(epoch FROM (started_at - created_at)) * 1000)::bigint END AS queue_wait_ms, created_at, started_at, completed_at FROM ai_jobs ORDER BY created_at, id"
    ;;
  *)
    ops_die "dataset invalide: $DATASET"
    ;;
esac

case "$FORMAT" in
  csv|json) ;;
  *) ops_die "format invalide: $FORMAT" ;;
esac

ops_require_base
ops_require_cloudflare
mkdir -p "$(dirname "$OUTPUT")"

LOCK_HELD=0
TMP_JSON=""
cleanup() {
  local exit_code=$?
  [[ -n "$TMP_JSON" && -f "$TMP_JSON" ]] && rm -f -- "$TMP_JSON"
  if [[ "$LOCK_HELD" -eq 1 ]]; then
    ops_lock_release "operation" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

ops_lock_acquire "operation" "wait"
LOCK_HELD=1

ORIGIN="$(ops_route_origin)"
[[ "$ORIGIN" == "vps" || "$ORIGIN" == "mac" ]] || ops_die "origine publique indéterminée; export refusé"
REMOTE_COMPOSE="$(ops_compose_remote_prefix)"
APP_DIR="$(ops_standby_app_dir)"
ENV_FILE="$(ops_standby_env_file)"

if [[ "$ORIGIN" == "mac" ]]; then
  ops_need docker
  [[ -f "$ENV_FILE" && -f "$APP_DIR/docker-compose.prod.yml" ]] || ops_die "standby Mac incomplet"
  compose=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.prod.yml")
fi

run_copy() {
  local command="$1"
  if [[ "$ORIGIN" == "vps" ]]; then
    printf '%s\n' "$command" \
      | ops_ssh "$REMOTE_COMPOSE exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
  else
    printf '%s\n' "$command" \
      | "${compose[@]}" exec -T postgres sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi
}

if [[ "$FORMAT" == "csv" ]]; then
  run_copy "\\copy ($QUERY) TO STDOUT WITH (FORMAT CSV, HEADER true)" > "$OUTPUT"
else
  TMP_JSON="$(mktemp "${OUTPUT}.rows.XXXXXX")"
  run_copy "\\copy (SELECT row_to_json(export_row)::text FROM ($QUERY) AS export_row) TO STDOUT" > "$TMP_JSON"
  python3 - "$TMP_JSON" "$OUTPUT" <<'PY'
import json
from pathlib import Path
import sys

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
rows = []
for raw in source.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if line:
        rows.append(json.loads(line))
destination.write_text(
    json.dumps(rows, ensure_ascii=False, indent=2, default=str) + "\n",
    encoding="utf-8",
)
PY
fi

[[ -s "$OUTPUT" ]] || ops_die "export vide ou absent: $OUTPUT"
chmod 600 "$OUTPUT"
ops_record_action "dataset_export" "$DATASET/$FORMAT" "success" "origin=$ORIGIN"
ops_log "export $DATASET/$FORMAT prêt: $OUTPUT"
