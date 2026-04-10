/**
 * stask list — List tasks (filterable, table or JSON output).
 *
 * Usage: stask list [--status X] [--assignee Y] [--parent Z] [--json]
 */

import { withDb } from '../lib/tx.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--status' && argv[i + 1]) args.status = argv[++i];
    else if (argv[i] === '--assignee' && argv[i + 1]) args.assignee = argv[++i];
    else if (argv[i] === '--parent' && argv[i + 1]) args.parent = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  const tasks = await withDb((db, libs) => {
    let rows = libs.trackerDb.getAllTasks();

    if (args.status) rows = rows.filter(r => r['Status'] === args.status);
    if (args.assignee) rows = rows.filter(r => r['Assigned To'].toLowerCase() === args.assignee.toLowerCase());
    if (args.parent) rows = rows.filter(r => r['Parent'] === args.parent);

    return rows;
  });

  if (args.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }

  // Table output
  const header = ['Task ID', 'Task Name', 'Status', 'Assigned To', 'Type', 'Parent'];
  const widths = header.map((h, i) => {
    const vals = tasks.map(t => String(t[h] || '').length);
    return Math.max(h.length, ...vals);
  });

  const line = header.map((h, i) => h.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '─'.repeat(w)).join('──');

  console.log(line);
  console.log(sep);
  for (const t of tasks) {
    const row = header.map((h, i) => String(t[h] || '').padEnd(widths[i])).join('  ');
    console.log(row);
  }
  console.log(`\n${tasks.length} task(s)`);
}
