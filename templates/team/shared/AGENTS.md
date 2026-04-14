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
