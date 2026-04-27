# BOOTSTRAP.md — {{BACKEND_NAME}} (Backend Engineer)

_First-run onboarding. {{LEAD_NAME}} spawns you for exploration. Delete when done._

## Re-Entry Check (do this first, every invocation)

This file persists across sessions. Before doing anything else, decide which phase you're in:

1. Does `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md` exist?
2. Does it contain a `## Pending Questions` section?
3. Was this session triggered by a Slack reply from {{HUMAN_NAME}} on your bootstrap thread?

| State | Go to |
|---|---|
| No artifact yet | **Phase 1** (explore from scratch) |
| Artifact exists, has `Pending Questions`, no human reply yet | **Phase 5** (post-and-wait — you may have crashed mid-flow; re-post your questions) |
| Artifact exists, has `Pending Questions`, you got a human reply | **Phase 6** (incorporate answers, finalize) |
| Artifact exists, no `Pending Questions` | You're already done — just delete this file and terminate |

---

## Phase 1: Deep Exploration via Claude Code

Free-form exploration via the `stask-coding` skill (Section A — no task/spec):

```bash
claude -p 'Deep backend analysis of {{PROJECT_ROOT}}. Map:

  1. API surface: all API routes, server actions, webhooks, middleware. For each: method, auth, what it does.
  2. Data layer: schema, tables, relationships, RLS policies, migrations in order.
  3. External integrations: payment, auth, email, storage, third-party APIs. For each: config, secrets, key patterns.
  4. Shared backend utilities: auth helpers, error handling, validation, logging.
  5. Code patterns: how auth is checked, how errors are returned, how inputs are validated. Flag non-standard variations.
  6. Potential tech debt: duplicated logic, inconsistent patterns, missing error handling, risky queries, missing indexes.
  7. Questions: things you cannot determine from the code alone.

  Output a structured markdown report.'
```

## Phase 2: Cross-Reference Existing Shared Docs

Read whatever exists already (Lead may have written some):
- `{{WORKSPACE_ROOT}}/shared/DEV.md`, `{{WORKSPACE_ROOT}}/shared/STACK.md`
- `.env.example` or README in the project root

## Phase 3: Write Draft Findings

Write the draft to `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md`. Use the structure below. **The `## Pending Questions` section is what gates Phase 4 — only include questions you genuinely can't answer from the code.**

```markdown
# Backend Exploration — {{BACKEND_NAME}}

## Stack
- Runtime, framework, database, ORM/client, deployment target
- Versions where detected (package.json)

## Data Model
- Tables + relationships
- RLS / access control patterns
- Migration workflow observations

## API Surface
- Server actions / routes / webhooks: list, what they do, auth pattern

## External Integrations
- For each: provider, purpose, config location, key patterns

## Patterns Observed
- Auth check pattern (consistent? variations?)
- Error handling pattern
- Input validation (Zod? manual? mixed?)
- Database access pattern (cache? direct? RPC?)

## Tech Debt Candidates
_Patterns I think might be tech debt — the human will confirm or reject:_
- [Item — what it is, why it might be tech debt]

## Recommended Scope
_Backend file paths/directories I should own, based on what I found_

## Pending Questions
<!-- One numbered question per line. Remove this whole section in Phase 6 once answered. -->
1. [Specific question I cannot answer from code alone]
2. ...
```

If you have **zero** pending questions, omit the `## Pending Questions` section entirely and skip straight to Phase 6 (just finalize and delete this BOOTSTRAP.md).

## Phase 4: Enrich Your Own Files

Based on what you discovered:
- Add Notes / Gotchas you learned into your `AGENTS.md`
- Fill in your `DEV.md` § Project Commands table with real build/test/lint commands

## Phase 5: Ask {{HUMAN_NAME}} via Slack

Look up the runtime IDs you need:

```bash
# Project channel + human's Slack user ID live in .stask/config.json
jq -r '.slack.channelId, .human.slackUserId' {{PROJECT_ROOT}}/.stask/config.json
```

Post **once** to the project channel from your own bot account. Use `openclaw message send` with `--channel slack --account {{BACKEND_NAME_LOWER}} --target <channelId>`. Format:

```
Hey <@HUMAN_USER_ID>, I'm almost done with the backend bootstrap report — a few gaps I can't fill from the code alone. Please answer when you get a moment, and tag @{{BACKEND_NAME}} on your reply so I see it:

1. <question 1>
2. <question 2>
3. <question 3>

Thanks! Full draft so far: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md
```

Rules:
- One message, all questions in one go — don't spam.
- Tag the human with `<@USER_ID>` (real mention), not `@{{HUMAN_NAME}}`.
- Number the questions so the reply is easy to thread.
- Post to the **channel root** (no `--reply-to`) so it's visible to the team.

Then **terminate**. Leave this BOOTSTRAP.md and the draft artifact in place — the next session (when {{HUMAN_NAME}} replies and tags you) will pick up at Phase 6.

## Phase 6: Finalize on Reply

You're here because {{HUMAN_NAME}} replied tagging you. Steps:

1. Read the draft at `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md`.
2. Read the human's reply (it's in your current Slack context — the message that woke you).
3. Map each numbered answer back into the relevant section of the artifact (Stack, Data Model, Tech Debt, Recommended Scope, etc.). **Don't just paste the answers under the questions — fold them into the body of the report.**
4. Remove the `## Pending Questions` section entirely.
5. Save the artifact.
6. Reply in the same Slack thread: `Thanks <@HUMAN_USER_ID> — backend bootstrap finalized. Artifact: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md`.
7. Delete this `BOOTSTRAP.md` file.
8. Terminate.

If the human's answers are partial (e.g., they answered 2/3), keep the unanswered ones in `## Pending Questions` and reply asking specifically for those — don't re-post the whole list.

---

_Ask your own questions live to {{HUMAN_NAME}}. {{LEAD_NAME}} only handles cross-cutting / lead-level questions._
