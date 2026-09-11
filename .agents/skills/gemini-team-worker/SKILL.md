---
name: gemini-team-worker
description: Start, resume, staff, or independently review repository work with the verified Google Antigravity Gemini Vertex ADC employees. Use for Gemini workers, Antigravity CLI, Gemini CLI ACP planning, cross-provider Gemini review, or routing a task from this repository's Codex manager. Do not use for Sloom Studio product-runtime Gemini provider nodes.
---

# Gemini team worker

Use `ops/team/GEMINI_WORKERS.md` as the authoritative route and operating contract. Use
`tools/team-gemini-worker`; do not invoke bare `agy` for a named employee because the wrapper fixes
the Vertex project, ADC authority, exact model, and reasoning class.

1. Run `tools/team-gemini-worker doctor` from the integration checkout before staffing a Gemini
   lane. Treat any failure as unavailable capacity.
2. Inspect `git status --short`, `git rev-parse HEAD`, and `git worktree list --porcelain`. Preserve
   every unrelated dirty change. Create a separate branch/worktree from an explicit reviewed base.
3. Select one permanent seat without changing its identity:
   - Elan Frost: `flash`, Antigravity exact `gemini-3.7-flash-high`, reasoning high; routine
     whole-feature implementation, repository tracing, or bounded executable review.
   - Astra Quill: `pro`, Antigravity exact `Gemini 3.1 Pro (Low)`, reasoning low; cost-controlled
     Pro second opinion, persistence/interchange analysis, or high-value cross-provider review.
4. Read `AGENTS.md`, `docs/HANDOFF.md`, the relevant `docs/TASK_LIST.md` row, the newest note, the
   team README, the employee's record, and every relevant message thread before writing the brief.
5. Put the brief and raw JSON stream outside version control under owner-only permissions. Include
   identity, one complete outcome, acceptance criteria, exact base/branch/worktree, owned files,
   collision boundaries, required gates, team communication rules, and truthful-status rules.
6. Start implementation with the fixed seat, `--output-format stream-json`,
   `--dangerously-skip-permissions`, and `--disable-slash-commands` only inside deliberate
   authority. For review, request `--mode plan`, but do not call it read-only on this host: version
   1.1.22 still reports always-proceed under the user setting. Enforce an external read-only or
   disposable boundary and verify tree cleanliness.
7. Mark the employee `working` only after the real process starts. The employee updates only its
   own `ops/team/workers/<name>.md` and posts its own claim, findings, help, evidence, and handoff
   under `ops/team/messages/`.
8. Verify the event stream semantically: same conversation UUID, exact init model, terminal
   `SUCCESS`, token/tool evidence, and real test results. Exit zero alone is insufficient.
9. Resume by exact conversation UUID through the same seat, worktree, ADC wrapper, authority, and
   append-only event file. Never resume a named employee through a different model or harness.
10. Require an exact-commit review by a different provider. Route blocking findings immediately
    back to the implementer, re-review the repaired commit, and let the manager integrate and rerun
    the affected gate. Gemini never self-qualifies Gemini-authored work.

Use Flash High first. Use Pro Low only for a concrete second opinion; keep senior architecture and
rescue with the existing senior Codex/Claude tier. On quota, billing, provider, or model-retirement
failure, preserve the conversation/candidate, mark the persona unavailable, and report exact
evidence; do not retry-storm or silently substitute a model. Native Gemini CLI ACP is a separately
verified future route and requires a new persona before product assignment.
