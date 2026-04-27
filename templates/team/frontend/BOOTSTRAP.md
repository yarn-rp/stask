# BOOTSTRAP.md — {{FRONTEND_NAME}} (Frontend Engineer)

_First-run onboarding. {{LEAD_NAME}} spawns you for exploration. Delete when done._

## Re-Entry Check (do this first, every invocation)

This file persists across sessions. Before doing anything else, decide which phase you're in:

1. Does `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md` exist?
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
claude -p 'Deep frontend analysis of {{PROJECT_ROOT}}. Map:

  1. Routing & pages: all routes, layouts, nested layouts, dynamic segments.
  2. Component system: library (shadcn, MUI, custom), directory structure, design-system patterns.
  3. Styling: CSS framework, design tokens, themes, dark mode, breakpoints.
  4. State management: client state, server state, form state.
  5. Data fetching: server components, client fetch, server actions, loading/error handling.
  6. Animation & interaction: Framer Motion, CSS transitions, gesture handling.
  7. Types: where TypeScript types live, key interfaces.
  8. Potential tech debt: inconsistent components, CSS hacks, any-types, commented-out code, duplicated logic.
  9. Questions: things you cannot determine from the code alone.

  Output a structured markdown report.'
```

## Phase 2: Cross-Reference Existing Shared Docs

- `{{WORKSPACE_ROOT}}/shared/STACK.md` — if it exists, confirm your findings match
- Any README in the project root

## Phase 3: Write Draft Findings

Write the draft to `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md`. Use the structure below. **The `## Pending Questions` section is what gates Phase 4 — only include questions you genuinely can't answer from the code.**

```markdown
# Frontend Exploration — {{FRONTEND_NAME}}

## Stack
- Framework (Next.js? version?), component library, CSS framework, animation library
- Versions detected (package.json)

## Routing & Pages
- Key routes, layouts, dynamic segments
- Server vs client components split

## Component System
- Library (shadcn/MUI/custom), directory convention, base vs composed components

## Styling
- CSS framework, design tokens location, dark mode approach, breakpoints

## State & Data
- Client state, server state, data fetching, form library

## Patterns Observed
- Loading / empty / error states
- Responsive approach
- Dark mode parity

## Tech Debt Candidates
- [Item — what it is, why it might be tech debt]

## Recommended Scope
_Frontend file paths/directories I should own_

## Pending Questions
<!-- One numbered question per line. Remove this whole section in Phase 6 once answered. -->
1. [Specific question I cannot answer from code alone]
2. ...
```

If you have **zero** pending questions, omit the `## Pending Questions` section entirely and skip straight to Phase 6 (just finalize and delete this BOOTSTRAP.md).

## Phase 4: Enrich Your Own Files

- Add Notes / Gotchas you learned into your `AGENTS.md`
- Fill in your `DEV.md` § Project Commands table with real build/test/lint commands

## Phase 5: Ask {{HUMAN_NAME}} via Slack

Look up the runtime IDs you need:

```bash
jq -r '.slack.channelId, .human.slackUserId' {{PROJECT_ROOT}}/.stask/config.json
```

Post **once** to the project channel from your own bot account using `openclaw message send --channel slack --account {{FRONTEND_NAME_LOWER}} --target <channelId>`. Format:

```
Hey <@HUMAN_USER_ID>, I'm almost done with the frontend bootstrap report — a few gaps I can't fill from the code alone. Please answer when you get a moment, and tag @{{FRONTEND_NAME}} on your reply so I see it:

1. <question 1>
2. <question 2>
3. <question 3>

Thanks! Full draft so far: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md
```

Rules:
- One message, all questions in one go.
- Tag the human with `<@USER_ID>` (real mention).
- Number the questions so the reply is easy to thread.
- Post to the **channel root** so the team sees it.

Then **terminate**. Leave this BOOTSTRAP.md and the draft in place — when {{HUMAN_NAME}} replies and tags you, the next session picks up at Phase 6.

## Phase 6: Finalize on Reply

You're here because {{HUMAN_NAME}} replied tagging you. Steps:

1. Read the draft at `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md`.
2. Read the human's reply (it's in your current Slack context — the message that woke you).
3. Map each numbered answer back into the relevant section of the artifact (Stack, Component System, Tech Debt, Recommended Scope, etc.). **Don't just paste answers under the questions — fold them into the report body.**
4. Remove the `## Pending Questions` section entirely.
5. Save the artifact.
6. Reply in the same Slack thread: `Thanks <@HUMAN_USER_ID> — frontend bootstrap finalized. Artifact: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md`.
7. Delete this `BOOTSTRAP.md` file.
8. Terminate.

If the human's answers are partial, keep the unanswered ones in `## Pending Questions` and reply asking specifically for those — don't re-post the whole list.

---

_Ask your own questions live to {{HUMAN_NAME}}. {{LEAD_NAME}} only handles cross-cutting / lead-level questions._
