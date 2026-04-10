/**
 * sync.mjs — Run one bidirectional sync cycle (Slack ↔ DB).
 *
 * Usage: stask sync [--json]
 */

import { runSyncCycle } from '../lib/slack-sync.mjs';

export async function run(argv) {
  const json = argv.includes('--json');

  const summary = await runSyncCycle();

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Human-readable output
  if (summary.pulled.length > 0) {
    console.log(`Pulled from Slack: ${summary.pulled.join(', ')}`);
  }
  if (summary.pushed.length > 0) {
    console.log(`Pushed to Slack: ${summary.pushed.join(', ')}`);
  }
  if (summary.deleted.length > 0) {
    console.log(`Deleted (removed from Slack): ${summary.deleted.join(', ')}`);
  }
  if (summary.errors.length > 0) {
    console.error(`Errors:`);
    for (const err of summary.errors) console.error(`  - ${err}`);
  }
  if (summary.pulled.length === 0 && summary.pushed.length === 0 && summary.errors.length === 0) {
    console.log(`In sync. (${summary.skipped} tasks checked)`);
  }
}
