# BOOTSTRAP.md — {{QA_NAME}} (QA Engineer)

_First-run onboarding. {{LEAD_NAME}} spawns you for exploration. Delete when done._

## Re-Entry Check (do this first, every invocation)

This file persists across sessions. Before doing anything else, decide which phase you're in:

1. Does `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md` exist?
2. Does it contain a `## Pending Questions` section?
3. Was this session triggered by a Slack reply from {{HUMAN_NAME}} on your bootstrap thread?

| State | Go to |
|---|---|
| No artifact yet | **Phase 1** (try to run + explore from scratch) |
| Artifact exists, has `Pending Questions`, no human reply yet | **Phase 5** (post-and-wait — re-post if needed) |
| Artifact exists, has `Pending Questions`, you got a human reply | **Phase 6** (incorporate answers, finalize) |
| Artifact exists, no `Pending Questions` | You're already done — just delete this file and terminate |

---

## Phase 1: Try to Run the Project

Before exploring test infrastructure, verify the project can run. Read the project README and any existing `{{WORKSPACE_ROOT}}/shared/DEV.md`. Try to start the project via Claude Code (free-form, follow `stask-coding` Section A):

```bash
claude -p 'Try to run the project at {{PROJECT_ROOT}}:
  1. Read the README and package.json scripts
  2. Identify the dev server command
  3. Identify environment requirements (.env.example, .env.local, required services)
  4. Try to start the dev server
  5. If it starts, navigate to the URL and take a screenshot of the homepage
  6. Report: did it work? what failed? what was missing?

  Save any screenshots to {{WORKSPACE_ROOT}}/shared/qa-reports/screenshots/'
```

Record whether you could run it and any blockers. You cannot test what you cannot run.

## Phase 2: Explore Test Infrastructure via Claude Code

```bash
claude -p 'QA analysis of {{PROJECT_ROOT}}. Map:

  1. Existing test files: Playwright, Cypress, Jest, Vitest — list test directories and types.
  2. Test scripts in package.json: how to run each.
  3. Critical user flows visible in the UI: auth, payments, main features.
  4. Forms and interactive elements.
  5. Pages with auth guards.
  6. Accessibility patterns (aria labels, keyboard nav, focus management).
  7. Responsive patterns (breakpoints, mobile-specific UI).
  8. Questions: things you cannot determine from the code alone (e.g., "what test accounts exist?", "is there a staging env?").

  Output a structured markdown report.'
```

## Phase 3: Write Draft Findings

Write the draft to `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md`. Use the structure below. **The `## Pending Questions` section is what gates Phase 4 — only include questions you genuinely can't answer from the code.** Test-account credentials and staging URLs are the most common ones.

```markdown
# QA Exploration — {{QA_NAME}}

## Can I Run the Project?
- [ ] Yes / No
- What I did: [steps]
- Blockers (if any): [missing env vars, broken deps, etc.]
- Dev server URL (if running)
- Homepage screenshot path

## Test Infrastructure
- E2E framework, unit framework, test scripts, test file locations

## Critical User Flows Identified
- Auth, payment, main feature flows

## Testability Observations
- Auth-guarded pages, forms to test, accessibility patterns, responsive breakpoints

## Tech Debt Candidates
- [Item — what it is, why it might be tech debt]

## Pending Questions
<!-- One numbered question per line. Remove this whole section in Phase 6 once answered. -->
1. Test account credentials? (user, admin, seller, etc.)
2. Test payment credentials? (Stripe test cards, sandbox keys)
3. Staging environment URL + same-credentials policy?
4. Browser requirements? (desktop only, mobile matters, specific browsers)
5. How do you want bug reports formatted?
```

If you have **zero** pending questions, omit the section entirely and skip straight to Phase 6.

## Phase 4: Enrich Your Own Files

- Fill in `DEV.md` § Project Commands with: how to run the project, test commands, screenshot paths, report paths
- Leave placeholders for credentials — they get filled in during Phase 6 from {{HUMAN_NAME}}'s reply

## Phase 5: Ask {{HUMAN_NAME}} via Slack

Look up the runtime IDs you need:

```bash
jq -r '.slack.channelId, .human.slackUserId' {{PROJECT_ROOT}}/.stask/config.json
```

Post **once** to the project channel from your own bot account using `openclaw message send --channel slack --account {{QA_NAME_LOWER}} --target <channelId>`. Format:

```
Hey <@HUMAN_USER_ID>, I'm almost done with the QA bootstrap report — a few gaps I can't fill from the code alone (mostly credentials + environment access). Please answer when you get a moment, and tag @{{QA_NAME}} on your reply so I see it:

1. <question 1>
2. <question 2>
3. <question 3>

Thanks! Full draft so far: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md
```

Rules:
- One message, all questions in one go.
- Tag the human with `<@USER_ID>` (real mention).
- Number the questions so the reply is easy to thread.
- **Credentials in Slack are fine for now** — this is the project channel and the human chose to use it. If they prefer DM, they'll redirect.
- Post to the **channel root** so the team sees it.

Then **terminate**. Leave this BOOTSTRAP.md and the draft in place — when {{HUMAN_NAME}} replies and tags you, the next session picks up at Phase 6.

## Phase 6: Finalize on Reply

You're here because {{HUMAN_NAME}} replied tagging you. Steps:

1. Read the draft at `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md`.
2. Read the human's reply (it's in your current Slack context).
3. Fold each answer into the right section: credentials → a new `## Test Accounts` section, staging URL → `## Environments`, etc. **Don't just paste answers under the questions — restructure into the report.**
4. Update `DEV.md` § Validate-a-feature-works with credentials and the actual run command.
5. Remove the `## Pending Questions` section entirely.
6. Save both files.
7. Reply in the same Slack thread: `Thanks <@HUMAN_USER_ID> — QA bootstrap finalized. Artifact: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md`.
8. Delete this `BOOTSTRAP.md` file.
9. Terminate.

If the human's answers are partial, keep the unanswered ones in `## Pending Questions` and reply asking specifically for those — don't re-post the whole list.

---

_Ask your own questions live to {{HUMAN_NAME}}. {{LEAD_NAME}} only handles cross-cutting / lead-level questions._
