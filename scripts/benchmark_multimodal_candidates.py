#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import copy
import json
import mimetypes
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from benchmark_ai import DEFAULT_RESULTS_DIR, load_env_file, load_json
from benchmark_gemini_pilot import (
    PILOT_TASKS,
    prompt_for,
    schema_for,
    validate_structured_output,
)

HF_ENDPOINT = "https://router.huggingface.co/v1/chat/completions"
DEFAULT_CANDIDATES = Path("benchmarks/step10/candidates_e.json")


def strict_schema_for(task: str) -> dict[str, Any]:
    schema = copy.deepcopy(schema_for(task))
    schema["additionalProperties"] = False
    return schema


def image_data_url(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError(
            f"Format image non pris en charge : {path} ({mime_type})"
        )
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def load_visual_cases(path: Path) -> list[dict[str, Any]]:
    cases = load_json(path)
    selected = [
        case
        for case in cases
        if case.get("task") in PILOT_TASKS
    ]
    expected = {
        "seller-common-001",
        "seller-ambiguous-001",
        "seller-collectible-001",
        "assistant-common-001",
        "assistant-ambiguous-001",
        "assistant-collectible-001",
    }
    found = {case.get("case_id") for case in selected}
    if found != expected:
        raise SystemExit(
            "Le corpus visuel seller/assistant n'est pas celui attendu."
        )
    return sorted(selected, key=lambda item: item["case_id"])


def load_hf_candidates(path: Path) -> list[dict[str, Any]]:
    candidates = load_json(path)
    required = {"qwen_hf", "llama_scout_hf"}
    found = {candidate.get("key") for candidate in candidates}
    if found != required:
        raise SystemExit(
            f"Candidats HF inattendus : {sorted(found)}"
        )
    return sorted(candidates, key=lambda item: item["key"])


def successful(result: dict[str, Any]) -> bool:
    return bool(
        result.get("request_success")
        and result.get("structured_output_valid")
        and isinstance(result.get("parsed_output"), dict)
    )


def load_gemini_reference(
    report_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    report = load_json(report_path)
    baseline = [
        result
        for result in report.get("results", [])
        if result.get("model_key") == "gemini_baseline"
    ]
    quality = [
        result
        for result in report.get("results", [])
        if result.get("model_key") == "gemini_quality"
    ]

    expected_cases = {
        "seller-common-001",
        "seller-ambiguous-001",
        "seller-collectible-001",
        "assistant-common-001",
        "assistant-ambiguous-001",
        "assistant-collectible-001",
    }
    baseline_cases = {result.get("case_id") for result in baseline}

    if baseline_cases != expected_cases or len(baseline) != 6:
        raise SystemExit(
            "Le rapport Gemini ne contient pas les 6 résultats baseline attendus."
        )
    if not all(successful(result) for result in baseline):
        raise SystemExit(
            "Les 6 résultats Gemini 3.5 de référence doivent être valides."
        )

    return baseline, quality


def build_hf_payload(
    candidate: dict[str, Any],
    case: dict[str, Any],
    image_path: Path,
) -> dict[str, Any]:
    return {
        "model": candidate["model_id"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_for(case["task"])},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_data_url(image_path),
                        },
                    },
                ],
            }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": f"brocai_{case['task']}",
                "schema": strict_schema_for(case["task"]),
                "strict": True,
            },
        },
        "stream": False,
    }


def estimate_cost(
    candidate: dict[str, Any],
    usage: dict[str, Any],
) -> tuple[int, int, float]:
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    pricing = candidate["pricing_usd_per_million_tokens"]
    cost = (
        input_tokens * float(pricing["input"])
        + output_tokens * float(pricing["output"])
    ) / 1_000_000
    return input_tokens, output_tokens, cost


def call_hf(
    token: str,
    candidate: dict[str, Any],
    case: dict[str, Any],
    timeout_seconds: int,
    max_attempts: int = 3,
) -> dict[str, Any]:
    image_paths = case.get("image_paths") or []
    if len(image_paths) != 1:
        raise ValueError(
            f"{case['case_id']}: exactement une image est attendue."
        )

    image_path = Path(image_paths[0])
    if not image_path.is_file():
        raise FileNotFoundError(f"Image introuvable : {image_path}")

    payload = build_hf_payload(candidate, case, image_path)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    started = time.perf_counter()
    attempt = 0

    while attempt < max_attempts:
        attempt += 1
        request = Request(
            HF_ENDPOINT,
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                response_body = response.read().decode("utf-8")

            elapsed_ms = round(
                (time.perf_counter() - started) * 1000,
                1,
            )
            data = json.loads(response_body)
            choices = data.get("choices") or []
            if not choices:
                raise ValueError("Réponse HF sans choices.")

            raw_text = choices[0].get("message", {}).get("content", "")
            parsed_output: Any = None
            parsed_ok = False
            try:
                parsed_output = json.loads(raw_text)
                parsed_ok = True
            except (json.JSONDecodeError, TypeError):
                pass

            structured_valid = (
                parsed_ok
                and validate_structured_output(
                    case["task"],
                    parsed_output,
                )
            )

            usage = data.get("usage") or {}
            input_tokens, output_tokens, cost = estimate_cost(
                candidate,
                usage,
            )

            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "huggingface",
                "route": candidate["route"],
                "model_key": candidate["key"],
                "model_id": candidate["model_id"],
                "request_success": True,
                "parsed_ok": parsed_ok,
                "structured_output_valid": structured_valid,
                "latency_ms": elapsed_ms,
                "attempts": attempt,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "reasoning_tokens": 0,
                "estimated_paid_cost_usd": round(cost, 8),
                "finish_reason": choices[0].get("finish_reason"),
                "parsed_output": parsed_output,
                "raw_text": raw_text,
                "error": None,
            }
        except HTTPError as exc:
            error_body = exc.read().decode(
                "utf-8",
                errors="replace",
            )
            if exc.code in {502, 503, 504} and attempt < max_attempts:
                delay_seconds = 2 ** (attempt - 1)
                print(
                    f"         HTTP {exc.code}, retry "
                    f"{attempt + 1}/{max_attempts} "
                    f"dans {delay_seconds}s...",
                    flush=True,
                )
                time.sleep(delay_seconds)
                continue

            elapsed_ms = round(
                (time.perf_counter() - started) * 1000,
                1,
            )
            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "huggingface",
                "route": candidate["route"],
                "model_key": candidate["key"],
                "model_id": candidate["model_id"],
                "request_success": False,
                "parsed_ok": False,
                "structured_output_valid": False,
                "latency_ms": elapsed_ms,
                "attempts": attempt,
                "input_tokens": 0,
                "output_tokens": 0,
                "reasoning_tokens": 0,
                "estimated_paid_cost_usd": 0.0,
                "finish_reason": None,
                "parsed_output": None,
                "raw_text": None,
                "error": f"HTTP {exc.code}: {error_body[:1600]}",
            }
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            elapsed_ms = round(
                (time.perf_counter() - started) * 1000,
                1,
            )
            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "huggingface",
                "route": candidate["route"],
                "model_key": candidate["key"],
                "model_id": candidate["model_id"],
                "request_success": False,
                "parsed_ok": False,
                "structured_output_valid": False,
                "latency_ms": elapsed_ms,
                "attempts": attempt,
                "input_tokens": 0,
                "output_tokens": 0,
                "reasoning_tokens": 0,
                "estimated_paid_cost_usd": 0.0,
                "finish_reason": None,
                "parsed_output": None,
                "raw_text": None,
                "error": f"{type(exc).__name__}: {exc}",
            }

    raise AssertionError("Boucle de retry incohérente.")


def objective_summary(
    results: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        grouped[result["model_key"]].append(result)

    summary: dict[str, dict[str, Any]] = {}
    for model_key, model_results in sorted(grouped.items()):
        successes = [
            result for result in model_results if successful(result)
        ]
        summary[model_key] = {
            "calls": len(model_results),
            "structured_success": len(successes),
            "success_rate": (
                len(successes) / len(model_results)
                if model_results
                else 0.0
            ),
            "mean_latency_ms_success": (
                sum(
                    float(result["latency_ms"])
                    for result in successes
                ) / len(successes)
                if successes
                else None
            ),
            "mean_attempts": (
                sum(
                    int(result.get("attempts") or 1)
                    for result in model_results
                ) / len(model_results)
                if model_results
                else None
            ),
            "mean_input_tokens_success": (
                sum(
                    int(result.get("input_tokens") or 0)
                    for result in successes
                ) / len(successes)
                if successes
                else None
            ),
            "mean_output_tokens_success": (
                sum(
                    int(result.get("output_tokens") or 0)
                    for result in successes
                ) / len(successes)
                if successes
                else None
            ),
            "estimated_paid_cost_usd_total": sum(
                float(
                    result.get("estimated_paid_cost_usd") or 0
                )
                for result in model_results
            ),
            "estimated_paid_cost_usd_success_mean": (
                sum(
                    float(
                        result.get("estimated_paid_cost_usd") or 0
                    )
                    for result in successes
                ) / len(successes)
                if successes
                else None
            ),
        }

    return summary


def scale_up_summary(
    quality_results: list[dict[str, Any]],
) -> dict[str, Any]:
    if not quality_results:
        return {
            "model_key": "gemini_quality",
            "available": False,
        }

    successes = [
        result for result in quality_results if successful(result)
    ]
    return {
        "model_key": "gemini_quality",
        "model_id": quality_results[0].get("model_id"),
        "role": "qualitative_scale_up_only",
        "available": True,
        "calls": len(quality_results),
        "structured_success": len(successes),
        "mean_latency_ms_success": (
            sum(
                float(result["latency_ms"])
                for result in successes
            ) / len(successes)
            if successes
            else None
        ),
        "mean_attempts": (
            sum(
                int(result.get("attempts") or 1)
                for result in quality_results
            ) / len(quality_results)
        ),
        "estimated_paid_cost_usd_success_mean": (
            sum(
                float(
                    result.get("estimated_paid_cost_usd") or 0
                )
                for result in successes
            ) / len(successes)
            if successes
            else None
        ),
        "note": (
            "Not ranked for principal/fallback. Retained only as a "
            "candidate for qualitative escalation on difficult cases."
        ),
    }


def output_path() -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    DEFAULT_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    return (
        DEFAULT_RESULTS_DIR
        / f"multimodal-candidates-{timestamp}.json"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "BrocAI Step 10.2.4-E - Gemini 3.5 vs Qwen HF "
            "vs Llama Scout HF"
        )
    )
    parser.add_argument(
        "--gemini-report",
        type=Path,
        required=True,
        help="Rapport Gemini corrigé contenant les 6 sorties 3.5.",
    )
    parser.add_argument(
        "--candidates",
        type=Path,
        default=DEFAULT_CANDIDATES,
    )
    parser.add_argument(
        "--cases",
        type=Path,
        default=Path("benchmarks/step10/cases.json"),
    )
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--timeout-seconds", type=int, default=120)
    parser.add_argument(
        "--only-model",
        choices=["qwen_hf", "llama_scout_hf"],
    )
    parser.add_argument("--only-case")
    parser.add_argument(
        "--run",
        action="store_true",
        help="Effectue les appels HF. Sans ce flag : plan seul.",
    )
    args = parser.parse_args()

    load_env_file(args.env_file)
    hf_token = os.getenv("HF_TOKEN", "").strip()

    baseline, quality = load_gemini_reference(
        args.gemini_report,
    )
    cases = load_visual_cases(args.cases)
    candidates = load_hf_candidates(args.candidates)

    if args.only_model:
        candidates = [
            candidate
            for candidate in candidates
            if candidate["key"] == args.only_model
        ]
    if args.only_case:
        cases = [
            case
            for case in cases
            if case["case_id"] == args.only_case
        ]
        if not cases:
            raise SystemExit(
                f"Cas inconnu : {args.only_case}"
            )

    pairs = [
        (candidate, case)
        for case in cases
        for candidate in candidates
    ]

    print("=== STEP 10.2.4-E PLAN ===")
    print(
        "Référence réutilisée : Gemini 3.5 Flash-Lite "
        "(6 sorties existantes)"
    )
    print(
        "Challengers HF : "
        + ", ".join(
            f"{candidate['key']} via {candidate['route']}"
            for candidate in candidates
        )
    )
    print(f"Nouveaux appels HF maximum : {len(pairs)}")
    print(
        "Gemini 3.6 : contexte scale-up qualitatif uniquement"
    )
    print("Secrets affichés : 0")

    missing_assets = sorted(
        {
            image_path
            for _, case in pairs
            for image_path in case.get("image_paths", [])
            if not Path(image_path).is_file()
        }
    )
    if missing_assets:
        print()
        print("STOP : assets manquants")
        for path in missing_assets:
            print(f"- {path}")
        return 1

    if not args.run:
        print()
        print("API calls : 0")
        print("Relancer avec --run pour exécuter.")
        return 0

    if not hf_token:
        print("STOP : HF_TOKEN absente.")
        return 1

    hf_results: list[dict[str, Any]] = []
    total = len(pairs)

    print()
    print("=== RUN HF CHALLENGERS ===")

    for index, (candidate, case) in enumerate(pairs, start=1):
        print(
            f"[{index:02d}/{total:02d}] "
            f"{candidate['key']} / {case['case_id']} ...",
            flush=True,
        )
        result = call_hf(
            token=hf_token,
            candidate=candidate,
            case=case,
            timeout_seconds=max(
                10,
                min(args.timeout_seconds, 300),
            ),
        )
        hf_results.append(result)

        status = "PASS" if successful(result) else "FAIL"
        print(
            f"         {status} | "
            f"{result['latency_ms']:.1f} ms | "
            f"attempts={result['attempts']} | "
            f"in={result['input_tokens']} "
            f"out={result['output_tokens']} | "
            f"${result['estimated_paid_cost_usd']:.6f}"
        )
        if result["error"]:
            print(f"         {result['error'][:500]}")

    if args.only_model or args.only_case:
        combined_baseline = [
            result
            for result in baseline
            if (
                not args.only_case
                or result["case_id"] == args.only_case
            )
        ]
    else:
        combined_baseline = baseline

    tournament_results = combined_baseline + hf_results
    report = {
        "benchmark": (
            "BrocAI Step 10.2.4-E multimodal principal/fallback candidates"
        ),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "gemini_reference_report": str(args.gemini_report),
        "comparison_scope": {
            "principal_fallback_candidates": [
                "gemini_baseline",
                *[candidate["key"] for candidate in candidates],
            ],
            "scale_up_candidate": "gemini_quality",
            "scale_up_candidate_ranked_in_tournament": False,
        },
        "objective_summary": objective_summary(
            tournament_results,
        ),
        "scale_up_context": scale_up_summary(quality),
        "results": tournament_results,
    }

    destination = output_path()
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print()
    print("=== OBJECTIVE SUMMARY ===")
    for model_key, metrics in report["objective_summary"].items():
        latency = metrics["mean_latency_ms_success"]
        cost = metrics["estimated_paid_cost_usd_success_mean"]
        latency_text = (
            f"{latency:.1f} ms"
            if latency is not None
            else "n/a"
        )
        cost_text = (
            f"${cost:.6f}"
            if cost is not None
            else "n/a"
        )
        print(
            f"{model_key}: "
            f"{metrics['structured_success']}/{metrics['calls']} | "
            f"{latency_text} | "
            f"{cost_text}/success"
        )

    scale = report["scale_up_context"]
    if scale.get("available"):
        print()
        print("=== SCALE-UP QUALITATIF ===")
        print(
            f"{scale['model_id']}: "
            f"{scale['structured_success']}/{scale['calls']} | "
            f"{scale['mean_latency_ms_success']:.1f} ms | "
            f"${scale['estimated_paid_cost_usd_success_mean']:.6f}/success"
        )
        print(
            "Hors classement principal/fallback : "
            "candidat d'escalade qualitative uniquement."
        )

    print()
    print(f"Results : {destination}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
