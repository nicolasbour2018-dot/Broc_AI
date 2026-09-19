#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from benchmark_ai import DEFAULT_RESULTS_DIR, load_json

RUBRIC_PATH = Path("benchmarks/step10/rubric.json")


def successful_result(result: dict[str, Any]) -> bool:
    return bool(
        result.get("request_success")
        and result.get("structured_output_valid")
        and isinstance(result.get("parsed_output"), dict)
    )


def pair_results(
    report: dict[str, Any],
) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for result in report.get("results", []):
        if successful_result(result):
            by_case[result["case_id"]].append(result)

    pairs: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    for case_id in sorted(by_case):
        results = by_case[case_id]
        model_keys = {result["model_key"] for result in results}
        if model_keys != {"gemini_baseline", "gemini_quality"}:
            continue

        baseline = next(
            result
            for result in results
            if result["model_key"] == "gemini_baseline"
        )
        quality = next(
            result
            for result in results
            if result["model_key"] == "gemini_quality"
        )
        pairs.append((case_id, baseline, quality))

    return pairs


def blinded_pair(
    case_id: str,
    baseline: dict[str, Any],
    quality: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    digest = hashlib.sha256(case_id.encode("utf-8")).digest()
    swap = bool(digest[0] & 1)

    if swap:
        candidate_a, candidate_b = quality, baseline
    else:
        candidate_a, candidate_b = baseline, quality

    mapping = {
        "A": candidate_a["model_key"],
        "B": candidate_b["model_key"],
    }
    return candidate_a, candidate_b, mapping


def money(value: Any) -> str:
    return f"${float(value or 0):.6f}"


def format_output(result: dict[str, Any]) -> str:
    output = result["parsed_output"]
    return "```json\n" + json.dumps(
        output,
        ensure_ascii=False,
        indent=2,
    ) + "\n```"


def objective_summary(
    report: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in report.get("results", []):
        grouped[result["model_key"]].append(result)

    summary: dict[str, dict[str, Any]] = {}
    for model_key, results in sorted(grouped.items()):
        successes = [result for result in results if successful_result(result)]
        attempts = [
            int(result.get("attempts") or 1)
            for result in results
        ]

        summary[model_key] = {
            "calls": len(results),
            "structured_success": len(successes),
            "success_rate": (
                len(successes) / len(results)
                if results
                else 0.0
            ),
            "mean_latency_ms_success": (
                sum(float(result["latency_ms"]) for result in successes)
                / len(successes)
                if successes
                else None
            ),
            "mean_attempts": (
                sum(attempts) / len(attempts)
                if attempts
                else None
            ),
            "estimated_paid_cost_usd_total": sum(
                float(result.get("estimated_paid_cost_usd") or 0)
                for result in results
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

    return summary


def write_review(
    report_path: Path,
    output_path: Path,
    mapping_path: Path,
) -> None:
    report = load_json(report_path)
    rubric = load_json(RUBRIC_PATH)
    pairs = pair_results(report)

    if not pairs:
        raise SystemExit(
            "Aucun cas comparable où les deux modèles ont une sortie valide."
        )

    lines: list[str] = [
        "# BrocAI — Revue qualitative Gemini 3.5 vs 3.6",
        "",
        f"Source : `{report_path}`",
        "",
        "Cette revue est volontairement aveugle : les identités des modèles "
        "sont masquées pendant l'évaluation qualitative.",
        "",
        "Barème humain : 1 = poor, 2 = weak, 3 = acceptable, "
        "4 = good, 5 = excellent.",
        "",
        "Ne pas produire de score global automatique. Noter chaque dimension "
        "séparément et signaler toute hallucination ou certitude abusive.",
        "",
        "## Métriques objectives",
        "",
        "| Modèle | Succès structurés | Latence moyenne succès | "
        "Tentatives moyennes | Coût équiv. total | Coût moyen / succès |",
        "|---|---:|---:|---:|---:|---:|",
    ]

    objective = objective_summary(report)
    for model_key, metrics in objective.items():
        latency = metrics["mean_latency_ms_success"]
        latency_text = (
            f"{latency:.1f} ms"
            if latency is not None
            else "n/a"
        )
        cost_mean = metrics["estimated_paid_cost_usd_success_mean"]
        cost_mean_text = (
            money(cost_mean)
            if cost_mean is not None
            else "n/a"
        )
        lines.append(
            f"| {model_key} | "
            f"{metrics['structured_success']}/{metrics['calls']} | "
            f"{latency_text} | "
            f"{metrics['mean_attempts']:.2f} | "
            f"{money(metrics['estimated_paid_cost_usd_total'])} | "
            f"{cost_mean_text} |"
        )

    mapping: dict[str, Any] = {
        "source_report": str(report_path),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "cases": {},
    }

    for case_id, baseline, quality in pairs:
        candidate_a, candidate_b, case_mapping = blinded_pair(
            case_id,
            baseline,
            quality,
        )
        task = baseline["task"]
        dimensions = rubric[task]
        mapping["cases"][case_id] = case_mapping

        lines.extend(
            [
                "",
                "---",
                "",
                f"## {case_id}",
                "",
                f"Tâche : `{task}`",
                "",
                "### Candidat A",
                "",
                format_output(candidate_a),
                "",
                "### Candidat B",
                "",
                format_output(candidate_b),
                "",
                "### Évaluation humaine",
                "",
                "| Dimension | A (1–5) | B (1–5) | Notes |",
                "|---|---:|---:|---|",
            ]
        )

        for dimension in dimensions:
            lines.append(f"| `{dimension}` |  |  |  |")

        lines.extend(
            [
                "",
                "**Hallucination / certitude abusive :** "
                "A = ☐ oui ☐ non · B = ☐ oui ☐ non",
                "",
                "**Préférence sur ce cas :** "
                "☐ A · ☐ B · ☐ équivalent",
                "",
                "**Commentaire :**",
                "",
            ]
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## Synthèse qualitative",
            "",
            "Après avoir évalué les cas sans consulter le mapping :",
            "",
            "- Forces récurrentes du candidat A :",
            "- Faiblesses récurrentes du candidat A :",
            "- Forces récurrentes du candidat B :",
            "- Faiblesses récurrentes du candidat B :",
            "- Différences de prix jugées plausibles / problématiques :",
            "- Hallucinations ou excès de confiance remarqués :",
            "- Gain qualitatif suffisamment visible pour justifier un modèle "
            "plus lent/coûteux :",
            "",
            "Consulter ensuite le fichier mapping séparé pour révéler "
            "l'identité des candidats.",
            "",
        ]
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    mapping_path.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Cas comparables : {len(pairs)}")
    print(f"Revue : {output_path}")
    print(f"Mapping aveugle : {mapping_path}")
    print("API calls : 0")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="BrocAI Step 10.2.4-D - qualitative Gemini review"
    )
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_RESULTS_DIR / "gemini-qualitative-review.md",
    )
    parser.add_argument(
        "--mapping",
        type=Path,
        default=DEFAULT_RESULTS_DIR / "gemini-qualitative-mapping.json",
    )
    args = parser.parse_args()

    write_review(
        report_path=args.report,
        output_path=args.output,
        mapping_path=args.mapping,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
