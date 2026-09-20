#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hmac
import json
import os
import subprocess
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
INDEX = Path(__file__).with_name("index.html")
OPS_ENV_FILE = Path(os.environ.get("BROCAI_OPS_ENV_FILE", Path.home() / ".config/brocai/ops.env"))


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        value = value.replace("$HOME", str(Path.home()))
        values[key.strip()] = value
    return values


CONFIG = load_env_file(OPS_ENV_FILE)
OPS_TOKEN = CONFIG.get("BROCAI_OPS_TOKEN", "")
BIND_HOST = CONFIG.get("BROCAI_OPS_BIND_HOST", "127.0.0.1")
PORT = int(CONFIG.get("BROCAI_OPS_PORT", "8765"))
ACTION_LOCK = threading.Lock()

ACTIONS: dict[str, tuple[str, str | None, int | None]] = {
    "sync": ("sync-standby.sh", None, None),
    "restart-services": ("restart-vps-services.sh", "RESTART", 120),
    "restart-tunnel": ("restart-vps-tunnel.sh", "TUNNEL", 90),
    "reboot-vps": ("restart-vps.sh", "REBOOT", 300),
    "failover-mac": ("failover-to-mac.sh", "FAILOVER", None),
    "failback-vps": ("failback-to-vps.sh", "FAILBACK", None),
    "export-bundle": ("export-event-bundle.sh", "EXPORT", None),
}

EXPORT_DATASETS = {"events", "listings", "ai_jobs"}
EXPORT_FORMATS = {"csv", "json"}


def run_script(name: str, timeout: int | None, *args: str) -> dict[str, Any]:
    script = ROOT / "scripts" / name
    env = os.environ.copy()
    env["BROCAI_OPS_ENV_FILE"] = str(OPS_ENV_FILE)
    completed = subprocess.run(
        [str(script), *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout + completed.stderr).strip()
    if len(output) > 12000:
        output = output[-12000:]
    return {"ok": completed.returncode == 0, "returncode": completed.returncode, "output": output}


class Handler(BaseHTTPRequestHandler):
    server_version = "BrocAIOps/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[brocai-ops-http] {self.address_string()} {fmt % args}")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_download(self, path: Path, filename: str, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        supplied = self.headers.get("X-Ops-Token", "")
        return bool(OPS_TOKEN) and hmac.compare_digest(supplied, OPS_TOKEN)

    def read_json(self) -> dict[str, Any]:
        try:
            size = min(int(self.headers.get("Content-Length", "0")), 4096)
        except ValueError:
            size = 0
        if size <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(size))
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            body = INDEX.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/health":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if parsed.path == "/api/status":
            if not self.authorized():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"detail": "Token Ops invalide."})
                return
            result = run_script("ops-status.sh", 30, "--json")
            if not result["ok"]:
                self.send_json(HTTPStatus.BAD_GATEWAY, result)
                return
            try:
                payload = json.loads(result["output"].splitlines()[-1])
            except (json.JSONDecodeError, IndexError):
                self.send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "output": result["output"]})
                return
            self.send_json(HTTPStatus.OK, payload)
            return
        if parsed.path == "/api/exports/dataset":
            if not self.authorized():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"detail": "Token Ops invalide."})
                return
            query = parse_qs(parsed.query)
            dataset = (query.get("dataset") or [""])[0]
            export_format = (query.get("format") or [""])[0]
            if dataset not in EXPORT_DATASETS or export_format not in EXPORT_FORMATS:
                self.send_json(HTTPStatus.BAD_REQUEST, {"detail": "Dataset ou format d’export invalide."})
                return
            if not ACTION_LOCK.acquire(blocking=False):
                self.send_json(HTTPStatus.CONFLICT, {"detail": "Une action Ops est déjà en cours."})
                return
            try:
                suffix = "csv" if export_format == "csv" else "json"
                stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
                filename = f"brocai-{dataset}-{stamp}.{suffix}"
                with tempfile.TemporaryDirectory(prefix="brocai-ops-export-") as tmp:
                    output = Path(tmp) / filename
                    try:
                        result = run_script(
                            "export-ops-dataset.sh",
                            120,
                            dataset,
                            export_format,
                            str(output),
                        )
                    except subprocess.TimeoutExpired:
                        self.send_json(
                            HTTPStatus.GATEWAY_TIMEOUT,
                            {"ok": False, "detail": "Export Ops expiré."},
                        )
                        return
                    if not result["ok"] or not output.is_file():
                        self.send_json(HTTPStatus.BAD_GATEWAY, result)
                        return
                    content_type = (
                        "text/csv; charset=utf-8"
                        if export_format == "csv"
                        else "application/json; charset=utf-8"
                    )
                    self.send_download(output, filename, content_type)
            finally:
                ACTION_LOCK.release()
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"detail": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/api/actions/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"detail": "Not found"})
            return
        if not self.authorized():
            self.send_json(HTTPStatus.UNAUTHORIZED, {"detail": "Token Ops invalide."})
            return
        action = self.path.rsplit("/", 1)[-1]
        spec = ACTIONS.get(action)
        if spec is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"detail": "Action inconnue."})
            return
        script, required_confirmation, timeout = spec
        payload = self.read_json()
        if required_confirmation and payload.get("confirm") != required_confirmation:
            self.send_json(HTTPStatus.BAD_REQUEST, {"detail": f"Confirmation {required_confirmation} requise."})
            return
        args: list[str] = []
        if action == "export-bundle":
            event_date = str(payload.get("event_date", "")).strip()
            try:
                parsed_date = dt.date.fromisoformat(event_date)
            except ValueError:
                self.send_json(HTTPStatus.BAD_REQUEST, {"detail": "Date événement invalide."})
                return
            if parsed_date.isoformat() != event_date:
                self.send_json(HTTPStatus.BAD_REQUEST, {"detail": "Date événement invalide."})
                return
            args.append(event_date)
        if not ACTION_LOCK.acquire(blocking=False):
            self.send_json(HTTPStatus.CONFLICT, {"detail": "Une action Ops est déjà en cours."})
            return
        try:
            try:
                result = run_script(script, timeout, *args)
            except subprocess.TimeoutExpired:
                self.send_json(HTTPStatus.GATEWAY_TIMEOUT, {"ok": False, "detail": "Action Ops expirée."})
                return
            code = HTTPStatus.OK if result["ok"] else HTTPStatus.BAD_GATEWAY
            self.send_json(code, result)
        finally:
            ACTION_LOCK.release()


def main() -> None:
    if not OPS_TOKEN:
        raise SystemExit(f"BROCAI_OPS_TOKEN absent de {OPS_ENV_FILE}")
    server = ThreadingHTTPServer((BIND_HOST, PORT), Handler)
    print(f"[brocai-ops] control plane on http://{BIND_HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
