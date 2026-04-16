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
import { TRIGGERS } from '../lib/tracker-db.mjs';
import { logError } from '../lib/error-logger.mjs';

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
        logError({
          source: 'delete',
          operation: 'deleteSlackRow',
          taskId: id,
          error: err
        });
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
      db.prepare('DELETE FROM sync_state WHERE task_id = ?').run(id);
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
    // Restore all triggers from canonical source
    db.exec(TRIGGERS);
  }

  const subCount = subtasks.length;
  const subMsg = subCount > 0 ? ` + ${subCount} subtask(s)` : '';
  console.log(`Deleted ${taskId}: "${task['Task Name']}"${subMsg} | DB: ${allIds.length} row(s) | Slack: ${slackDeleted} row(s)`);
}
