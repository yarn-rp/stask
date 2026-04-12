/**
 * stask subtask done — Builder marks their subtask as Done.
 *
 * Usage: stask subtask done <subtask-id>
 *
 * If all siblings are Done → auto-transitions parent to Testing.
 */

import { getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';
import { postThreadUpdate } from '../lib/thread-notify.mjs';

const TRIGGER_SQL = `
  CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
  BEGIN SELECT CASE
    WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
    WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from To-Do')
    WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid transition from In-Progress')
    WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from Testing')
    WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from Ready for Human Review')
    WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid transition from Blocked')
  END; END;
`;

export async function run(argv) {
  const subtaskId = argv[0];

  if (!subtaskId) {
    console.error('Usage: stask subtask done <subtask-id>');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const subtask = libs.trackerDb.findTask(subtaskId);

  if (!subtask) { console.error(`ERROR: Task ${subtaskId} not found`); process.exit(1); }
  if (subtask['Parent'] === 'None') { console.error(`ERROR: ${subtaskId} is not a subtask. Use "stask transition" for top-level tasks.`); process.exit(1); }
  if (subtask['Status'] !== 'In-Progress') { console.error(`ERROR: ${subtaskId} is "${subtask['Status']}". Must be "In-Progress".`); process.exit(1); }

  const parentId = subtask['Parent'];

  await withTransaction(
    (db, libs) => {
      db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
      try {
        db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run('Done', subtaskId);
      } finally {
        db.exec(TRIGGER_SQL);
      }

      libs.trackerDb.addLogEntry(subtaskId, `${subtaskId} "${subtask['Task Name']}": In-Progress → Done. Marked complete by builder.`);
      const updated = libs.trackerDb.findTask(subtaskId);
      return { subtaskId, taskRow: updated };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  console.log(`${subtaskId}: "${subtask['Task Name']}" | In-Progress → Done`);

  await postThreadUpdate(subtaskId, `*${subtaskId}* completed: "${subtask['Task Name']}" marked *Done*`);

  // Check siblings — auto-transition parent if all Done
  const siblings = libs.trackerDb.getSubtasks(parentId);
  const parent = libs.trackerDb.findTask(parentId);

  if (!parent) { console.error(`WARNING: Parent ${parentId} not found.`); return; }

  const allDone = siblings.length > 0 && siblings.every(s => s['Status'] === 'Done');

  if (allDone) {
    console.log(`All subtasks of ${parentId} are Done. Auto-transitioning parent to Testing...`);
    const { run: runTransition } = await import('./transition.mjs');
    await runTransition([parentId, 'Testing']);
  } else {
    const remaining = siblings.filter(s => s['Status'] !== 'Done');
    console.log(`${remaining.length} subtask(s) still pending: ${remaining.map(s => `${s['Task ID']} (${s['Status']})`).join(', ')}`);
  }
}
