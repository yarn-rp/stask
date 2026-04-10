/**
 * stask create — Create a new task (uploads spec to Slack).
 *
 * Usage: stask create --spec <spec-path> --name "Task Name" [--type Feature|Task|Bug]
 */

import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec' && argv[i + 1]) args.spec = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--type' && argv[i + 1]) args.type = argv[++i];
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.spec || !args.name) {
    console.error('Usage: stask create --spec <spec-path> --name "Task Name" [--type Feature|Task|Bug]');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const ws = CONFIG.specsDir;
  const relPath = args.spec.startsWith('shared/') ? args.spec : path.relative(ws, path.resolve(args.spec));
  const fullPath = path.resolve(ws, relPath);

  // Validate spec exists
  libs.validate.validateSpecExists(relPath);

  // Ensure spec is uploaded to Slack
  const registry = libs.fileUploader.loadRegistry(CONFIG.registryPath);
  let fileId;
  const content = fs.readFileSync(fullPath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const existing = registry.files[relPath];

  if (existing && existing.hash === hash && existing.fileId) {
    fileId = existing.fileId;
  } else {
    const filename = path.basename(relPath);
    fileId = await libs.slackApi.uploadFile(filename, content);
    registry.files[relPath] = {
      fileId, hash, title: filename,
      uploadedAt: new Date().toISOString(),
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    };
    libs.fileUploader.saveRegistry(CONFIG.registryPath, registry);
    console.error(`Uploaded spec to Slack: ${fileId}`);
  }

  const result = await withTransaction(
    (db, libs) => {
      const taskId = libs.trackerDb.getNextTaskId();
      const specName = relPath.replace(/^shared\//, '');
      const specValue = libs.validate.formatSpecValue(specName, fileId);

      libs.trackerDb.insertTask({
        task_id: taskId,
        task_name: args.name,
        status: 'To-Do',
        assigned_to: CONFIG.human.name,
        spec: specValue,
        type: args.type || 'Feature',
      });

      libs.trackerDb.addLogEntry(taskId, `${taskId} "${args.name}" created. Spec: ${specValue}. Status: To-Do → ${CONFIG.human.name}.`);

      const taskRow = libs.trackerDb.findTask(taskId);
      return { taskId, taskRow, specValue };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  console.log(`Created ${result.taskId}: "${args.name}" | Status: To-Do | Assigned: ${CONFIG.human.name} | Spec: ${fileId}`);
}
