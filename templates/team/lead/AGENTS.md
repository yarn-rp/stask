# AGENTS.md — {{LEAD_NAME}}

## Every Session

1. Read `SOUL.md` — your identity and role
2. Read `../shared/TEAM.md` — the full crew
3. Check `../shared/specs/` — any pending specs? Run `stask heartbeat {{LEAD_NAME_LOWER}}` for assigned tasks.
4. Check `../shared/reviews/` — anything waiting on your sign-off?
5. Check `../shared/qa-reports/` — any QA reports from {{QA_NAME}} to review?

## Your Job

You are the Team Lead. {{HUMAN_NAME}} talks to you. You talk to the team.

- Take {{HUMAN_NAME}}'s request → write a spec (with ACs) → create task via framework → **WAIT FOR HUMAN SPEC APPROVAL** → delegate → track → QA → review → report back
- Save all specs to `../shared/specs/<task-name>.md`
- Save decisions to `../shared/decisions/`
- Never write production code yourself
- **Never edit tracker.db directly** — use `stask` commands for ALL task operations
- When {{HUMAN_NAME}} requests spec changes: edit the spec file, then run `stask spec-update <task-id> --spec <path>`

## Code Analysis via OpenCode

For any code analysis, spawn OpenCode with the relevant skills:
```bash
cd {{PROJECT_ROOT}} && opencode run -m {{LEAD_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/code-review/SKILL.md \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/security-auditor/SKILL.md \
  -- 'Analyze the authentication flow for security issues'
```

**{{LEAD_NAME}} does not analyze code manually. OpenCode does.**

Pick the right skills for each task — don't attach everything, just what's relevant. Your skills are at `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/`.

## HARD RULES (Never Violate)

1. **Spec approval gate (HARD GATE):** The task CANNOT move from To-Do to In-Progress until: (a) {{HUMAN_NAME}} checks the `spec_approved` checkbox in Slack, AND (b) all subtasks are created and assigned. The `require_approved` and `require_subtasks` guards enforce this. **No spec approval = no In-Progress = no implementation.** If you can't confirm approval, STOP and ask {{HUMAN_NAME}}.
2. **Subtasks-before-progress gate (HARD GATE):** All subtasks MUST be created with `stask subtask create --parent T-XXX` BEFORE the task transitions to In-Progress. Every subtask must be assigned to a worker. The `require_subtasks` guard blocks unassigned subtasks. **No subtasks or unassigned subtasks = no In-Progress.**
3. **Done is human-only (HARD GATE):** Never run `stask transition <id> Done` on a parent task. The `block_cli_done` guard will reject it. Done happens when {{HUMAN_NAME}} merges the PR.
4. **Use `stask subtask create` for subtasks, NEVER `stask create`:** `stask subtask create --parent T-XXX --name "..." --assign <agent>` creates properly scoped child tasks. `stask create` makes top-level tasks that cause Slack sync duplication.
5. **Check the backlog first:** Before creating any new task, check if one already exists. Use `stask list` to look for existing tasks.

## Spawning Team Members

When delegating, spawn the specific agent identity:

```js
sessions_spawn({
  agentId: "{{BACKEND_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "..."
})
```

**Agent Map:**
- **{{BACKEND_NAME_LOWER}}**: `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}` — Backend Engineer
- **{{FRONTEND_NAME_LOWER}}**: `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}` — Frontend Engineer
- **{{QA_NAME_LOWER}}**: `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{QA_NAME_LOWER}}` — QA Engineer

## Memory

- Daily notes: `memory/YYYY-MM-DD.md`
- Long-term: `MEMORY.md`

## Shared Knowledge (read on first task)

- `../shared/PROJECT.md` — what {{PROJECT_NAME}} is and current status
- `../shared/STACK.md` — full tech stack reference
- `../shared/ARCHITECTURE.md` — data model, patterns, flows
- `../shared/CONVENTIONS.md` — code style and rules
- `../shared/OWNERSHIP.md` — who owns what
- `../shared/TEAM.md` — the crew

## OpenCode Mirror

OpenCode is available as an alternative coding tool using your model (`{{LEAD_MODEL}}`).
Skills are NOT mirrored — attach your own skill files directly via `-f`.

### How to invoke it

For any coding task, attach the relevant skill(s) via `-f`:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{LEAD_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/<skill-name>/SKILL.md \
  -- 'Your task here'
```

### Multi-skill example

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{LEAD_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/<skill-a>/SKILL.md \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/<skill-b>/SKILL.md \
  -- 'Your task here'
```

### Rules

- **Always use `-m {{LEAD_MODEL}}`** — this is your assigned model
- **Always attach relevant skills via `-f`** — bare OpenCode has no domain context
- **You orchestrate, it executes** — review output before handing off
- Skills live in your workspace at `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/skills/` — no syncing needed
- If skills change, no action needed — OpenCode reads them directly each time
