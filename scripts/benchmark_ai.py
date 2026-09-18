#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

VALID_TASKS = {"seller", "assistant", "fun"}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Fichier introuvable : {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON invalide dans {path} : {exc}")


def load_models(path: Path) -> list[dict[str, Any]]:
    models = load_json(path)
    if not isinstance(models, list):
        raise SystemExit("models.json doit contenir une liste.")

    enabled: list[dict[str, Any]] = []
    required_fields = {"key", "provider", "model_id", "env_var"}

    for model in models:
        if not isinstance(model, dict):
            raise SystemExit("Chaque modèle doit être un objet JSON.")

        missing = sorted(required_fields - model.keys())
        if missing:
            raise SystemExit(
                f"Modèle incomplet {model.get('key', '<sans key>')}: "
                f"champs manquants {missing}"
            )

        if model.get("enabled", False):
            enabled.append(model)

    if not enabled:
        raise SystemExit("Aucun modèle activé.")

    return enabled


def load_cases(path: Path) -> list[dict[str, Any]]:
    cases = load_json(path)
    if not isinstance(cases, list):
        raise SystemExit("cases.json doit contenir une liste.")

    for case in cases:
        case_id = case.get("case_id")
        task = case.get("task")

        if not case_id:
            raise SystemExit("Chaque cas doit avoir un case_id.")
        if task not in VALID_TASKS:
            raise SystemExit(
                f"{case_id}: task invalide {task!r}. "
                f"Valeurs autorisées : {sorted(VALID_TASKS)}"
            )

    return cases


def build_plan(
    models: list[dict[str, Any]],
    cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    plan = []

    for case in sorted(cases, key=lambda item: item["case_id"]):
        for model in sorted(models, key=lambda item: item["key"]):
            plan.append(
                {
                    "case_id": case["case_id"],
                    "task": case["task"],
                    "provider": model["provider"],
                    "model_key": model["key"],
                    "model_id": model["model_id"],
                    "status": "planned",
                }
            )

    return plan


def write_plan(plan: list[dict[str, Any]], output: Path) -> None:
    allowed_root = Path(".agent-system/benchmark").resolve()
    resolved_output = output.resolve()

    if allowed_root not in resolved_output.parents:
        raise SystemExit(
            "Les résultats du benchmark doivent rester sous "
            ".agent-system/benchmark/"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def preflight(models: list[dict[str, Any]], cases: list[dict[str, Any]]) -> bool:
    print("=== MODEL ACCESS ===")
    missing_keys = False

    for model in sorted(models, key=lambda item: item["key"]):
        env_var = model["env_var"]
        present = bool(os.getenv(env_var))
        state = "PRESENT" if present else "MISSING"
        print(
            f"{model['key']}: {model['provider']} / "
            f"{model['model_id']} / {env_var}={state}"
        )
        if not present:
            missing_keys = True

    image_paths = sorted(
        {
            image_path
            for case in cases
            for image_path in case.get("image_paths", [])
        }
    )

    print()
    print("=== LOCAL ASSETS ===")
    missing_assets = False

    for raw_path in image_paths:
        path = Path(raw_path)
        present = path.is_file()
        state = "PRESENT" if present else "MISSING"
        print(f"{raw_path}: {state}")
        if not present:
            missing_assets = True

    if not image_paths:
        print("Aucune image requise.")

    print()
    print("API calls : 0")

    return not missing_keys and not missing_assets


def main() -> int:
    parser = argparse.ArgumentParser(
        description="BrocAI Step 10 - Prompt Lab / benchmark"
    )
    parser.add_argument("--models", default="benchmarks/step10/models.json")
    parser.add_argument("--cases", default="benchmarks/step10/cases.json")
    parser.add_argument(
        "--output",
        default=".agent-system/benchmark/step10-plan.json",
    )
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="Vérifie les clés et assets sans effectuer aucun appel API.",
    )
    args = parser.parse_args()

    models = load_models(Path(args.models))
    cases = load_cases(Path(args.cases))
    plan = build_plan(models, cases)
    write_plan(plan, Path(args.output))

    print(f"Cas : {len(cases)}")
    print(f"Modèles actifs : {len(models)}")
    print(f"Combinaisons planifiées : {len(plan)}")
    print(f"Plan : {args.output}")

    if args.preflight:
        print()
        ready = preflight(models, cases)
        return 0 if ready else 1

    print("API calls : 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
