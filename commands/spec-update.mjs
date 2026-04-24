/**
 * stask spec-update — Re-upload edited spec and update DB.
 *
 * Usage: stask spec-update <task-id> --spec <path>
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bundled templates that ship with the stask package — referenced as
// `shared/...` paths. Checked as a fallback when the project's specsDir
// doesn't contain the file.
const BUNDLED_SHARED_DIR = path.resolve(__dirname, '..', 'shared');
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';

export async function run(argv) {
  const taskId = argv[0];
  let specPath;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--spec' && argv[i + 1]) specPath = argv[++i];
  }

  if (!taskId || !specPath) {
    console.error('Usage: stask spec-update <task-id> --spec <path>');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const ws = CONFIG.specsDir;

  const task = libs.trackerDb.findTask(taskId);
  if (!task) { console.error(`ERROR: Task ${taskId} not found`); process.exit(1); }

  const relPath = specPath.startsWith('shared/') ? specPath : path.relative(ws, path.resolve(specPath));
  const projectPath = path.resolve(ws, relPath);
  const bundledPath = relPath.startsWith('shared/')
    ? path.resolve(BUNDLED_SHARED_DIR, relPath.slice('shared/'.length))
    : null;
  const fullPath = fs.existsSync(projectPath)
    ? projectPath
    : (bundledPath && fs.existsSync(bundledPath) ? bundledPath : null);
  if (!fullPath) { console.error(`ERROR: Spec not found: ${relPath}`); process.exit(1); }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const registry = libs.fileUploader.loadRegistry(CONFIG.registryPath);
  const filename = path.basename(relPath);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const fileId = await libs.slackApi.uploadFile(filename, content);
  registry.files[relPath] = { fileId, hash, title: filename, uploadedAt: new Date().toISOString(), sizeBytes: Buffer.byteLength(content, 'utf-8') };
  libs.fileUploader.saveRegistry(CONFIG.registryPath, registry);

  const specName = relPath.replace(/^shared\//, '');
  const specValue = libs.validate.formatSpecValue(specName, fileId);

  await withTransaction(
    (db, libs) => {
      libs.trackerDb.updateTask(taskId, { spec: specValue });
      libs.trackerDb.addLogEntry(taskId, `${taskId} spec updated: ${specValue}`);
      const updated = libs.trackerDb.findTask(taskId);
      return { taskRow: updated };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  console.log(`${taskId}: Spec updated → ${fileId}`);
}
