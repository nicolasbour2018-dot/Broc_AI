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
TOURNAMENT_KEYS = {
    "gemini_baseline",
    "qwen_hf",
    "llama_scout_hf",
}


def successful(result: dict[str, Any]) -> bool:
    return bool(
        result.get("request_success")
        and result.get("structured_output_valid")
        and isinstance(result.get("parsed_output"), dict)
    )


def format_output(result: dict[str, Any]) -> str:
    return "```json\n" + json.dumps(
        result["parsed_output"],
        ensure_ascii=False,
        indent=2,
    ) + "\n```"


def blinded_results(
    case_id: str,
    results: list[dict[str, Any]],
) -> tuple[list[tuple[str, dict[str, Any]]], dict[str, str]]:
    ordered = sorted(
        results,
        key=lambda result: hashlib.sha256(
            f"{case_id}:{result['model_key']}".encode("utf-8")
        ).digest(),
    )
    labels = ["A", "B", "C"]
    labelled = list(zip(labels, ordered))
    mapping = {
        label: result["model_key"]
        for label, result in labelled
    }
    return labelled, mapping


def fmt_money(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"${float(value):.6f}"


def fmt_latency(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.1f} ms"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "BrocAI Step 10.2.4-E - blind three-way qualitative review"
        )
    )
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            DEFAULT_RESULTS_DIR
            / "multimodal-qualitative-review.md"
        ),
    )
    parser.add_argument(
        "--mapping",
        type=Path,
        default=(
            DEFAULT_RESULTS_DIR
            / "multimodal-qualitative-mapping.json"
        ),
    )
    args = parser.parse_args()

    report = load_json(args.report)
    rubric = load_json(RUBRIC_PATH)
    results = report.get("results") or []

    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        if (
            result.get("model_key") in TOURNAMENT_KEYS
            and successful(result)
        ):
            by_case[result["case_id"]].append(result)

    comparable_cases = {
        case_id: case_results
        for case_id, case_results in by_case.items()
        if {
            result["model_key"]
            for result in case_results
        } == TOURNAMENT_KEYS
    }

    if not comparable_cases:
        raise SystemExit(
            "Aucun cas où les trois candidats ont une sortie valide."
        )

    summary = report.get("objective_summary") or {}
    scale = report.get("scale_up_context") or {}

    lines = [
        "# BrocAI — Revue aveugle multimodale 10.2.4-E",
        "",
        f"Source : `{args.report}`",
        "",
        "Tournoi principal/fallback : Gemini 3.5 Flash-Lite, "
        "Qwen 3.5 35B-A3B, Llama 4 Scout.",
        "",
        "Gemini 3.6 Flash est volontairement hors tournoi : "
        "il est évalué séparément comme candidat de scale-up qualitatif.",
        "",
        "Barème humain : 1 = poor, 2 = weak, 3 = acceptable, "
        "4 = good, 5 = excellent.",
        "",
        "Ne pas calculer de score global automatique. "
        "Évaluer les dimensions séparément.",
        "",
        "## Métriques objectives — principal/fallback",
        "",
        "| Modèle | Succès | Latence moyenne succès | "
        "Coût moyen / succès |",
        "|---|---:|---:|---:|",
    ]

    for model_key in sorted(TOURNAMENT_KEYS):
        metrics = summary.get(model_key, {})
        lines.append(
            f"| {model_key} | "
            f"{metrics.get('structured_success', 0)}/"
            f"{metrics.get('calls', 0)} | "
            f"{fmt_latency(metrics.get('mean_latency_ms_success'))} | "
            f"{fmt_money(metrics.get('estimated_paid_cost_usd_success_mean'))} |"
        )

    lines.extend(
        [
            "",
            "## Cadre séparé — Gemini 3.6 comme scale-up qualitatif",
            "",
        ]
    )

    if scale.get("available"):
        lines.extend(
            [
                f"- Modèle : `{scale.get('model_id')}`",
                f"- Succès structurés : "
                f"{scale.get('structured_success')}/{scale.get('calls')}",
                f"- Latence moyenne sur succès : "
                f"{fmt_latency(scale.get('mean_latency_ms_success'))}",
                f"- Coût moyen équivalent / succès : "
                f"{fmt_money(scale.get('estimated_paid_cost_usd_success_mean'))}",
                "- Question à trancher : son gain qualitatif sur les cas "
                "difficiles est-il suffisamment net pour justifier une "
                "escalade ciblée ?",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "Aucune donnée Gemini 3.6 disponible dans le rapport source.",
                "",
            ]
        )

    mapping: dict[str, Any] = {
        "source_report": str(args.report),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "cases": {},
    }

    for case_id in sorted(comparable_cases):
        case_results = comparable_cases[case_id]
        labelled, case_mapping = blinded_results(
            case_id,
            case_results,
        )
        task = case_results[0]["task"]
        mapping["cases"][case_id] = case_mapping

        lines.extend(
            [
                "---",
                "",
                f"## {case_id}",
                "",
                f"Tâche : `{task}`",
                "",
            ]
        )

        for label, result in labelled:
            lines.extend(
                [
                    f"### Candidat {label}",
                    "",
                    format_output(result),
                    "",
                ]
            )

        lines.extend(
            [
                "### Évaluation humaine",
                "",
                "| Dimension | A (1–5) | B (1–5) | C (1–5) | Notes |",
                "|---|---:|---:|---:|---|",
            ]
        )

        for dimension in rubric[task]:
            lines.append(
                f"| `{dimension}` |  |  |  |  |"
            )

        lines.extend(
            [
                "",
                "**Hallucination / certitude abusive :** "
                "A = ☐ oui ☐ non · "
                "B = ☐ oui ☐ non · "
                "C = ☐ oui ☐ non",
                "",
                "**Préférence sur ce cas :** "
                "☐ A · ☐ B · ☐ C · ☐ équivalent",
                "",
                "**Commentaire :**",
                "",
            ]
        )

    lines.extend(
        [
            "---",
            "",
            "## Synthèse qualitative",
            "",
            "- Forces récurrentes du candidat A :",
            "- Faiblesses récurrentes du candidat A :",
            "- Forces récurrentes du candidat B :",
            "- Faiblesses récurrentes du candidat B :",
            "- Forces récurrentes du candidat C :",
            "- Faiblesses récurrentes du candidat C :",
            "- Hallucinations / excès de confiance :",
            "- Différences de prix réellement utiles :",
            "- Candidat principal envisagé après revue :",
            "- Candidat fallback indépendant envisagé après revue :",
            "",
            "### Test spécifique du scale-up Gemini 3.6",
            "",
            "- Sur quels profils 3.6 apporte-t-il un gain visible ?",
            "- Ce gain justifie-t-il sa latence/coût supplémentaires ?",
            "- Critère d'escalade possible : faible confiance, ambiguïté, "
            "objet collection/vintage, demande approfondie.",
            "",
            "Consulter ensuite le mapping séparé pour révéler "
            "l'identité A/B/C.",
            "",
        ]
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "\n".join(lines),
        encoding="utf-8",
    )
    args.mapping.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Cas comparables à 3 candidats : {len(comparable_cases)}")
    print(f"Revue : {args.output}")
    print(f"Mapping aveugle : {args.mapping}")
    print("API calls : 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
