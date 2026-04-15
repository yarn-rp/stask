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

## Phase 4: Write Shared Docs

Based on exploration + human validation, write ALL shared docs:

- `../shared/PROJECT.md` — project overview (from exploration + human context)
- `../shared/STACK.md` — validated tech stack
- `../shared/ARCHITECTURE.md` — validated data model, patterns, key flows
- `../shared/CONVENTIONS.md` — code patterns (mark what's intentional vs. tech debt to phase out)
- `../shared/OWNERSHIP.md` — file ownership mapping per agent
- `../shared/DEV.md` — local development runbook (confirmed by human)
- `../shared/ENV.md` — all environment variables with descriptions
- `../shared/KNOWN-ISSUES.md` — tech debt the human confirmed
- `../shared/GIT.md` — branch strategy, PR rules (confirm or adjust template)

## Phase 5: Team Readiness Check

Verify the shared docs are complete enough for the team to work:

- [ ] Could a new team member follow `DEV.md` to run the project from scratch?
- [ ] Are test accounts documented?
- [ ] Is every technology in `STACK.md`?
- [ ] Does `ARCHITECTURE.md` have the data model and key flows?
- [ ] Does `CONVENTIONS.md` call out both good patterns AND tech debt to avoid?
- [ ] Is `OWNERSHIP.md` clear on who owns what?

If gaps remain, ask the human to fill them.

## When You're Done

Delete this file. The project is mapped, validated, and documented. The team is ready to work.

---

_The quality of everything that follows depends on getting this right._
