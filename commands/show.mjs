/**
 * stask show — Show task details.
 *
 * Usage: stask show <task-id> [--log]
 */

import { withDb } from '../lib/tx.mjs';

export async function run(argv) {
  const taskId = argv[0];
  const showLog = argv.includes('--log');

  if (!taskId) {
    console.error('Usage: stask show <task-id> [--log]');
    process.exit(1);
  }

  await withDb((db, libs) => {
    const task = libs.trackerDb.findTask(taskId);
    if (!task) { console.error(`ERROR: Task ${taskId} not found`); process.exit(1); }

    console.log(`Task ${task['Task ID']}: ${task['Task Name']}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`  Status:      ${task['Status']}`);
    console.log(`  Assigned To: ${task['Assigned To']}`);
    console.log(`  Type:        ${task['Type']}`);
    console.log(`  Parent:      ${task['Parent']}`);
    console.log(`  Spec:        ${task['Spec']}`);
    console.log(`  Worktree:    ${task['Worktree']}`);
    console.log(`  PR:          ${task['PR']}`);

    if (task['QA Report 1'] !== 'None') console.log(`  QA Report 1: ${task['QA Report 1']}`);
    if (task['QA Report 2'] !== 'None') console.log(`  QA Report 2: ${task['QA Report 2']}`);
    if (task['QA Report 3'] !== 'None') console.log(`  QA Report 3: ${task['QA Report 3']}`);
    if (task['Blocker'] !== 'None') console.log(`  Blocker:     ${task['Blocker']}`);

    console.log(`  Created:     ${task['created_at']}`);
    console.log(`  Updated:     ${task['updated_at']}`);

    // Subtasks
    const subtasks = libs.trackerDb.getSubtasks(taskId);
    if (subtasks.length > 0) {
      console.log(`\nSubtasks (${subtasks.length}):`);
      for (const sub of subtasks) {
        const marker = sub['Status'] === 'Done' ? '[x]' : '[ ]';
        console.log(`  ${marker} ${sub['Task ID']}: ${sub['Task Name']} (${sub['Status']}, ${sub['Assigned To']})`);
      }
    }

    // Log
    if (showLog) {
      const entries = libs.trackerDb.getLogForTask(taskId);
      if (entries.length > 0) {
        console.log(`\nLog (${entries.length} entries):`);
        for (const e of entries.reverse()) {
          console.log(`  [${e.created_at}] ${e.message}`);
        }
      }
    }
  });
}
