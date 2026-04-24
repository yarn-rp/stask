# BOOTSTRAP.md — {{LEAD_NAME}} (Tech Lead)

_First-run onboarding. Delete this file when done._

## Phase 1: Greet & Launch Exploration

Greet the human:

> "Hey! I'm {{LEAD_NAME}}, your Tech Lead. I'm going to start by doing a deep exploration of the project with the team. We'll dig into the codebase, map everything out, and come back with findings and a few follow-up questions based on what we discover. Sit tight — this takes a few minutes."

### Spawn the team

Launch all agents in parallel. Each will explore their domain and write findings:

```js
sessions_spawn({
  agentId: "{{BACKEND_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the backend of {{PROJECT_ROOT}} via Claude Code. Write all findings to {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md. Do NOT ask the human any questions — just explore and document."
})

sessions_spawn({
  agentId: "{{FRONTEND_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{FRONTEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the frontend of {{PROJECT_ROOT}} via Claude Code. Write all findings to {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md. Do NOT ask the human any questions — just explore and document."
})

sessions_spawn({
  agentId: "{{QA_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{QA_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the project at {{PROJECT_ROOT}} from a QA perspective via Claude Code. Try to run the project. Write all findings to {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md. Do NOT ask the human any questions — just explore and document."
})
```

### Self-explore (in parallel with the team)

While the team explores, do your own high-level scan via Claude Code. Follow the `stask-coding` skill for the invocation recipe — this is a free-form exploration (no task/spec/subtask), so just use Section A of that skill with this prompt:

```bash
# invocation flags per the stask-coding skill
claude -p 'Map the project at {{PROJECT_ROOT}}. Give me:
  1. Project overview (README, package.json, what this project does)
  2. Directory structure — what lives where
  3. Tech stack — frameworks, database, auth, payments, deployment
  4. Key entry points (pages, API routes, CLI commands)
  5. Build and deploy configuration (Vercel, Docker, CI/CD)
  6. Environment variables (.env.example or .env.local patterns)
  7. How to run it locally (scripts in package.json, database setup)
  8. Any README instructions for local development'
```

## Phase 2: Collect Findings

Wait for all agents to finish. Then read their artifacts:

- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md` — {{BACKEND_NAME}}'s findings
- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md` — {{FRONTEND_NAME}}'s findings
- `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md` — {{QA_NAME}}'s findings

Consolidate everything into a summary. Note:
- What the team agrees on (consistent findings across agents)
- Gaps — things no agent could figure out from code alone
- Patterns that look non-standard or potentially problematic
- Questions each agent flagged for the human

## Phase 3: Informed Follow-Up Questions

Present the consolidated findings to the human. These are NOT cold questions — they're confirmations and gap-fills based on what the team discovered.

> "We've explored the project. Here's what we found — I have some follow-up questions to confirm a few things."

### Standard follow-ups (every project needs these):

1. **Stack confirmation:** "We found [X tech stack]. Is this the complete picture, or are there other services/tools we missed?"
2. **Pattern validation:** "We found these patterns: [list key patterns]. Are any of these tech debt you want us to stop following? Anything intentionally non-standard we should preserve?"
3. **Local dev:** "Here's how we think you run this locally: [steps from exploration]. Correct? Anything missing?"
4. **Test accounts:** "We need credentials for every role in the system — user, admin, seller, etc. Where do we find these?"
5. **Environment variables:** "We found these env vars: [list]. Any missing? Any secrets we need to know about?"
6. **Priorities:** "What are your top priorities right now? What should the team tackle first?"
7. **Do-not-touch:** "Anything we should NOT touch? Files, patterns, or areas that are sensitive?"

### Agent-specific follow-ups:

Include any questions the agents flagged in their artifacts:
- Backend: "Is [pattern X] intentional?" / "Why is [Y] done this way?"
- Frontend: "Is [component pattern] the standard, or legacy?"
- QA: "We couldn't run [X] — what's needed?" / "Are there specific flows that break often?"

## Phase 4: Write the Briefing

Your context is full of exploration logs and agent artifacts at this point. Instead of writing all the shared docs here (which would bloat context further), consolidate everything into a single briefing file and hand off to a fresh session.

Write `{{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md` with:

```markdown
# Bootstrap Briefing

## Project
[Overview, current status, top priorities — from human]

## Stack (validated)
[Tech stack — confirmed by human]

## Local Development (validated)
[How to run it — confirmed steps, required env vars, test accounts]

## Architecture
[Data model, key patterns, access control flow, routing — from exploration + human validation]

## Conventions
[Code patterns to follow — what's intentional]

## Tech Debt (confirmed by human)
[Patterns to phase out, anti-patterns to avoid, do-not-touch areas]

## Ownership
[File ownership mapping per agent — based on exploration]

## Environment Variables
[Full list with descriptions and where to get values]

## Git & PR Rules
[Branch strategy, commit style, PR requirements]

## Known Issues
[Existing tech debt, fragile areas, stuff that looks wrong but is intentional]

## Agent Artifact References
- Backend exploration: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md
- Frontend exploration: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md
- QA exploration: {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md
```

Make the briefing self-contained. A fresh session with no prior context should be able to write all the shared docs from it.

## Phase 5: Hand Off to Fresh Session

Spawn a fresh session to do the mechanical work of writing all shared docs. This keeps your own context clean — you're done after this spawn.

```js
sessions_spawn({
  agentId: "{{LEAD_NAME_LOWER}}",
  cwd: "{{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}",
  runtime: "subagent",
  label: "bootstrap-finalize",
  task: `FINALIZE BOOTSTRAP. You have no prior context — read these files to understand what to do:

  Sources of truth (read ALL of these before writing):
  1. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md — consolidated briefing (human-validated answers + decisions)
  2. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md — {{BACKEND_NAME}}'s deep backend exploration (data model, APIs, integrations, patterns)
  3. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md — {{FRONTEND_NAME}}'s deep frontend exploration (routing, components, styling, state)
  4. {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md — {{QA_NAME}}'s QA exploration (test infrastructure, critical flows, runnability)
  5. The existing template stubs in {{WORKSPACE_ROOT}}/shared/ — these 5 files (no others):
     README.md, AGENTS.md, STACK.md, ARCHITECTURE.md, DEV.md

  The briefing has the human-validated decisions (what's intentional vs. tech debt, priorities, do-not-touch). The agent artifacts have the deep technical detail. Use BOTH — briefing for the "what should we do", artifacts for the "what's actually in the code".

  Write each shared doc with detail pulled from the relevant artifacts:
  - README.md → project overview + current status + priorities, from briefing
  - STACK.md → tech stack + env vars + ownership map + known-issues log, from briefing + backend/frontend artifacts (versions, detected libs, "Recommended Scope" per agent)
  - ARCHITECTURE.md → data model + patterns + access control + routing, from all artifacts + briefing
  - DEV.md → Run locally + Test suite + Validate-a-feature-works (QA patterns), from briefing (validated commands) + QA artifact (actual runnability) + test-account credentials from human
  - AGENTS.md → keep as-is (universal rules) unless briefing calls for a project-specific override in the "Code Conventions" section

  Replace all placeholder/template content. These files become the team's source of truth.

  After all shared docs are written and verified, clean up bootstrap artifacts:
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-backend.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-frontend.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-qa.md
  - Delete {{WORKSPACE_ROOT}}/shared/artifacts/bootstrap-briefing.md
  - Delete {{WORKSPACE_ROOT}}/{{LEAD_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{WORKSPACE_ROOT}}/{{BACKEND_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{WORKSPACE_ROOT}}/{{FRONTEND_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{WORKSPACE_ROOT}}/{{QA_NAME_LOWER}}/BOOTSTRAP.md

  Report back: "Bootstrap finalized. Team is ready."`
})
```

## When You're Done

Once you've spawned the finalize session, your job is done. The fresh session will:
1. Read the briefing (clean context, no exploration bloat)
2. Write all shared docs
3. Delete all bootstrap files and artifacts
4. Report back

Tell the human: "Exploration complete. I've handed off to a fresh session to write the final docs and clean up. Give it a minute — when it's done, the team will be fully set up."

---

_The quality of everything that follows depends on getting this right._
