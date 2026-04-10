/**
 * stask pr-status — Query PR status (comments, merge state) from GitHub.
 *
 * Usage: stask pr-status <task-id>
 */

import path from 'path';
import { execFileSync } from 'child_process';
import { CONFIG, LIB_DIR, getWorkspaceLibs } from '../lib/env.mjs';

export async function run(argv) {
  const taskId = argv[0];

  if (!taskId) {
    console.error('Usage: stask pr-status <task-id>');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const task = libs.trackerDb.findTask(taskId);
  if (!task) { console.error(`ERROR: Task ${taskId} not found`); process.exit(1); }
  if (task['PR'] === 'None') { console.error(`ERROR: Task ${taskId} has no PR`); process.exit(1); }

  try {
    const result = execFileSync(process.execPath, [path.join(LIB_DIR, 'pr-status.mjs'), taskId], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(result.trim());
  } catch (err) {
    console.error(`ERROR: ${err.stderr || err.message}`);
    process.exit(1);
  }
}
