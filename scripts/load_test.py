#!/usr/bin/env python3
"""BrocAI Step 7 load / resilience runner.

Standard-library only so it can be run from a Mac without installing a load-test
framework. It targets the isolated docker-compose.loadtest.yml stack by default.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import random
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "http://localhost:18000"
DEFAULT_ADMIN_TOKEN = "loadtest-only"
POLL_INTERVAL_SECONDS = 0.35
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg=="
)


@dataclass
class HttpResult:
    ok: bool
    status: int
    latency_ms: float
    error: str | None = None


@dataclass
class JobRef:
    id: str
    session_id: str


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(ordered[rank], 1)


def _http(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 20,
) -> tuple[HttpResult, bytes]:
    request = Request(
        base_url.rstrip("/") + path,
        data=body,
        method=method,
        headers=headers or {},
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = response.read()
            elapsed = (time.perf_counter() - started) * 1000
            return HttpResult(True, response.status, round(elapsed, 1)), payload
    except HTTPError as exc:
        payload = exc.read()
        elapsed = (time.perf_counter() - started) * 1000
        return HttpResult(False, exc.code, round(elapsed, 1), payload.decode("utf-8", "replace")[:300]), payload
    except (URLError, TimeoutError, OSError) as exc:
        elapsed = (time.perf_counter() - started) * 1000
        return HttpResult(False, 0, round(elapsed, 1), str(exc)[:300]), b""


def _json_request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 20,
) -> tuple[HttpResult, dict[str, Any] | None]:
    body = None
    final_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        final_headers["Content-Type"] = "application/json"
    result, raw = _http(base_url, path, method=method, headers=final_headers, body=body, timeout=timeout)
    if not raw:
        return result, None
    try:
        decoded = json.loads(raw)
        return result, decoded if isinstance(decoded, dict) else None
    except json.JSONDecodeError:
        return result, None


def _multipart_photo() -> tuple[bytes, str]:
    boundary = f"----brocai-{uuid.uuid4().hex}"
    chunks = [
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="photo"; filename="loadtest.png"\r\n',
        b"Content-Type: image/png\r\n\r\n",
        PNG_BYTES,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    return b"".join(chunks), boundary


def _submit_photo_job(base_url: str, endpoint: str, session_id: str, timeout: float) -> tuple[HttpResult, JobRef | None]:
    body, boundary = _multipart_photo()
    result, raw = _http(
        base_url,
        endpoint,
        method="POST",
        headers={
            "X-Session-ID": session_id,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        body=body,
        timeout=timeout,
    )
    if not result.ok:
        return result, None
    try:
        payload = json.loads(raw)
        return result, JobRef(id=str(payload["id"]), session_id=session_id)
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        result.ok = False
        result.error = f"Réponse job invalide: {exc}"
        return result, None


def _poll_job(base_url: str, job: JobRef, timeout: float) -> tuple[str, dict[str, Any] | None, list[HttpResult]]:
    deadline = time.monotonic() + timeout
    requests: list[HttpResult] = []
    while time.monotonic() < deadline:
        result, payload = _json_request(
            base_url,
            f"/api/ai/jobs/{job.id}",
            headers={"X-Session-ID": job.session_id},
            timeout=min(10, timeout),
        )
        requests.append(result)
        if result.ok and payload:
            status = str(payload.get("status"))
            if status in {"success", "error", "timeout"}:
                return status, payload, requests
        time.sleep(POLL_INTERVAL_SECONDS)
    return "poll_timeout", None, requests


def _summary(results: list[HttpResult]) -> dict[str, Any]:
    latencies = [item.latency_ms for item in results]
    ok_count = sum(1 for item in results if item.ok)
    statuses: dict[str, int] = {}
    for item in results:
        key = str(item.status)
        statuses[key] = statuses.get(key, 0) + 1
    return {
        "requests": len(results),
        "ok": ok_count,
        "failed": len(results) - ok_count,
        "success_rate_percent": round(ok_count / len(results) * 100, 2) if results else 0.0,
        "latency_ms": {
            "mean": round(statistics.fmean(latencies), 1) if latencies else None,
            "p50": _percentile(latencies, 0.50),
            "p95": _percentile(latencies, 0.95),
            "p99": _percentile(latencies, 0.99),
            "max": round(max(latencies), 1) if latencies else None,
        },
        "status_counts": statuses,
        "sample_errors": [item.error for item in results if item.error][:5],
    }


def _run_parallel(count: int, concurrency: int, fn: Callable[[int], HttpResult]) -> list[HttpResult]:
    results: list[HttpResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(fn, index) for index in range(count)]
        for future in as_completed(futures):
            results.append(future.result())
    return results


class AdminMonitor:
    def __init__(self, base_url: str, token: str, interval: float = 0.2) -> None:
        self.base_url = base_url
        self.token = token
        self.interval = interval
        self.samples: list[dict[str, Any]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="brocai-admin-monitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self) -> None:
        while not self._stop.is_set():
            result, payload = _json_request(
                self.base_url,
                "/api/admin/metrics",
                headers={"X-Admin-Token": self.token},
                timeout=5,
            )
            if result.ok and payload:
                self.samples.append(payload)
            self._stop.wait(self.interval)

    def summary(self) -> dict[str, Any]:
        queues = [sample.get("queue", {}) for sample in self.samples]
        systems = [sample.get("system", {}) for sample in self.samples]
        return {
            "samples": len(self.samples),
            "peak_queue": max((int(q.get("queued") or 0) for q in queues), default=0),
            "peak_running": max((int(q.get("running") or 0) for q in queues), default=0),
            "max_in_flight": max((int(q.get("max_in_flight") or 0) for q in queues), default=0),
            "peak_memory_usage_percent": max((float(s.get("memory_usage_percent") or 0) for s in systems), default=0.0),
            "peak_process_rss_mb": max((float(s.get("process_rss_mb") or 0) for s in systems), default=0.0),
            "peak_load_percent": max((float(s.get("load_percent_of_capacity") or 0) for s in systems), default=0.0),
        }


def scenario_catalogue(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    def worker(index: int) -> HttpResult:
        if index % 2:
            query = urlencode({"q": "lampe"})
            path = f"/api/listings?{query}"
        else:
            path = "/api/listings"
        return _http(args.base_url, path, headers={"X-Session-ID": f"load-cat-{uuid.uuid4()}"}, timeout=args.timeout)[0]

    started = time.perf_counter()
    results = _run_parallel(args.requests, args.concurrency, worker)
    elapsed = time.perf_counter() - started
    report = {"scenario": "catalogue", "elapsed_s": round(elapsed, 2), "throughput_rps": round(len(results) / elapsed, 2), **_summary(results)}
    return report, report["failed"] == 0


def scenario_mixed(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    def worker(index: int) -> HttpResult:
        sid = f"load-mixed-{index}-{uuid.uuid4()}"
        selector = index % 10
        if selector < 6:
            path = "/api/listings"
        elif selector < 9:
            path = "/api/listings?q=objet"
        else:
            path = "/health"
        return _http(args.base_url, path, headers={"X-Session-ID": sid}, timeout=args.timeout)[0]

    started = time.perf_counter()
    results = _run_parallel(args.sessions, args.concurrency, worker)
    elapsed = time.perf_counter() - started
    report = {"scenario": "mixed", "virtual_sessions": args.sessions, "elapsed_s": round(elapsed, 2), "throughput_rps": round(len(results) / elapsed, 2), **_summary(results)}
    return report, report["failed"] == 0


def _submit_jobs(args: argparse.Namespace, endpoint: str, count: int, concurrency: int) -> tuple[list[JobRef], list[HttpResult]]:
    refs: list[JobRef] = []
    results: list[HttpResult] = []
    lock = threading.Lock()

    def worker(index: int) -> None:
        sid = f"load-ai-{index}-{uuid.uuid4()}"
        result, ref = _submit_photo_job(args.base_url, endpoint, sid, args.timeout)
        with lock:
            results.append(result)
            if ref:
                refs.append(ref)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, index) for index in range(count)]
        for future in as_completed(futures):
            future.result()
    return refs, results


def scenario_queue_burst(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    monitor = AdminMonitor(args.base_url, args.admin_token)
    monitor.start()
    started = time.perf_counter()
    refs, submit_results = _submit_jobs(args, "/api/assistant/analyze", args.count, args.concurrency)

    if args.submit_only:
        time.sleep(0.5)
        monitor.stop()
        jobs_path = Path(args.jobs_file)
        jobs_path.parent.mkdir(parents=True, exist_ok=True)
        jobs_path.write_text(json.dumps([asdict(item) for item in refs], indent=2), encoding="utf-8")
        report = {
            "scenario": "queue-burst-submit-only",
            "submitted_jobs": len(refs),
            "jobs_file": str(jobs_path),
            "submit_http": _summary(submit_results),
            "monitor": monitor.summary(),
        }
        return report, len(refs) == args.count and report["submit_http"]["failed"] == 0

    terminal: dict[str, int] = {}
    poll_results: list[HttpResult] = []
    lock = threading.Lock()

    def poll(ref: JobRef) -> None:
        status, _, requests = _poll_job(args.base_url, ref, args.job_timeout)
        with lock:
            terminal[status] = terminal.get(status, 0) + 1
            poll_results.extend(requests)

    with ThreadPoolExecutor(max_workers=min(args.concurrency, max(1, len(refs)))) as pool:
        futures = [pool.submit(poll, ref) for ref in refs]
        for future in as_completed(futures):
            future.result()

    monitor.stop()
    elapsed = time.perf_counter() - started
    monitor_summary = monitor.summary()
    report = {
        "scenario": "queue-burst",
        "elapsed_s": round(elapsed, 2),
        "submitted_jobs": len(refs),
        "terminal_statuses": terminal,
        "submit_http": _summary(submit_results),
        "poll_http": _summary(poll_results),
        "monitor": monitor_summary,
    }
    expected_count = terminal.get(args.expect, 0)
    queue_ok = monitor_summary["peak_queue"] >= args.min_peak_queue
    running_ok = monitor_summary["max_in_flight"] > 0 and monitor_summary["peak_running"] <= monitor_summary["max_in_flight"]
    ok = (
        len(refs) == args.count
        and report["submit_http"]["failed"] == 0
        and expected_count == args.count
        and queue_ok
        and running_ok
    )
    report["checks"] = {
        "all_submitted": len(refs) == args.count,
        f"all_terminal_{args.expect}": expected_count == args.count,
        "peak_queue_at_least_requested": queue_ok,
        "running_never_exceeds_limit": running_ok,
    }
    return report, ok


def scenario_resume(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    refs_raw = json.loads(Path(args.jobs_file).read_text(encoding="utf-8"))
    refs = [JobRef(id=item["id"], session_id=item["session_id"]) for item in refs_raw]
    terminal: dict[str, int] = {}
    requests: list[HttpResult] = []
    lock = threading.Lock()

    def worker(ref: JobRef) -> None:
        status, _, poll_requests = _poll_job(args.base_url, ref, args.job_timeout)
        with lock:
            terminal[status] = terminal.get(status, 0) + 1
            requests.extend(poll_requests)

    with ThreadPoolExecutor(max_workers=min(args.concurrency, max(1, len(refs)))) as pool:
        futures = [pool.submit(worker, ref) for ref in refs]
        for future in as_completed(futures):
            future.result()
    report = {
        "scenario": "resume",
        "jobs": len(refs),
        "terminal_statuses": terminal,
        "poll_http": _summary(requests),
    }
    return report, terminal.get(args.expect, 0) == len(refs)


def scenario_seller_flow(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    request_results: list[HttpResult] = []
    workflow_statuses: dict[str, int] = {}
    lock = threading.Lock()

    def worker(index: int) -> None:
        sid = f"load-seller-{index}-{uuid.uuid4()}"
        submit_result, ref = _submit_photo_job(args.base_url, "/api/seller/analyze", sid, args.timeout)
        local_requests = [submit_result]
        workflow = "submit_failed"
        if ref:
            terminal, payload, polls = _poll_job(args.base_url, ref, args.job_timeout)
            local_requests.extend(polls)
            workflow = terminal
            if terminal == "success" and payload and isinstance(payload.get("result"), dict):
                analysis = payload["result"]
                listing_payload = {
                    "image_key": analysis["image_key"],
                    "title": analysis["title"],
                    "description": analysis["description"],
                    "fun_line": analysis.get("fun_line"),
                    "category": analysis["category"],
                    "price_eur": analysis["suggested_price_eur"],
                    "stand_number": f"LT-{index}",
                    "seller_alias": "loadtest",
                }
                publish_result, _ = _json_request(
                    args.base_url,
                    "/api/listings",
                    method="POST",
                    headers={"X-Session-ID": sid},
                    payload=listing_payload,
                    timeout=args.timeout,
                )
                local_requests.append(publish_result)
                workflow = "published" if publish_result.ok else "publish_failed"
        with lock:
            request_results.extend(local_requests)
            workflow_statuses[workflow] = workflow_statuses.get(workflow, 0) + 1

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(worker, index) for index in range(args.count)]
        for future in as_completed(futures):
            future.result()
    elapsed = time.perf_counter() - started
    report = {
        "scenario": "seller-flow",
        "workflows": args.count,
        "elapsed_s": round(elapsed, 2),
        "workflow_statuses": workflow_statuses,
        "http": _summary(request_results),
    }
    return report, workflow_statuses.get("published", 0) == args.count


def scenario_soak(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    monitor = AdminMonitor(args.base_url, args.admin_token, interval=1.0)
    monitor.start()
    deadline = time.monotonic() + args.duration
    results: list[HttpResult] = []
    lock = threading.Lock()

    def worker(worker_id: int) -> None:
        rng = random.Random(worker_id)
        local: list[HttpResult] = []
        while time.monotonic() < deadline:
            if rng.random() < 0.35:
                path = "/api/listings?q=objet"
            else:
                path = "/api/listings"
            local.append(_http(args.base_url, path, headers={"X-Session-ID": f"soak-{worker_id}"}, timeout=args.timeout)[0])
            time.sleep(args.pause)
        with lock:
            results.extend(local)

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(worker, index) for index in range(args.concurrency)]
        for future in as_completed(futures):
            future.result()
    elapsed = time.perf_counter() - started
    monitor.stop()
    report = {
        "scenario": "soak",
        "duration_s": round(elapsed, 2),
        "throughput_rps": round(len(results) / elapsed, 2) if elapsed else 0,
        "http": _summary(results),
        "monitor": monitor.summary(),
    }
    return report, report["http"]["failed"] == 0


def _write_report(report: dict[str, Any], output: str | None) -> None:
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if output:
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        print(f"\nRapport écrit dans {path}")


def _base_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="BrocAI Step 7 load/resilience runner")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--output", default=None)
    sub = parser.add_subparsers(dest="scenario", required=True)

    catalogue = sub.add_parser("catalogue")
    catalogue.add_argument("--requests", type=int, default=1000)
    catalogue.add_argument("--concurrency", type=int, default=150)

    mixed = sub.add_parser("mixed")
    mixed.add_argument("--sessions", type=int, default=150)
    mixed.add_argument("--concurrency", type=int, default=150)

    queue = sub.add_parser("queue-burst")
    queue.add_argument("--count", type=int, default=60)
    queue.add_argument("--concurrency", type=int, default=60)
    queue.add_argument("--admin-token", default=DEFAULT_ADMIN_TOKEN)
    queue.add_argument("--job-timeout", type=float, default=90)
    queue.add_argument("--expect", choices=["success", "error", "timeout"], default="success")
    queue.add_argument("--min-peak-queue", type=int, default=20)
    queue.add_argument("--submit-only", action="store_true")
    queue.add_argument("--jobs-file", default="load-test-results/restart-jobs.json")

    resume = sub.add_parser("resume")
    resume.add_argument("--jobs-file", default="load-test-results/restart-jobs.json")
    resume.add_argument("--concurrency", type=int, default=30)
    resume.add_argument("--job-timeout", type=float, default=120)
    resume.add_argument("--expect", choices=["success", "error", "timeout"], default="success")

    seller = sub.add_parser("seller-flow")
    seller.add_argument("--count", type=int, default=30)
    seller.add_argument("--concurrency", type=int, default=20)
    seller.add_argument("--job-timeout", type=float, default=90)

    soak = sub.add_parser("soak")
    soak.add_argument("--duration", type=int, default=600)
    soak.add_argument("--concurrency", type=int, default=30)
    soak.add_argument("--pause", type=float, default=0.1)
    soak.add_argument("--admin-token", default=DEFAULT_ADMIN_TOKEN)
    return parser


def main() -> int:
    parser = _base_parser()
    args = parser.parse_args()
    if args.scenario == "catalogue":
        report, ok = scenario_catalogue(args)
    elif args.scenario == "mixed":
        report, ok = scenario_mixed(args)
    elif args.scenario == "queue-burst":
        report, ok = scenario_queue_burst(args)
    elif args.scenario == "resume":
        report, ok = scenario_resume(args)
    elif args.scenario == "seller-flow":
        report, ok = scenario_seller_flow(args)
    elif args.scenario == "soak":
        report, ok = scenario_soak(args)
    else:
        parser.error("Scénario inconnu")
        return 2
    report["passed"] = ok
    _write_report(report, args.output)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
