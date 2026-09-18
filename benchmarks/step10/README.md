# BrocAI Step 10.2 — Prompt Lab corpus

This directory describes the small benchmark corpus used before production multi-provider integration.

## Scope

The benchmark covers three BrocAI tasks:

- `seller`: prepare a short seller listing from a photo;
- `assistant`: help a visitor understand an object from a photo;
- `fun`: generate a short playful creation.

The benchmark is intentionally small. Its purpose is to compare candidate models on BrocAI's actual needs before selecting the production principal/fallback pair.

## Local image assets

Real benchmark photos must stay local under:

`.agent-system/benchmark/assets/`

Expected filenames for the first pass:

- `common-object.jpg`
- `ambiguous-object.jpg`
- `collectible-object.jpg`

These files are local benchmark assets and are not versioned.

The same three images are reused for `seller` and `assistant` so model/task differences can be compared without changing the visual input.

## Corpus design

The first pass contains:

- 3 seller cases;
- 3 assistant cases;
- 3 FunLab cases.

The three visual profiles are:

1. a common object that should be easy to identify;
2. an ambiguous object where uncertainty matters;
3. a possible collectible/vintage object where hallucination control matters.

## Evaluation

Objective measurements and human judgement remain separate.

Objective measurements include:

- request success;
- valid structured output;
- parsing success;
- latency;
- token usage;
- estimated API cost.

Human review uses the dimensions in `rubric.json`, rated from 1 to 5.

There is deliberately no automatic global quality score. A fast or cheap model must not appear to "win" simply because qualitatively important mistakes were averaged away.

## Current phase

Step 10.2.2 prepares the corpus and evaluation rubric only.

No API call is required at this stage.
