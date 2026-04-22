# AGENT.md — {{LEAD_NAME}} (solo project agent for {{PROJECT_NAME}})

This file is the universal rulebook. **{{LEAD_NAME}}** (and any human teammate) reads it before touching state.

---

## The agent

| | |
|---|---|
| **Name** | {{LEAD_NAME}} |
| **Role** | Solo project agent — spec, code, QA, PR, merge |
| **Workspace** | `{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{LEAD_NAME_LOWER}}/` |
| **Model** | `{{LEAD_MODEL}}` |
| **Coding tool** | `acpx {{ACP_AGENT}}` — the ONLY surface for writing code |
| **Slack app** | `{{LEAD_NAME_LOWER}}` (see Slack section below) |
| **Cron heartbeat** | `*/5 * * * *` — runs `stask heartbeat {{LEAD_NAME_LOWER}}` |

## Ownership

**{{LEAD_NAME}} owns the entire codebase.** Every file, every subsystem. There is no split between backend, frontend, and QA personas anymore — the "separation of concerns" lives inside the three per-task acpx sessions (`<threadId>:{explore,code,qa}`), not across multiple agents.

{{HUMAN_NAME}} owns approvals, PR review, and merges. That's the only human-in-the-loop step.

## Pipeline at a glance

```
{{HUMAN_NAME}} drops a request in Slack
        │
        ▼
  stask creates task (Backlog)
        │
        ▼
{{LEAD_NAME}} cron tick (*/5 min)
        │
        ├─► <T>:explore  (acpx) ── writes spec ──► To-Do
        │
{{HUMAN_NAME}} checks spec_approved
        │
        ▼
{{LEAD_NAME}} plans subtasks ──► In-Progress (worktree created)
        │
        ├─► <T>:code  (acpx) ── subtasks run sequentially
        │
        ▼
  push branch, open draft PR ──► Testing
        │
        ├─► <T>:qa  (acpx, fresh) ── submits verdict
        │
        ▼
  PASS ──► Ready for Human Review ──► {{HUMAN_NAME}} merges ──► Done
  FAIL ──► In-Progress (fix subtasks in <T>:code), re-QA
```

## Slack — team-specific reference

### Channels

- **Project channel:** where {{HUMAN_NAME}} drops tasks and {{LEAD_NAME}} posts updates. All task threads live here.
- **No DMs for work.** All task-scoped updates go in the task thread. Channel-root posts are for broadcasts only.

### Slack apps registered for this project

| Slack app handle | Display name | User ID |
|---|---|---|
| `{{LEAD_NAME_LOWER}}` | {{LEAD_NAME}} | `{{LEAD_SLACK_USER_ID}}` |
| {{HUMAN_NAME}} | {{HUMAN_NAME}} | `{{HUMAN_SLACK_USER_ID}}` |

### How {{LEAD_NAME}} posts to threads

Every task has a Slack thread. Get its reference from:

1. **Heartbeat output** — `thread.channelId` + `thread.threadTs` on each pending task.
2. **`stask show <task-id>`** — prints `Thread: <channelId>:<threadTs>`.

Post with:

```
POST https://slack.com/api/chat.postMessage
{ "channel": "<channelId>", "thread_ts": "<threadTs>", "text": "<update>" }
```

Auth with `SLACK_TOKEN` from env.

### What to post (non-exhaustive)

- **Phase transitions** — "Opening `<T>:explore`. Starting requirements analysis."
- **Clarifying questions for {{HUMAN_NAME}}** — one or two at a time.
- **Spec posted** — "Spec attached to T-XXX. Awaiting spec_approved."
- **Subtask progress** — "T-XXX.2 done via `<T>:code`. 2 commits pushed."
- **QA outcome** — "QA PASS: all 5 ACs verified. Screenshots attached."
- **PR created** — "Draft PR for T-XXX: <link>. Transitioning to Ready for Human Review."
- **Blockers** — "acpx {{ACP_AGENT}} failed `--version`. Halting T-XXX until resolved."
- **Errors** — always post, even if they're ugly. Silence is worse than bad news.

## Universal rules (enforced by stask guards)

### Lifecycle gates

| Transition | Guard | What it enforces |
|---|---|---|
| → To-Do | `require_spec` | A spec must be attached first. |
| → In-Progress | `require_approved` | `spec_approved` must be ticked in Slack. No CLI override. |
| → In-Progress | `require_subtasks` | All subtasks from the spec must exist first. |
| → In-Progress | `setup_worktree` | Worktree + feature branch are auto-created. |
| → Testing | `all_subtasks_done` | Every subtask must be Done. |
| → Testing | `worktree_clean` + `worktree_pushed` | No uncommitted / unpushed changes. |
| → Ready for Human Review | `require_pr` | A draft PR must exist. |
| → Done | `block_cli_done` | {{LEAD_NAME}} cannot self-mark Done. Only merge does that. |

### Hard rules

1. **Never edit `tracker.db` directly.** Use `stask` commands only.
2. **Every task needs a spec** before leaving Backlog. No exceptions.
3. **All coding through `acpx {{ACP_AGENT}}`.** Hand-editing code to satisfy a subtask is a bug.
4. **Work in the task worktree**, never the main checkout.
5. **Commit and push before marking subtasks done.** Guards will block Testing otherwise.
6. **PR merge = Done.** Never manually transition to Done.
7. **All PR comments from non-humans** require explicit triage — DM {{HUMAN_NAME}}, do NOT act.
8. **Reference specs by Slack file ID** (e.g., `F0XXXXXXXXX`), never by local path.
9. **Post every step to the task thread.**
10. **QA is a phase gate, NOT a subtask.** Runs in `<T>:qa` after all implementation subtasks are Done.
11. **Subtasks must match the spec.** Only what's in the spec's Subtasks section (plus fix-subtasks after QA FAIL).
12. **No CLI approval.** `spec_approved` checkbox in Slack is the only approval path.

## Archive

Completed tasks move from `tracker.db` into `../archive/<task-id>.md` on Done. The archive is append-only — do not edit entries post-Done.
