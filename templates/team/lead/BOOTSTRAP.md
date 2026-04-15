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
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the backend of {{PROJECT_ROOT}} via OpenCode. Write all findings to ../shared/artifacts/bootstrap-backend.md. Do NOT ask the human any questions — just explore and document."
})

sessions_spawn({
  agentId: "{{FRONTEND_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the frontend of {{PROJECT_ROOT}} via OpenCode. Write all findings to ../shared/artifacts/bootstrap-frontend.md. Do NOT ask the human any questions — just explore and document."
})

sessions_spawn({
  agentId: "{{QA_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}",
  runtime: "subagent",
  task: "BOOTSTRAP EXPLORATION: Read your BOOTSTRAP.md. Explore the project at {{PROJECT_ROOT}} from a QA perspective via OpenCode. Try to run the project. Write all findings to ../shared/artifacts/bootstrap-qa.md. Do NOT ask the human any questions — just explore and document."
})
```

### Self-explore (in parallel with the team)

While the team explores, do your own high-level scan via OpenCode:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{LEAD_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/gsd/SKILL.md \
  -- 'Map the project at {{PROJECT_ROOT}}. Give me:
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

- `../shared/artifacts/bootstrap-backend.md` — {{BACKEND_NAME}}'s findings
- `../shared/artifacts/bootstrap-frontend.md` — {{FRONTEND_NAME}}'s findings
- `../shared/artifacts/bootstrap-qa.md` — {{QA_NAME}}'s findings

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

Write `../shared/artifacts/bootstrap-briefing.md` with:

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
- Backend exploration: ../shared/artifacts/bootstrap-backend.md
- Frontend exploration: ../shared/artifacts/bootstrap-frontend.md
- QA exploration: ../shared/artifacts/bootstrap-qa.md
```

Make the briefing self-contained. A fresh session with no prior context should be able to write all the shared docs from it.

## Phase 5: Hand Off to Fresh Session

Spawn a fresh session to do the mechanical work of writing all shared docs. This keeps your own context clean — you're done after this spawn.

```js
sessions_spawn({
  agentId: "{{LEAD_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}",
  runtime: "subagent",
  label: "bootstrap-finalize",
  task: `FINALIZE BOOTSTRAP. You have no prior context — read these files to understand what to do:

  1. Read ../shared/artifacts/bootstrap-briefing.md — this is your only source of truth
  2. Read the existing template stubs in ../shared/ (PROJECT.md, STACK.md, ARCHITECTURE.md, CONVENTIONS.md, OWNERSHIP.md, DEV.md, ENV.md, KNOWN-ISSUES.md, GIT.md)

  Then write each shared doc based on the briefing. Replace all placeholder/template content with real validated project info.

  After all shared docs are written, clean up bootstrap artifacts:
  - Delete ../shared/artifacts/bootstrap-backend.md
  - Delete ../shared/artifacts/bootstrap-frontend.md
  - Delete ../shared/artifacts/bootstrap-qa.md
  - Delete ../shared/artifacts/bootstrap-briefing.md
  - Delete {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}/BOOTSTRAP.md
  - Delete {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}/BOOTSTRAP.md

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
