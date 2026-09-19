#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

VALID_TASKS = {"seller", "assistant", "fun"}
DEFAULT_ASSETS_DIR = Path("benchmarks/step10/assets")
DEFAULT_RESULTS_DIR = Path("benchmarks/step10/results")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Fichier introuvable : {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON invalide dans {path} : {exc}")



def load_env_file(path: Path) -> int:
    """Load simple KEY=VALUE entries without overriding existing variables."""
    if not path.is_file():
        return 0

    loaded = 0
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[7:].strip()

        if "=" not in line:
            raise SystemExit(
                f"Ligne .env invalide {path}:{line_number} "
                "(format attendu KEY=VALUE)."
            )

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            raise SystemExit(f"Clé .env vide {path}:{line_number}.")

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        if key not in os.environ:
            os.environ[key] = value
            loaded += 1

    return loaded


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
    allowed_root = DEFAULT_RESULTS_DIR.resolve()
    resolved_output = output.resolve()

    if allowed_root != resolved_output.parent and allowed_root not in resolved_output.parents:
        raise SystemExit(
            "Les résultats du benchmark doivent rester sous "
            "benchmarks/step10/results/"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )



def prepare_assets(cases: list[dict[str, Any]]) -> None:
    DEFAULT_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    expected_paths = sorted(
        {
            image_path
            for case in cases
            for image_path in case.get("image_paths", [])
        }
    )

    print(f"Dossier assets prêt : {DEFAULT_ASSETS_DIR}")
    print("Photos attendues :")
    for raw_path in expected_paths:
        print(f"- {Path(raw_path).name}")
    print("API calls : 0")


def preflight(
    models: list[dict[str, Any]],
    cases: list[dict[str, Any]],
    env_file: Path,
) -> bool:
    loaded_count = load_env_file(env_file)

    print("=== ENV ===")
    if env_file.is_file():
        print(f"Fichier chargé : {env_file} ({loaded_count} variable(s) ajoutée(s))")
    else:
        print(f"Fichier absent : {env_file}")
    print("Valeurs secrètes affichées : 0")

    print()
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
        default="benchmarks/step10/results/step10-plan.json",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Fichier local KEY=VALUE à charger pour le preflight.",
    )
    parser.add_argument(
        "--prepare-assets",
        action="store_true",
        help="Crée le dossier local ignoré et liste les photos attendues.",
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

    if args.prepare_assets:
        print()
        prepare_assets(cases)
        return 0

    if args.preflight:
        print()
        ready = preflight(models, cases, Path(args.env_file))
        return 0 if ready else 1

    print("API calls : 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
