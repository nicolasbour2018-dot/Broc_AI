# Codex Host project

This project uses the shared `agent_system` Codex Host harness.

Harness location: `/Users/nicolasbour/Desktop/Agent_system`

Before planning or modifying this project:

1. Read `/Users/nicolasbour/Desktop/Agent_system/entrypoints/CODEX.md` and resolve its harness links from `/Users/nicolasbour/Desktop/Agent_system`.
2. Apply its TaskBrief, role and executor boundaries, capability and action-type routing, specialist, skill, selective coding-style and exemplar, attribution, review, and project-memory and human-decision conventions.
3. Read this project's own instructions and the existing project sources listed below.
4. Treat this repository as the project root and `/Users/nicolasbour/Desktop/Agent_system` as the harness root.

Use Codex native capabilities. Do not invoke the `agent_system` Runtime execution mode unless the user explicitly requests that mode.

Project-specific instructions may narrow or specialize the common harness conventions when they are explicit and compatible. They cannot grant permissions, turn `SpecialistAdvice` or a review verdict into a human decision, or silently change the execution mode. Report an incompatible instruction instead of guessing.

The Orchestrator executor coordinates and synthesizes attributed work through `/Users/nicolasbour/Desktop/Agent_system/docs/delegated-execution.md`. It does not switch roles to perform architecture, implementation, domain review, or other specialized work. Each specialized WorkAssignment declares `read_only` or `write`, and explicitly resolves model and reasoning before native dispatch; executors do not delegate further. Report a required unavailable executor or configuration as a gap. A self-review never satisfies an independent General Review requirement.

Project context (keep only paths that exist in this repository; include the local resumption document and decision index when configured):

- `/Users/nicolasbour/Desktop/Broc_AI/README.md`
- `/Users/nicolasbour/Desktop/Broc_AI/docs/cahier_des_charges.md`
- `/Users/nicolasbour/Desktop/Broc_AI/docs/mvp.md`
- `/Users/nicolasbour/Desktop/Broc_AI/docs/architecture.md`

Project-specific architecture, business constraints, tests, decisions, documentation and acceptance criteria remain in this repository.

Observation collection: enabled

Before the first observation write, add and verify `/.agent-system/observations/` in the local `.gitignore`. Set the line above to `disabled` to opt out. An existing consumer without an explicit `enabled` declaration remains disabled. Without an effective exclusion or authority to write, report the gap and create no fallback journal. Then follow `/Users/nicolasbour/Desktop/Agent_system/docs/observability-evals.md` and `/Users/nicolasbour/Desktop/Agent_system/docs/validation-budgets-and-step-reports.md` for every TaskBrief at work milestones, within current write permissions. Journals stay local to this consumer; activation creates no Python dependency or per-session command.
