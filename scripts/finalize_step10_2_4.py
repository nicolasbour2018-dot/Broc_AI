#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def is_credit_402(result: dict[str, Any]) -> bool:
    error = str(result.get("error") or "")
    return error.startswith("HTTP 402:") and "depleted" in error.lower()


def is_success(result: dict[str, Any]) -> bool:
    return bool(
        result.get("request_success")
        and result.get("structured_output_valid")
        and isinstance(result.get("parsed_output"), dict)
    )


def normalize(report: dict[str, Any]) -> dict[str, Any]:
    results = report.get("results") or []

    for result in results:
        if is_credit_402(result):
            result["execution_status"] = "not_executed_credit_exhausted"
        elif result.get("request_success"):
            result["execution_status"] = "executed"
        else:
            result["execution_status"] = "executed_failed"

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        grouped[result["model_key"]].append(result)

    summary: dict[str, dict[str, Any]] = {}
    for model_key, planned in sorted(grouped.items()):
        executed = [
            result
            for result in planned
            if result["execution_status"] != "not_executed_credit_exhausted"
        ]
        successes = [result for result in executed if is_success(result)]
        not_executed = len(planned) - len(executed)

        summary[model_key] = {
            "calls_planned": len(planned),
            "calls_executed": len(executed),
            "not_executed_credit_exhausted": not_executed,
            "structured_success": len(successes),
            "success_rate_executed": (
                len(successes) / len(executed)
                if executed
                else None
            ),
            "mean_latency_ms_success": (
                sum(float(result["latency_ms"]) for result in successes)
                / len(successes)
                if successes
                else None
            ),
            "estimated_paid_cost_usd_success_mean": (
                sum(
                    float(result.get("estimated_paid_cost_usd") or 0)
                    for result in successes
                )
                / len(successes)
                if successes
                else None
            ),
        }

    report["objective_summary_normalized"] = summary
    report["normalization_note"] = (
        "HTTP 402 caused by depleted Hugging Face included credits is "
        "classified as not executed, not as a model failure."
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Normalize BrocAI Step 10.2.4-E benchmark metrics."
    )
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "benchmarks/step10/results/"
            "multimodal-candidates-final-normalized.json"
        ),
    )
    args = parser.parse_args()

    report = normalize(load_json(args.report))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("=== NORMALIZED OBJECTIVE SUMMARY ===")
    for model_key, metrics in report[
        "objective_summary_normalized"
    ].items():
        success_rate = metrics["success_rate_executed"]
        rate_text = (
            f"{success_rate * 100:.1f}%"
            if success_rate is not None
            else "n/a"
        )
        print(
            f"{model_key}: "
            f"{metrics['structured_success']}/"
            f"{metrics['calls_executed']} executed successful | "
            f"{metrics['not_executed_credit_exhausted']} not executed | "
            f"{rate_text}"
        )

    print(f"Output : {args.output}")
    print("API calls : 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
