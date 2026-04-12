/**
 * stask transition — Transition a task's status with DB-enforced validation.
 *
 * Usage: stask transition <task-id> <new-status>
 *
 * Handles side effects: worktree creation, PR creation, cleanup,
 * auto-assignment, and subtask cascading.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { CONFIG, LIB_DIR, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';
import { getAutoAssign } from '../lib/roles.mjs';
import { runGuards } from '../lib/guards.mjs';
import { postThreadUpdate } from '../lib/thread-notify.mjs';

const TRIGGER_SQL = `
  CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
  BEGIN SELECT CASE
    WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
    WHEN OLD.status = 'Backlog' AND NEW.status NOT IN ('To-Do','Blocked') THEN RAISE(ABORT, 'Invalid transition from Backlog')
    WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from To-Do')
    WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid transition from In-Progress')
    WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from Testing')
    WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid transition from Ready for Human Review')
    WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('Backlog','To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid transition from Blocked')
  END; END;
`;

export async function run(argv) {
  const taskId = argv[0];
  const newStatus = argv[1];
  const libs = await getWorkspaceLibs();
  const { STATUSES } = libs.validate;

  if (!taskId || !newStatus) {
    console.error('Usage: stask transition <task-id> <new-status>');
    console.error(`Valid statuses: ${STATUSES.join(', ')}`);
    process.exit(1);
  }

  if (!STATUSES.includes(newStatus)) {
    console.error(`ERROR: Unknown status "${newStatus}". Valid: ${STATUSES.join(', ')}`);
    process.exit(1);
  }

  const task = libs.trackerDb.findTask(taskId);
  if (!task) { console.error(`ERROR: Task ${taskId} not found`); process.exit(1); }

  const oldStatus = task['Status'];
  const isParent = task['Parent'] === 'None';

  // Run guards (checks + setup side effects like worktree/PR creation)
  const { ok, failures } = runGuards(task, newStatus, libs);
  if (!ok) {
    console.error(`\nTransition ${taskId}: ${oldStatus} → ${newStatus} BLOCKED by ${failures.length} guard(s).`);
    process.exit(1);
  }

  const autoAssign = getAutoAssign(newStatus);

  const result = await withTransaction(
    (db, libs) => {
      const updates = { status: newStatus };
      if (autoAssign) updates.assigned_to = autoAssign;

      // Clear PR status when moving to Testing or RHR (feedback addressed)
      if (newStatus === 'Testing' || newStatus === 'Ready for Human Review') {
        updates.pr_status = null;
      }

      libs.trackerDb.updateTask(taskId, updates);

      const assignMsg = autoAssign ? ` Assigned: ${autoAssign}.` : '';
      libs.trackerDb.addLogEntry(taskId, `${taskId} "${task['Task Name']}": ${oldStatus} → ${newStatus}.${assignMsg}`);

      // Cascade to subtasks
      const subtasks = libs.trackerDb.getSubtasks(taskId);
      const cascaded = [];
      if (subtasks.length > 0) {
        db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
        try {
          for (const sub of subtasks) {
            if (sub['Status'] === 'Done' || sub['Status'] === newStatus) continue;
            const subUpdates = { status: newStatus };
            // In-Progress keeps existing builder assignments
            if (newStatus !== 'In-Progress' && autoAssign) subUpdates.assigned_to = autoAssign;

            const sets = Object.keys(subUpdates).map(k => `${k} = ?`).join(', ');
            db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = ?`)
              .run(...Object.values(subUpdates), sub['Task ID']);
            cascaded.push(sub['Task ID']);
            console.log(`  ${sub['Task ID']}: ${sub['Status']} → ${newStatus} | Assigned: ${subUpdates.assigned_to || sub['Assigned To']}`);
          }
        } finally {
          db.exec(TRIGGER_SQL);
        }
      }

      const updatedTask = libs.trackerDb.findTask(taskId);
      const cascadedTasks = cascaded.map(id => libs.trackerDb.findTask(id));
      return { taskId, taskRow: updatedTask, cascadedTasks, oldStatus, newStatus };
    },
    async ({ taskRow, cascadedTasks }, db) => {
      const allOps = [];
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      allOps.push(...slackOps);
      for (const sub of cascadedTasks) {
        if (!sub) continue;
        try {
          const { slackOps: subOps } = await syncTaskToSlack(db, sub);
          allOps.push(...subOps);
        } catch (err) {
          console.error(`WARNING: Slack sync failed for subtask ${sub['Task ID']}: ${err.message}`);
        }
      }
      return allOps;
    }
  );

  // Post-commit cleanup (best effort)
  if (newStatus === 'Done') {
    const parsed = task['Spec']?.match(/^(.+?)\s*\(/);
    if (parsed) {
      const specPath = path.resolve(CONFIG.specsDir, 'shared', parsed[1].trim());
      if (fs.existsSync(specPath)) { fs.unlinkSync(specPath); console.error(`Removed local spec: ${parsed[1].trim()}`); }
    }
    // Clean up PR status report
    const prStatusPath = path.resolve(CONFIG.staskHome, 'pr-status', `${taskId}.md`);
    if (fs.existsSync(prStatusPath)) { fs.unlinkSync(prStatusPath); console.error(`Removed PR status: pr-status/${taskId}.md`); }
    if (isParent && task['Worktree'] !== 'None') {
      try {
        execFileSync(process.execPath, [path.join(LIB_DIR, 'worktree-cleanup.mjs'), taskId], {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) { console.error(`WARNING: Worktree cleanup failed: ${err.stderr || err.message}`); }
    }
  }

  console.log(`${taskId}: "${task['Task Name']}" | ${oldStatus} → ${newStatus} | Assigned: ${autoAssign || task['Assigned To']}`);

  // Post thread notification (best-effort, after commit)
  const assignee = autoAssign || task['Assigned To'];
  await postThreadUpdate(taskId, `*${taskId}* status changed: *${oldStatus}* → *${newStatus}* | Assigned to *${assignee}*`);
}
