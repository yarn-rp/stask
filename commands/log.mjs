/**
 * stask log — View audit log.
 *
 * Usage: stask log [<task-id>] [--limit N]
 */

import { withDb } from '../lib/tx.mjs';

export async function run(argv) {
  let taskId = null;
  let limit = 50;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) limit = parseInt(argv[++i], 10);
    else if (!argv[i].startsWith('-')) taskId = argv[i];
  }

  await withDb((db, libs) => {
    const entries = taskId
      ? libs.trackerDb.getLogForTask(taskId)
      : libs.trackerDb.getLog(limit);

    if (entries.length === 0) {
      console.log(taskId ? `No log entries for ${taskId}.` : 'No log entries.');
      return;
    }

    const display = taskId ? entries.reverse() : entries;
    for (const e of display) {
      console.log(`[${e.created_at}] ${e.message}`);
    }
    console.log(`\n${display.length} entries`);
  });
}
