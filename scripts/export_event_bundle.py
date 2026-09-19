#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any


RAW_HEADERS = {
    "events.csv": ["id", "session_id", "event_name", "created_at", "properties"],
    "ai_jobs.csv": [
        "id",
        "session_id",
        "feature",
        "related_id",
        "status",
        "analysis_mode",
        "result",
        "error_code",
        "error_message",
        "attempts",
        "duration_ms",
        "queue_wait_ms",
        "created_at",
        "started_at",
        "completed_at",
    ],
    "listings.csv": [
        "id",
        "image_key",
        "title",
        "description",
        "fun_line",
        "category",
        "price_eur",
        "stand_number",
        "seller_alias",
        "created_at",
        "sold_at",
    ],
    "assistant_scans.csv": ["id", "session_id", "analysis", "question_count", "created_at"],
    "metric_snapshots.csv": ["captured_at", "snapshot"],
}
SYSTEM_HEADERS = [
    "timestamp",
    "cpu_load_percent_of_capacity",
    "ram_usage_percent",
    "disk_usage_percent",
]
PROVIDER_HEADERS = [
    "timestamp",
    "provider",
    "model",
    "routing_mode",
    "rpm",
    "errors_last_minute",
    "timeouts_last_minute",
    "rate_limits_429_last_minute",
    "tokens",
    "estimated_cost_usd",
    "fallback_state",
]
LOAD_HEADERS = [
    "timestamp",
    "active_sessions",
    "queued_core",
    "queued_fun",
    "running_core",
    "running_fun",
    "core_wait_p50_ms",
    "core_wait_p95_ms",
    "fun_wait_p50_ms",
    "fun_wait_p95_ms",
    "inference_p50_ms",
    "inference_p95_ms",
    "load_state",
    "fun_cooldown_seconds",
]
OPS_HEADERS = ["timestamp", "actor", "action", "target", "result"]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--ops-actions", type=Path, required=True)
    parser.add_argument("--runtime-config", type=Path, required=True)
    parser.add_argument("--event-date", required=True)
    parser.add_argument("--source-origin", choices=("vps", "mac"), required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--public-hostname", required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    return parser.parse_args()


def write_csv(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path, expected_headers: list[str]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != expected_headers:
            raise ValueError(f"Unexpected CSV headers in {path.name}: {reader.fieldnames!r}")
        return list(reader)


def build_metric_exports(bundle_dir: Path) -> None:
    rows = read_csv(bundle_dir / "raw" / "metric_snapshots.csv", RAW_HEADERS["metric_snapshots.csv"])
    system_rows: list[dict[str, Any]] = []
    provider_rows: list[dict[str, Any]] = []
    load_rows: list[dict[str, Any]] = []
    for row in rows:
        snapshot = json.loads(row["snapshot"])
        if not isinstance(snapshot, dict):
            raise ValueError("Metric snapshot must be a JSON object")
        timestamp = snapshot.get("timestamp") or row["captured_at"]
        system_rows.append({key: snapshot.get(key) for key in SYSTEM_HEADERS} | {"timestamp": timestamp})
        provider_rows.append({key: snapshot.get(key) for key in PROVIDER_HEADERS} | {"timestamp": timestamp})
        load_rows.append({key: snapshot.get(key) for key in LOAD_HEADERS} | {"timestamp": timestamp})

    snapshots_dir = bundle_dir / "snapshots"
    write_csv(snapshots_dir / "system_metrics.csv", SYSTEM_HEADERS, system_rows)
    write_csv(snapshots_dir / "provider_metrics.csv", PROVIDER_HEADERS, provider_rows)
    write_csv(snapshots_dir / "load_states.csv", LOAD_HEADERS, load_rows)


def build_ops_actions(bundle_dir: Path, source_path: Path) -> None:
    rows: list[dict[str, Any]] = []
    if source_path.exists():
        with source_path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                payload = json.loads(line)
                if not isinstance(payload, dict):
                    raise ValueError(f"Invalid Ops action at line {line_number}")
                row: dict[str, Any] = {}
                for field in OPS_HEADERS:
                    value = payload.get(field)
                    if value is not None and not isinstance(value, (str, int, float, bool)):
                        raise ValueError(f"Invalid Ops action field {field!r} at line {line_number}")
                    row[field] = value
                rows.append(row)
    write_csv(bundle_dir / "raw" / "ops_actions.csv", OPS_HEADERS, rows)


def load_pricing(repo_root: Path, model_ids: set[str]) -> list[dict[str, Any]]:
    pricing: list[dict[str, Any]] = []
    for relative_path in ("benchmarks/step10/models.json", "benchmarks/step10/candidates_e.json"):
        source_path = repo_root / relative_path
        entries = json.loads(source_path.read_text(encoding="utf-8"))
        for entry in entries:
            model_id = entry.get("model_id")
            if model_id not in model_ids:
                continue
            pricing.append(
                {
                    "provider": entry.get("provider"),
                    "route": entry.get("route"),
                    "model_id": model_id,
                    "pricing_usd_per_million_tokens": entry.get("pricing_usd_per_million_tokens"),
                    "pricing_scope": entry.get("pricing_scope"),
                    "source": relative_path,
                }
            )
    return pricing


def optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def optional_bool(value: Any) -> bool | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return value
    lowered = str(value).strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Invalid boolean configuration value: {value!r}")


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_metadata(args: argparse.Namespace, exported_at: str) -> None:
    runtime_config = json.loads(args.runtime_config.read_text(encoding="utf-8"))
    if not isinstance(runtime_config, dict):
        raise ValueError("Runtime configuration must be a JSON object")
    args.runtime_config.unlink()

    metadata_dir = args.bundle_dir / "metadata"
    write_json(
        metadata_dir / "deployment.json",
        {
            "bundle_format_version": 1,
            "event_date": args.event_date,
            "exported_at": exported_at,
            "source_origin": args.source_origin,
            "source_commit": args.source_commit,
            "public_hostname": args.public_hostname,
            "environment": runtime_config.get("ENVIRONMENT"),
        },
    )
    write_json(
        metadata_dir / "models.json",
        {
            "captured_at": exported_at,
            "configured_provider": runtime_config.get("AI_PROVIDER"),
            "routing_mode": runtime_config.get("AI_ROUTING_MODE"),
            "primary_model": runtime_config.get("GEMINI_MODEL"),
            "quality_model": runtime_config.get("GEMINI_QUALITY_MODEL"),
            "quality_scale_up_enabled": optional_bool(runtime_config.get("AI_FORCE_QUALITY_SCALE_UP")),
            "fallback_model": runtime_config.get("HF_QWEN_MODEL"),
            "fallback_configured": bool(runtime_config.get("fallback_configured")),
        },
    )
    write_json(
        metadata_dir / "thresholds.json",
        {
            "captured_at": exported_at,
            "max_ai_in_flight": optional_int(runtime_config.get("MAX_AI_IN_FLIGHT")),
            "max_fun_in_flight": optional_int(runtime_config.get("MAX_FUN_IN_FLIGHT")),
            "ai_job_timeout_seconds": optional_int(runtime_config.get("AI_JOB_TIMEOUT_SECONDS")),
            "ai_worker_poll_ms": optional_int(runtime_config.get("AI_WORKER_POLL_MS")),
            "ai_job_retention_hours": optional_int(runtime_config.get("AI_JOB_RETENTION_HOURS")),
            "provider_timeout_seconds": optional_int(runtime_config.get("HF_TIMEOUT_SECONDS")),
            "fallback_max_attempts": optional_int(runtime_config.get("HF_FALLBACK_MAX_ATTEMPTS")),
            "max_upload_mb": optional_int(runtime_config.get("MAX_UPLOAD_MB")),
            "image_max_edge_px": optional_int(runtime_config.get("IMAGE_MAX_EDGE_PX")),
            "image_jpeg_quality": optional_int(runtime_config.get("IMAGE_JPEG_QUALITY")),
            "image_webp_quality": optional_int(runtime_config.get("IMAGE_WEBP_QUALITY")),
            "fun_cooldown_seconds": None,
        },
    )
    model_ids = {
        str(model_id)
        for model_id in (
            runtime_config.get("GEMINI_MODEL"),
            runtime_config.get("GEMINI_QUALITY_MODEL"),
            runtime_config.get("HF_QWEN_MODEL"),
        )
        if model_id
    }
    write_json(
        metadata_dir / "pricing_snapshot.json",
        {
            "captured_at": exported_at,
            "currency": "USD",
            "models": load_pricing(args.repo_root, model_ids),
        },
    )


def neutralize_formula(value: str) -> str:
    stripped = value.lstrip(" ")
    if stripped.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def sanitize_csv(path: Path) -> int:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        raise ValueError(f"CSV has no header: {path}")
    sanitized = [[neutralize_formula(value) for value in row] for row in rows]
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(sanitized)
    return max(0, len(rows) - 1)


def validate_upload_archive(path: Path) -> None:
    with tarfile.open(path, "r:*") as archive:
        for member in archive.getmembers():
            member_path = PurePosixPath(member.name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise ValueError(f"Unsafe upload archive member: {member.name!r}")
            if not (member.isdir() or member.isfile()):
                raise ValueError(f"Unsupported upload archive member: {member.name!r}")


def validate_bundle(bundle_dir: Path) -> dict[str, int]:
    expected_files = [
        bundle_dir / "raw" / "postgres.dump",
        bundle_dir / "raw" / "uploads.tar",
        *(bundle_dir / "raw" / name for name in (*RAW_HEADERS.keys(), "ops_actions.csv")),
        bundle_dir / "snapshots" / "system_metrics.csv",
        bundle_dir / "snapshots" / "provider_metrics.csv",
        bundle_dir / "snapshots" / "load_states.csv",
        bundle_dir / "metadata" / "deployment.json",
        bundle_dir / "metadata" / "models.json",
        bundle_dir / "metadata" / "thresholds.json",
        bundle_dir / "metadata" / "pricing_snapshot.json",
    ]
    for path in expected_files:
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing or empty bundle file: {path.relative_to(bundle_dir)}")
    if (bundle_dir / "raw" / "postgres.dump").read_bytes()[:5] != b"PGDMP":
        raise ValueError("PostgreSQL dump does not use the expected custom format")
    validate_upload_archive(bundle_dir / "raw" / "uploads.tar")

    csv_rows: dict[str, int] = {}
    for path in sorted(bundle_dir.rglob("*.csv")):
        csv_rows[path.relative_to(bundle_dir).as_posix()] = sanitize_csv(path)
    return csv_rows


def apply_private_modes(bundle_dir: Path) -> None:
    for path in bundle_dir.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink in bundle: {path.relative_to(bundle_dir)}")
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
    os.chmod(bundle_dir, 0o700)


def write_manifest(bundle_dir: Path) -> None:
    lines: list[str] = []
    for path in sorted(bundle_dir.rglob("*")):
        if not path.is_file() or path.name == "SHA256SUMS":
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.relative_to(bundle_dir).as_posix()}")
    (bundle_dir / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(bundle_dir / "SHA256SUMS", 0o600)


def main() -> None:
    args = parse_args()
    exported_at = dt.datetime.now(dt.timezone.utc).isoformat()
    for filename, headers in RAW_HEADERS.items():
        read_csv(args.bundle_dir / "raw" / filename, headers)
    build_metric_exports(args.bundle_dir)
    build_ops_actions(args.bundle_dir, args.ops_actions)
    build_metadata(args, exported_at)
    csv_rows = validate_bundle(args.bundle_dir)
    write_json(
        args.bundle_dir / "reports" / "bundle-summary.json",
        {
            "event_date": args.event_date,
            "exported_at": exported_at,
            "source_origin": args.source_origin,
            "csv_data_rows": csv_rows,
            "not_collected": [
                "active_sessions",
                "tokens",
                "estimated_cost_usd",
                "fun_cooldown_seconds",
            ],
            "notes": {
                "cpu": "One-minute system load expressed as a percentage of CPU capacity, not sampled CPU utilization.",
                "provider": "Provider and model reflect the most recent identifiable successful AI result.",
                "ops_actions": "Only timestamp, actor, action, target and result are retained from the local Ops JSONL.",
            },
        },
    )
    apply_private_modes(args.bundle_dir)
    write_manifest(args.bundle_dir)


if __name__ == "__main__":
    main()
