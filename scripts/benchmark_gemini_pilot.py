#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from benchmark_ai import DEFAULT_RESULTS_DIR, load_env_file, load_json

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model_id}:generateContent"
)
PILOT_TASKS = {"seller", "assistant"}
CATEGORIES = (
    "Meubles & décoration",
    "Vaisselle & cuisine",
    "Vêtements & accessoires",
    "Livres & médias",
    "Jeux & jouets",
    "Électronique",
    "Bricolage & jardin",
    "Sport & loisirs",
    "Collection & vintage",
    "Enfant & puériculture",
    "Bijoux & montres",
    "Autre",
)

SELLER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "suggested_price_eur": {"type": "number", "minimum": 0},
        "price_min_eur": {"type": "number", "minimum": 0},
        "price_max_eur": {"type": "number", "minimum": 0},
        "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"],
        },
        "fun_line": {"type": "string"},
    },
    "required": [
        "title",
        "description",
        "category",
        "suggested_price_eur",
        "price_min_eur",
        "price_max_eur",
        "confidence",
    ],
}

ASSISTANT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "description": {"type": "string"},
        "context_note": {"type": "string"},
        "estimated_price_eur": {"type": "number", "minimum": 0},
        "price_min_eur": {"type": "number", "minimum": 0},
        "price_max_eur": {"type": "number", "minimum": 0},
        "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"],
        },
        "caution": {"type": "string"},
    },
    "required": [
        "name",
        "category",
        "description",
        "context_note",
        "confidence",
        "caution",
    ],
}

REQUIRED_FIELDS = {
    "seller": set(SELLER_SCHEMA["required"]),
    "assistant": set(ASSISTANT_SCHEMA["required"]),
}


def prompt_for(task: str) -> str:
    categories = " | ".join(CATEGORIES)

    if task == "seller":
        return f"""
Tu aides un vendeur lors d'une brocante française à préparer une annonce courte à partir d'une photo.
Analyse uniquement ce qui est raisonnablement visible. N'invente pas de marque, d'authenticité, de matériau,
d'époque ou d'état précis si la photo ne permet pas de l'établir. Le prix est seulement indicatif.

Retourne :
- un titre concret et court ;
- une description de 1 à 3 phrases, directement réutilisable ;
- UNE catégorie choisie strictement dans cette liste :
  {categories}
  Si aucune catégorie ne convient clairement, choisis "Autre" ;
- un prix conseillé en euros et une fourchette prudente, pensés spécifiquement pour une BROCANTE / VIDE-GRENIER en France ;
  estime un prix de transaction réaliste sur place, pas un prix d'annonce en ligne ni un prix neuf. Pour un objet courant, privilégie un prix attractif qui a de bonnes chances de déclencher une vente dans la journée : remise en main propre, objet vendu en l'état, sans garantie et avec provenance souvent inconnue.
  La borne basse correspond à une vente rapide, le prix conseillé à un compromis réaliste, la borne haute à un prix encore plausible en brocante. Utilise de préférence des montants simples à payer (0,50 €, 1 €, 2 €, 5 € ou multiples raisonnables).
  Ne sous-évalue pas mécaniquement un objet qui semble réellement rare ou de collection : si la valeur est très incertaine, élargis plutôt la fourchette et baisse le niveau de confiance ;
- un niveau de confiance low/medium/high ;
- éventuellement une très courte touche fun, sans sur-promesse.

Le vendeur modifiera librement toutes les propositions avant publication.
""".strip()

    if task == "assistant":
        return f"""
Tu aides un visiteur d'une brocante française à comprendre un objet photographié.
Reste prudent : une photo ne permet pas de certifier une marque, une authenticité, une matière, une date ou une valeur.
Ne présente jamais une hypothèse comme certaine.

Retourne une fiche courte avec :
- le nom probable de l'objet ;
- UNE catégorie choisie strictement dans cette liste : {categories} ;
- une description factuelle très courte ;
- un peu de contexte sur l'usage, le style ou l'époque seulement si c'est raisonnablement inférable ;
- une estimation de prix indicative et une fourchette prudente si cela a du sens, sinon omets ces champs. Cette estimation doit correspondre à un prix réaliste de brocante / vide-grenier en France, généralement plus orienté vente sur place que prix d'annonce en ligne ;
- un niveau de confiance low/medium/high ;
- un avertissement court expliquant l'incertitude principale.

Si aucune catégorie ne convient clairement, choisis "Autre".
""".strip()

    raise ValueError(f"Tâche pilote non prise en charge : {task}")


def schema_for(task: str) -> dict[str, Any]:
    if task == "seller":
        return SELLER_SCHEMA
    if task == "assistant":
        return ASSISTANT_SCHEMA
    raise ValueError(f"Tâche pilote non prise en charge : {task}")


def image_part(image_path: Path) -> dict[str, Any]:
    mime_type, _ = mimetypes.guess_type(image_path.name)
    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError(
            f"Format image non pris en charge pour le pilote : "
            f"{image_path} ({mime_type})"
        )

    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "inlineData": {
            "mimeType": mime_type,
            "data": encoded,
        }
    }


def build_payload(task: str, image_path: Path) -> dict[str, Any]:
    return {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt_for(task)},
                    image_part(image_path),
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema_for(task),
        },
    }


def extract_text(response: dict[str, Any]) -> str:
    candidates = response.get("candidates") or []
    if not candidates:
        raise ValueError("Réponse Gemini sans candidate.")

    parts = candidates[0].get("content", {}).get("parts", [])
    text_parts = [
        part["text"]
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    text = "".join(text_parts).strip()
    if not text:
        raise ValueError("Réponse Gemini sans texte exploitable.")
    return text


def validate_structured_output(task: str, parsed: Any) -> bool:
    if not isinstance(parsed, dict):
        return False

    if not REQUIRED_FIELDS[task].issubset(parsed):
        return False

    if parsed.get("category") not in CATEGORIES:
        return False

    if parsed.get("confidence") not in {"low", "medium", "high"}:
        return False

    return True


def paid_equivalent_cost(
    model: dict[str, Any],
    usage: dict[str, Any],
) -> tuple[int, int, float]:
    input_tokens = int(usage.get("promptTokenCount") or 0)
    candidate_tokens = int(usage.get("candidatesTokenCount") or 0)
    reasoning_tokens = int(usage.get("thoughtsTokenCount") or 0)
    output_tokens = candidate_tokens + reasoning_tokens

    pricing = model["pricing_usd_per_million_tokens"]
    cost = (
        input_tokens * float(pricing["input"])
        + output_tokens * float(pricing["output"])
    ) / 1_000_000

    return input_tokens, output_tokens, cost


def call_gemini(
    api_key: str,
    model: dict[str, Any],
    case: dict[str, Any],
    timeout_seconds: int,
    max_attempts: int = 3,
) -> dict[str, Any]:
    image_paths = case.get("image_paths") or []
    if len(image_paths) != 1:
        raise ValueError(
            f"{case['case_id']}: le pilote attend exactement une image."
        )

    image_path = Path(image_paths[0])
    if not image_path.is_file():
        raise FileNotFoundError(f"Image introuvable : {image_path}")

    payload = build_payload(case["task"], image_path)
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    started = time.perf_counter()
    attempt = 0

    while attempt < max_attempts:
        attempt += 1
        request = Request(
            GEMINI_ENDPOINT.format(model_id=model["model_id"]),
            data=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            data = json.loads(response_body)
            raw_text = extract_text(data)

            parsed_output: Any = None
            parsed_ok = False
            try:
                parsed_output = json.loads(raw_text)
                parsed_ok = True
            except json.JSONDecodeError:
                pass

            structured_output_valid = (
                parsed_ok
                and validate_structured_output(case["task"], parsed_output)
            )

            usage = data.get("usageMetadata") or {}
            input_tokens, output_tokens, cost = paid_equivalent_cost(
                model,
                usage,
            )

            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "google",
                "model_key": model["key"],
                "model_id": model["model_id"],
                "request_success": True,
                "parsed_ok": parsed_ok,
                "structured_output_valid": structured_output_valid,
                "latency_ms": elapsed_ms,
                "attempts": attempt,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "reasoning_tokens": int(usage.get("thoughtsTokenCount") or 0),
                "estimated_paid_cost_usd": round(cost, 8),
                "finish_reason": (
                    (data.get("candidates") or [{}])[0].get("finishReason")
                ),
                "parsed_output": parsed_output,
                "raw_text": raw_text,
                "error": None,
            }
        except HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            if exc.code == 503 and attempt < max_attempts:
                delay_seconds = 2 ** (attempt - 1)
                print(
                    f"         HTTP 503, retry {attempt + 1}/{max_attempts} "
                    f"dans {delay_seconds}s...",
                    flush=True,
                )
                time.sleep(delay_seconds)
                continue

            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "google",
                "model_key": model["key"],
                "model_id": model["model_id"],
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
                "error": f"HTTP {exc.code}: {error_body[:1200]}",
            }
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            return {
                "case_id": case["case_id"],
                "task": case["task"],
                "image_path": str(image_path),
                "provider": "google",
                "model_key": model["key"],
                "model_id": model["model_id"],
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


def failed_pairs_from_report(path: Path) -> set[tuple[str, str]]:
    report = load_json(path)
    results = report.get("results")
    if not isinstance(results, list):
        raise SystemExit(f"Rapport invalide : {path}")

    failed: set[tuple[str, str]] = set()
    for result in results:
        if (
            not result.get("request_success")
            or not result.get("structured_output_valid")
        ):
            failed.add((result["model_key"], result["case_id"]))

    if not failed:
        raise SystemExit(f"Aucun échec à rejouer dans {path}.")

    return failed

def load_pilot_models(path: Path) -> list[dict[str, Any]]:
    models = load_json(path)
    selected = [
        model
        for model in models
        if model.get("enabled")
        and model.get("provider") == "google"
        and model.get("key") in {"gemini_baseline", "gemini_quality"}
    ]
    if len(selected) != 2:
        raise SystemExit(
            "Le pilote attend exactement gemini_baseline et gemini_quality "
            "activés."
        )
    return sorted(selected, key=lambda item: item["key"])


def load_pilot_cases(path: Path) -> list[dict[str, Any]]:
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
            "Le corpus pilote seller/assistant n'est pas celui attendu."
        )
    return sorted(selected, key=lambda item: item["case_id"])


def output_path() -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    DEFAULT_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_RESULTS_DIR / f"gemini-pilot-{timestamp}.json"


def print_plan(
    pairs: list[tuple[dict[str, Any], dict[str, Any]]],
    rerun_source: Path | None,
) -> None:
    print("=== GEMINI PILOT PLAN ===")
    print(f"Appels maximum : {len(pairs)}")
    if rerun_source is None:
        print("Mode : pilote complet")
    else:
        print(f"Mode : échecs uniquement depuis {rerun_source}")
    print("Exécution : séquentielle")
    print("Retry 503 : max 3 tentatives avec backoff borné")
    print("Secrets affichés : 0")

def main() -> int:
    parser = argparse.ArgumentParser(
        description="BrocAI Step 10.2.4-C - corrected Gemini pilot"
    )
    parser.add_argument("--models", default="benchmarks/step10/models.json")
    parser.add_argument("--cases", default="benchmarks/step10/cases.json")
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--timeout-seconds", type=int, default=90)
    parser.add_argument(
        "--only-failed-from",
        type=Path,
        help="Rejoue uniquement les couples modèle/cas en échec dans ce rapport.",
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="Effectue réellement les appels Gemini. Sans ce flag : plan seul.",
    )
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    models = load_pilot_models(Path(args.models))
    cases = load_pilot_cases(Path(args.cases))

    model_by_key = {model["key"]: model for model in models}
    case_by_id = {case["case_id"]: case for case in cases}

    if args.only_failed_from:
        failed_pairs = failed_pairs_from_report(args.only_failed_from)
        pairs = [
            (model_by_key[model_key], case_by_id[case_id])
            for model_key, case_id in sorted(failed_pairs)
            if model_key in model_by_key and case_id in case_by_id
        ]
        if not pairs:
            raise SystemExit(
                "Aucun échec du rapport ne correspond au pilote actif."
            )
    else:
        pairs = [
            (model, case)
            for case in cases
            for model in models
        ]

    print_plan(pairs, args.only_failed_from)

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

    if not api_key:
        print("STOP : GEMINI_API_KEY absente.")
        return 1

    results: list[dict[str, Any]] = []
    total = len(pairs)

    print()
    print("=== RUN ===")

    for index, (model, case) in enumerate(pairs, start=1):
        print(
            f"[{index:02d}/{total:02d}] "
            f"{model['model_id']} / {case['case_id']} ...",
            flush=True,
        )
        result = call_gemini(
            api_key=api_key,
            model=model,
            case=case,
            timeout_seconds=max(10, min(args.timeout_seconds, 300)),
        )
        results.append(result)

        status = (
            "PASS"
            if result["request_success"]
            and result["structured_output_valid"]
            else "FAIL"
        )
        print(
            f"         {status} | "
            f"{result['latency_ms']:.1f} ms | "
            f"attempts={result['attempts']} | "
            f"in={result['input_tokens']} "
            f"out={result['output_tokens']} | "
            f"${result['estimated_paid_cost_usd']:.6f}"
        )
        if result["error"]:
            print(f"         {result['error'][:300]}")

    destination = output_path()
    successful = sum(
        result["request_success"]
        and result["structured_output_valid"]
        for result in results
    )
    estimated_cost = sum(
        float(result["estimated_paid_cost_usd"])
        for result in results
    )

    report = {
        "benchmark": "BrocAI Step 10.2.4-C corrected Gemini pilot",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "rerun_source": (
            str(args.only_failed_from)
            if args.only_failed_from
            else None
        ),
        "free_tier_actual_cost": "not inferred by this script",
        "estimated_paid_equivalent_cost_usd": round(estimated_cost, 8),
        "calls_planned": total,
        "calls_structured_success": successful,
        "results": results,
    }
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print()
    print("=== SUMMARY ===")
    print(f"Structured success : {successful}/{total}")
    print(
        "Estimated paid-equivalent cost : "
        f"${estimated_cost:.6f}"
    )
    print(f"Results : {destination}")

    return 0 if successful == total else 2


if __name__ == "__main__":
    raise SystemExit(main())
