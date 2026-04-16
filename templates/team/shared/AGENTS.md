# AGENTS.md — Universal Rules (All Agents)

These rules apply to every agent on the {{PROJECT_NAME}} team. They are enforced by the stask framework's guard system — violations will be blocked at the CLI level.

## Lifecycle Gates

The stask framework enforces these gates via guards in `lib/guards.mjs`. Understanding them prevents wasted transitions.

| Gate | Guard Name | When | What It Checks |
|------|-----------|------|----------------|
| Spec required | `require_spec` | → To-Do | Task must have a spec attached |
| Subtasks required | `require_subtasks` | → In-Progress | Parent must have ≥1 subtask, all assigned to workers |
| Approval required | `require_approved` | → In-Progress | Task must not be assigned to human (approval triggers reassignment) |
| All subtasks done | `all_subtasks_done` | → Testing | Every subtask must be in Done status |
| Worktree clean | `worktree_clean` | → Testing, → RHR | No uncommitted changes in worktree |
| Worktree pushed | `worktree_pushed` | → Testing, → RHR | No unpushed commits |
| CLI Done blocked | `block_cli_done` | → Done | Parent tasks cannot be moved to Done via CLI |

## Hard Rules

1. **Approval gate:** A task in To-Do assigned to {{HUMAN_NAME}} is NOT approved. Do not attempt to transition it to In-Progress. Wait for the `spec_approved` checkbox in Slack to trigger reassignment to the lead.
2. **Subtask mandate:** Parent tasks must have all subtasks created and assigned BEFORE moving to In-Progress. No subtasks = no In-Progress transition.
3. **Done is human-only:** Never run `stask transition <id> Done` on a parent task. Done happens when {{HUMAN_NAME}} merges the PR and marks it complete in Slack.
4. **QA is mandatory:** Every task must pass through Testing. There are no shortcuts from In-Progress to Ready for Human Review.
5. **Worktree discipline:** All work happens in the task worktree. Commit and push before marking subtasks done or transitioning to Testing.
6. **Database hands off:** Never edit tracker.db directly. Use `stask` commands for all task operations.
7. **Subtask creation:** Use `stask subtask create --parent T-XXX`, never `stask create` for subtasks. `stask create` makes top-level tasks that cause Slack sync issues.
8. **Backlog-first workflow:** All tasks start in Backlog via `stask create --name "..." [--overview "..."]`. No spec is attached at creation. After clarifying questions are answered, write the spec and attach it with `stask spec-update T-XXX --spec <path>`. The `require_spec` guard prevents moving to To-Do without a spec.
9. **QA is a separate phase, NOT a subtask:** Subtasks are for development work only (worker implementation). QA happens AFTER all subtasks are done, via the Testing phase (phase gate). Do NOT create QA subtasks. The QA phase is triggered when workers mark subtasks done, and the `all_subtasks_done` guard enables the Testing transition.
10. **QA test cleanup:** QA must delete any tasks created for testing purposes once testing is complete. Use `stask delete <task-id>`. No test artifacts should remain in the task board or Slack list after QA is done.

## Slack Communication (Hard Rules)

All work happens in the project Slack. These rules are non-negotiable.

1. **Never DM work updates.** Progress reports, blockers, QA verdicts, PR notices, questions to a teammate — all of it goes in Slack, but never as a direct message.
2. **Task-scoped updates go in the task's thread.** Every task stask creates has a dedicated thread in `#{{PROJECT_SLUG}}-project`, persisted in the `slack_row_ids` table. Look the thread up with `getThreadRef(db, taskId)` (from `lib/slack-row.mjs`) or via `stask show <id>`. For subtasks, post in the parent task's thread — `postThreadUpdate()` auto-resolves this.
3. **Broadcasts go in the project channel, top level.** General team announcements (weekly recap, architecture decision that affects everyone, release ready) post in `#{{PROJECT_SLUG}}-project` at the channel root, not a thread.
4. **If you can't find the thread, ask in channel — don't DM.** Post top-level in the project channel referencing the task ID. Never resort to DMs as a fallback.

`stask` already auto-posts lifecycle events (transitions, QA verdicts, subtask creation) to the task thread via `postThreadUpdate(...)`. Your human-readable updates belong next to those machine updates, not scattered across DMs. Silence in the thread looks like inactivity; reports in DM look like secrets.
