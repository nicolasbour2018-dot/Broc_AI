#!/usr/bin/env python3
from __future__ import annotations

import hmac
import json
import os
import subprocess
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

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

ACTIONS: dict[str, tuple[str, str | None, int]] = {
    "sync": ("sync-standby.sh", None, 240),
    "restart-services": ("restart-vps-services.sh", "RESTART", 120),
    "restart-tunnel": ("restart-vps-tunnel.sh", "TUNNEL", 90),
    "reboot-vps": ("restart-vps.sh", "REBOOT", 300),
    "failover-mac": ("failover-to-mac.sh", "FAILOVER", 300),
    "failback-vps": ("failback-to-vps.sh", "FAILBACK", 420),
}


def run_script(name: str, timeout: int) -> dict[str, Any]:
    script = ROOT / "scripts" / name
    env = os.environ.copy()
    env["BROCAI_OPS_ENV_FILE"] = str(OPS_ENV_FILE)
    completed = subprocess.run(
        [str(script)],
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
        if self.path in {"/", "/index.html"}:
            body = INDEX.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/health":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if self.path == "/api/status":
            if not self.authorized():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"detail": "Token Ops invalide."})
                return
            result = run_script("ops-status.sh", 30)
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
        if not ACTION_LOCK.acquire(blocking=False):
            self.send_json(HTTPStatus.CONFLICT, {"detail": "Une action Ops est déjà en cours."})
            return
        try:
            try:
                result = run_script(script, timeout)
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
