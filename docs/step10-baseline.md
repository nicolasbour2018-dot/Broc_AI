# BrocAI - Step 10 baseline

Date: 2026-09-18
Status: PASS

Reference commit: 07ed6b281c31a151e0e5d785015a7d0410493bd8
Branch: main

Validated:
- frontend: PASS
- backend: PASS
- PostgreSQL: PASS
- Admin: PASS
- Showroom: PASS
- FunLab: PASS
- mock catalogue: PASS
- persistent AI queue: PASS
- backend crash recovery: PASS
- simulated provider failure: PASS
- catalogue during AI failure: PASS
- real Gemini call: PASS

Effective AI baseline:
- provider: gemini
- model: gemini-3.5-flash-lite
- MAX_AI_IN_FLIGHT: 20

Known baseline issue:
- transient HTTP 502 immediately after rebuild because Nginx can become ready before Uvicorn.
- To be handled later with readiness/healthchecks.

Rollback tag: pre-step-10-stable
