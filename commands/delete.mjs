/**
 * stask delete — Delete a task (and its subtasks) from DB and Slack.
 *
 * Usage: stask delete <task-id> [--force]
 *
 * Deletes the task, its subtasks, all log entries, session claims,
 * and Slack rows — atomically. Refuses to delete In-Progress or Testing
 * tasks unless --force is passed.
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { getSlackRowId } from '../lib/slack-row.mjs';

export async function run(argv) {
  const taskId = argv[0];
  const force = argv.includes('--force');

  if (!taskId) {
    console.error('Usage: stask delete <task-id> [--force]');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const db = libs.trackerDb.getDb();
  const listId = CONFIG.slack.listId;

  const task = libs.trackerDb.findTask(taskId);
  if (!task) { console.error(`ERROR: Task ${taskId} not found`); process.exit(1); }

  // Safety check — don't delete active work without --force
  const activeStatuses = ['In-Progress', 'Testing', 'Ready for Human Review'];
  if (activeStatuses.includes(task['Status']) && !force) {
    console.error(`ERROR: ${taskId} is "${task['Status']}". Use --force to delete active tasks.`);
    process.exit(1);
  }

  // Collect all task IDs to delete (parent + subtasks)
  const subtasks = libs.trackerDb.getSubtasks(taskId);
  const allIds = [taskId, ...subtasks.map(s => s['Task ID'])];

  // Phase 1: Delete Slack rows (while we still have row IDs)
  let slackDeleted = 0;
  for (const id of allIds) {
    const rowId = getSlackRowId(db, id);
    if (rowId) {
      try {
        await libs.slackApi.deleteListRow(listId, rowId);
        slackDeleted++;
      } catch (err) {
        console.error(`WARNING: Could not delete Slack row for ${id}: ${err.message}`);
      }
    }
  }

  // Phase 2: Delete from DB (drop triggers temporarily)
  db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
  db.exec('DROP TRIGGER IF EXISTS log_no_delete');
  db.exec('DROP TRIGGER IF EXISTS log_no_update');
  db.exec('DROP TRIGGER IF EXISTS enforce_in_progress_requirements');
  db.exec('DROP TRIGGER IF EXISTS enforce_ready_for_review_requirements');
  db.exec('DROP TRIGGER IF EXISTS update_timestamp');

  try {
    db.exec('BEGIN');
    for (const id of allIds) {
      db.prepare('DELETE FROM slack_row_ids WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM active_sessions WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM log WHERE task_id = ?').run(id);
    }
    // Delete subtasks first (FK constraint), then parent
    for (const sub of subtasks) {
      db.prepare('DELETE FROM tasks WHERE task_id = ?').run(sub['Task ID']);
    }
    db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    // Restore all triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS validate_status_transition
      BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
      BEGIN SELECT CASE
        WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done (terminal state)')
        WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'To-Do can only transition to In-Progress or Blocked')
        WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'In-Progress can only transition to Testing or Blocked')
        WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Testing can only transition to Ready for Human Review, In-Progress, or Blocked')
        WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Ready for Human Review can only transition to Done, In-Progress, or Blocked')
        WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Blocked can transition to To-Do, In-Progress, Testing, or Ready for Human Review')
      END; END;

      CREATE TRIGGER IF NOT EXISTS log_no_update BEFORE UPDATE ON log
      BEGIN SELECT RAISE(ABORT, 'Log entries are immutable'); END;

      CREATE TRIGGER IF NOT EXISTS log_no_delete BEFORE DELETE ON log
      BEGIN SELECT RAISE(ABORT, 'Log entries cannot be deleted'); END;

      CREATE TRIGGER IF NOT EXISTS enforce_in_progress_requirements
      BEFORE UPDATE OF status ON tasks
      WHEN NEW.status = 'In-Progress' AND OLD.status = 'To-Do' AND NEW.parent_id IS NULL
      BEGIN SELECT CASE
        WHEN NEW.worktree IS NULL OR NEW.worktree = '' THEN
          RAISE(ABORT, 'Parent task requires a worktree before moving to In-Progress')
      END; END;

      CREATE TRIGGER IF NOT EXISTS enforce_ready_for_review_requirements
      BEFORE UPDATE OF status ON tasks
      WHEN NEW.status = 'Ready for Human Review' AND NEW.parent_id IS NULL
      BEGIN SELECT CASE
        WHEN NEW.qa_fail_count = 0 AND (NEW.qa_report_1 IS NULL OR NEW.qa_report_1 = '') THEN RAISE(ABORT, 'QA Report (attempt 1) required before Ready for Human Review')
        WHEN NEW.qa_fail_count = 1 AND (NEW.qa_report_2 IS NULL OR NEW.qa_report_2 = '') THEN RAISE(ABORT, 'QA Report (attempt 2) required before Ready for Human Review')
        WHEN NEW.qa_fail_count = 2 AND (NEW.qa_report_3 IS NULL OR NEW.qa_report_3 = '') THEN RAISE(ABORT, 'QA Report (attempt 3) required before Ready for Human Review')
        WHEN NEW.worktree IS NULL OR NEW.worktree = '' THEN RAISE(ABORT, 'Worktree required before Ready for Human Review')
        WHEN NEW.pr IS NULL OR NEW.pr = '' THEN RAISE(ABORT, 'Draft PR required before Ready for Human Review')
      END; END;

      CREATE TRIGGER IF NOT EXISTS update_timestamp
      AFTER UPDATE ON tasks
      BEGIN UPDATE tasks SET updated_at = datetime('now') WHERE task_id = NEW.task_id; END;
    `);
  }

  const subCount = subtasks.length;
  const subMsg = subCount > 0 ? ` + ${subCount} subtask(s)` : '';
  console.log(`Deleted ${taskId}: "${task['Task Name']}"${subMsg} | DB: ${allIds.length} row(s) | Slack: ${slackDeleted} row(s)`);
}
