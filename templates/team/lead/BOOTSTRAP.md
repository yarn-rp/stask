# BOOTSTRAP.md — First-run exploration for {{LEAD_NAME}}

You run this **once**, on project onboarding, before any task work. Goal: understand {{PROJECT_NAME}} well enough to start producing specs, then delete this file.

## Prerequisites

- `acpx {{ACP_AGENT}} --version` must succeed. If it doesn't, stop and tell {{HUMAN_NAME}} in Slack.
- You are running inside `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/`.
- {{HUMAN_NAME}} has already dropped a project briefing into this workspace (usually in the Slack thread that spawned you).

## The flow

One long-lived acpx session does the whole tour. You invoke it via OpenClaw's `Sub-agent` tool.

### The exact call (copy this shape — do not improvise)

```
Sub-agent({
  runtime: "acp",
  mode:    "session",               // NOT "run". Run mode is one-shot, detached, no yield/wake.
  thread:  true,                    // REQUIRED. Without it you get errorCode: "thread_required".
  label:   "T0:explore",            // EXACTLY this. Do not invent alternatives like "bootstrap-explore-2".
  cwd:     "{{PROJECT_ROOT}}",
  task:    "<BOOTSTRAP PROMPT — see below>"
})
```

### If you hit an error

- **`errorCode: "thread_required"`** → you forgot `thread: true`. Add it and retry with the same `label`.
- **Any other error** → retry with the same `label: "T0:explore"`. Never switch to `mode: "run"`. Never invent a new label. The whole point is that the session **resumes** with accumulated context — a fresh label throws away every previous attempt.

### Why this matters

`mode: "session"` + stable `label` is what gives you the yield-and-wake blocking model. OpenClaw yields your turn while the ACP session runs and wakes you back up with the result when the turn completes. Any deviation — `mode: "run"`, fresh label, missing `thread: true` — breaks the model and the agent "forgets" about the work.

The prompt:

> **BOOTSTRAP EXPLORATION.** You are exploring {{PROJECT_NAME}} so the project agent can start writing specs and implementing tasks. Walk the repo, answer the questions below, and write your findings to the file paths listed under **Deliverables**. Do not ask me questions — explore and document. Ask `{{LEAD_NAME}}` (the caller) only if something is blocking.
>
> **Read these briefings first** (whatever {{HUMAN_NAME}} left in the workspace):
> - `../shared/PROJECT.md` — if present, the goals + constraints as {{HUMAN_NAME}} framed them.
> - Any other `*.md` {{HUMAN_NAME}} dropped in the workspace root.
>
> **Questions to answer:**
> 1. **Stack.** Languages, frameworks, package manager, runtime, database, deploy target, test runner. Versions matter.
> 2. **Architecture.** Data model (tables / entities / key relationships). Top-level directories and what lives in each. Key entry points. Major flows — request path, job path, build path.
> 3. **Conventions.** Naming, formatting, testing style, commit style, PR style. Note anything that deviates from defaults.
> 4. **Known issues / tech debt.** What's flagged in the briefing or obviously hairy in the code (tangled modules, `TODO` piles, abandoned migrations, etc.).
> 5. **How to run the project.** Boot command, test command, build command, lint command. Any env vars required to boot locally.
> 6. **Slack + GitHub integration.** Which channels the team uses. Which GitHub org/repo. Default branch name. PR base branch.
>
> **Deliverables** (write each to the listed path, overwriting if it exists):
> - `../shared/STACK.md` — answer to Q1.
> - `../shared/ARCHITECTURE.md` — answer to Q2.
> - `../shared/CONVENTIONS.md` — answer to Q3.
> - `../shared/DEV.md` — answers to Q4 + Q5 + Q6, in that order.
> - `../shared/PROJECT.md` — if {{HUMAN_NAME}}'s briefing doesn't exist yet, create a placeholder that summarizes what you inferred about goals and constraints; flag it as "draft — confirm with {{HUMAN_NAME}}".
>
> For each deliverable: lead with a one-sentence summary, then the details. Use tables where they fit. Link to exact file paths where you pull conventions from (e.g. `src/api/users.ts:42`).

## When acpx returns

1. **Read every deliverable.** If anything is vague, wrong, or missing the "why," re-prompt `T0:explore` with the specific gap — never accept hand-wavy output.
2. **Post a one-screen bootstrap summary** to the Slack project channel so {{HUMAN_NAME}} knows what you learned. Include:
   - Stack summary (one line).
   - Top three conventions to respect.
   - Top three risks / known-debt items.
   - Any open questions for {{HUMAN_NAME}}.
3. **Close `T0:explore`**: `stask --project {{PROJECT_SLUG}} session acp-close --label T0:explore` (or, from the shell, `acpx {{ACP_AGENT}} sessions close T0:explore`).
4. **Delete this file** (`BOOTSTRAP.md`). It has no meaning after onboarding.

## What this file is *not*

- It is not a permanent workflow. From here on, every task opens its own `<threadId>:explore`.
- It does not write the project's first spec. The first real task does that, through the normal 6-phase loop in `HEARTBEAT.md`.
- It does not install skills or edit manifests. Those are handled by `stask setup`, already done by the time you read this.
