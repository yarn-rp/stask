# BOOTSTRAP.md — {{LEAD_NAME}} (Tech Lead)

_First-run onboarding. Delete this file when done._

## Re-Entry Check (do this first, every invocation)

This file persists across sessions. Decide which phase you're in before doing anything else:

| State | Go to |
|---|---|
| No `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md` yet, no workers spawned | **Phase 1** (greet, spawn team, self-explore) |
| Workers spawned, some bootstrap-*.md artifacts still have a `## Pending Questions` section | **Phase 2** (wait — workers ask their own questions) |
| All worker artifacts finalized (no `Pending Questions`), no briefing yet | **Phase 3** (consolidate + ask your own lead-level questions) |
| Briefing has a `## Pending Questions`, no human reply yet | **Phase 3** (post-and-wait — re-post if needed) |
| Briefing has a `## Pending Questions`, you got a human reply | **Phase 4** (incorporate, write briefing) |
| Briefing finalized | **Phase 5** (hand off to fresh session) |

---

## Phase 1: Greet & Launch the Team

Greet {{HUMAN_NAME}} once:

> "Hey! I'm {{LEAD_NAME}}, your Tech Lead. I'm kicking off a deep exploration with the team. Each of us will dig into our domain and ping you directly with any questions we hit. Sit tight — first round of questions should land in <#{{SLACK_CHANNEL_ID}}> within a few minutes."

### Spawn the team (parallel)

Each worker now runs the full ask-the-human loop themselves. They will explore, draft an artifact, post their own questions to {{HUMAN_NAME}} in the project channel, and finalize when she/he replies.

```js
sessions_spawn({
  agentId: "{{BACKEND_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP. Read your BOOTSTRAP.md and follow it end-to-end. Ask {{HUMAN_NAME}} your own questions in <#{{SLACK_CHANNEL_ID}}> when you hit gaps you can't fill from the code."
})

sessions_spawn({
  agentId: "{{FRONTEND_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{FRONTEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP. Read your BOOTSTRAP.md and follow it end-to-end. Ask {{HUMAN_NAME}} your own questions in <#{{SLACK_CHANNEL_ID}}> when you hit gaps you can't fill from the code."
})

sessions_spawn({
  agentId: "{{QA_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{QA_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP. Read your BOOTSTRAP.md and follow it end-to-end. Ask {{HUMAN_NAME}} your own questions in <#{{SLACK_CHANNEL_ID}}> when you hit gaps you can't fill from the code."
})
```

### Self-explore (in parallel with the team)

While the team works, do a high-level scan via Claude Code (`stask-coding` Section A — free-form):

```bash
claude -p 'Map the project at {{PROJECT_ROOT}}. Give me:
  1. Project overview (README, package.json, what this project does)
  2. Directory structure — what lives where
  3. Tech stack — frameworks, database, auth, payments, deployment
  4. Key entry points (pages, API routes, CLI commands)
  5. Build and deploy configuration
  6. Environment variables (.env.example or .env.local patterns)
  7. How to run it locally
  8. README-documented dev workflow'
```

Then terminate. Don't block waiting for workers — they each run their own Q&A loop and will resurrect themselves when {{HUMAN_NAME}} replies.

## Phase 2: Wait for Worker Artifacts

Workers handle their own per-domain questions directly with {{HUMAN_NAME}}. You're done until all three artifacts are finalized:

```bash
ls {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-{backend,frontend,qa}.md 2>/dev/null
grep -L '## Pending Questions' {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-{backend,frontend,qa}.md 2>/dev/null
```

If any artifact is missing or still has `## Pending Questions`, terminate. The worker will finalize when ready, and your next heartbeat / spawn will re-enter at Phase 3 once the gate is clear.

## Phase 3: Consolidate + Ask Your Own Lead-Level Questions

All worker artifacts are finalized. Read all three:

- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md`
- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md`
- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md`

Write the draft briefing to `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md` with the structure below. **Only include questions for {{HUMAN_NAME}} that workers couldn't have asked on their own** — cross-cutting / lead-level stuff:

```markdown
# Bootstrap Briefing

## Project (consolidated)
[Overview, current status, top priorities — extracted from worker artifacts]

## Stack (consolidated)
[Tech stack — confirmed across backend/frontend/qa artifacts]

## Architecture
[Data model, key patterns, access control, routing — synthesized from worker artifacts]

## Conventions Observed
[Code patterns the team should follow]

## Tech Debt Candidates (consolidated)
[Aggregated tech-debt list from all three workers — flag the ones the human hasn't yet confirmed]

## Ownership
[File ownership mapping per agent — based on each worker's "Recommended Scope"]

## Pending Questions
<!-- Lead-level questions only. Remove this section in Phase 4 once answered. -->
1. **Priorities:** What should the team tackle first this quarter?
2. **Do-not-touch:** Any files, patterns, or areas we should NOT modify? (sensitive, in-flight by another team, intentionally weird)
3. **Tech-debt confirmation:** Of the candidates aggregated above, which are real debt vs. intentional decisions we should preserve?
4. **PR/branch policy:** Any branch-naming, commit-style, or review rules beyond what we found in the code?
5. **Deploy access:** Who triggers production deploys? Anything the team should NOT trigger?
```

Now post **once** to the project channel from your bot account:

```bash
jq -r '.slack.channelId, .human.slackUserId' {{PROJECT_ROOT}}/.stask/config.json
# openclaw message send --channel slack --account {{LEAD_NAME_LOWER}} --target <channelId>
```

Body:

```
Hey <@HUMAN_USER_ID>, the team finished their domain-level Q&A. Here are my lead-level questions before I write the final briefing — please answer when you get a moment, and tag @{{LEAD_NAME}} on your reply:

1. <question 1>
2. <question 2>
3. <question 3>
4. <question 4>
5. <question 5>

Briefing draft so far: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md
```

Then terminate. The reply tagging you will resurrect this BOOTSTRAP at Phase 4.

If you have **zero** lead-level questions, skip directly to Phase 4 (just write the briefing without a Pending Questions section).

## Phase 4: Incorporate Reply, Write Final Briefing

You're here because {{HUMAN_NAME}} replied tagging you. Steps:

1. Read the draft at `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md`.
2. Read the human's reply.
3. Fold each answer into the right section of the briefing (Priorities, Tech Debt confirmed/rejected, Do-Not-Touch, etc.).
4. Remove the `## Pending Questions` section entirely.
5. Save the briefing.
6. Post in the same Slack thread: `Thanks <@HUMAN_USER_ID> — briefing finalized. Handing off to a fresh session to write the team's source-of-truth docs and clean up. Should be a minute.`

## Phase 5: Hand Off to Fresh Session

Spawn a fresh session to do the mechanical work — keeps your context clean.

```js
sessions_spawn({
  agentId: "{{LEAD_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}",
  runtime: "subagent",
  label: "bootstrap-finalize",
  task: `FINALIZE BOOTSTRAP. You have no prior context — read these files to understand what to do:

  Sources of truth (read ALL before writing):
  1. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md — consolidated briefing (lead-level human-validated decisions)
  2. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md — finalized backend deep dive
  3. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md — finalized frontend deep dive
  4. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md — finalized QA deep dive (incl. test accounts + staging)
  5. The existing template stubs in {{WORKSPACE_ROOT}}/shared/ — these 5 files only:
     README.md, AGENTS.md, STACK.md, ARCHITECTURE.md, DEV.md

  Briefing has the lead-level decisions; worker artifacts have the deep technical detail. Use BOTH.

  Write each shared doc:
  - README.md → project overview + current status + priorities (briefing)
  - STACK.md → tech stack + env vars + ownership map + known issues (briefing + backend/frontend artifacts, versions, "Recommended Scope")
  - ARCHITECTURE.md → data model + patterns + access control + routing (all artifacts + briefing)
  - DEV.md → Run locally + Test suite + Validate-a-feature-works (briefing validated commands + QA artifact runnability + test-account credentials)
  - AGENTS.md → keep as-is unless briefing calls for project-specific overrides in "Code Conventions"

  Replace all placeholder content. These files become the team's source of truth.

  After all shared docs are written and verified, clean up:
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md
  - Delete {{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}/BOOTSTRAP.md
  - (Worker BOOTSTRAP.md files self-deleted in their own Phase 6)

  Report back in <#{{SLACK_CHANNEL_ID}}>: "Bootstrap finalized. Team is ready."`
})
```

Once spawned, terminate. The fresh session writes docs and cleans up.

---

_The quality of everything that follows depends on getting this right. Each agent owns their own questions — your job is the cross-cutting glue._
