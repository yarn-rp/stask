/**
 * stask create — Create a new task.
 *
 * Usage:
 *   stask create --name "Task Name" [--type Feature|Task|Bug]           → Backlog (no spec)
 *   stask create --name "Task Name" --spec <spec-path> [--type ...]     → To-Do (with spec)
 */

import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack, setThreadRef } from '../lib/slack-row.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec' && argv[i + 1]) args.spec = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
    else if (argv[i] === '--type' && argv[i + 1]) args.type = argv[++i];
    else if (argv[i] === '--use-canvas') args.useCanvas = true;
  }
  return args;
}

/**
 * Discover the list item's comment thread on the list channel.
 * Slack Lists internally use a channel (list ID with F→C prefix swap).
 * Each list item gets a thread whose ts shares the same epoch second
 * as the item's date_created.
 *
 * @param {object} slackApi - Slack API module
 * @param {string} listChannelId - List channel ID (C-prefixed)
 * @param {number} itemDateCreated - Item's date_created (Unix epoch)
 */
async function discoverListItemThread(slackApi, listChannelId, itemDateCreated) {
  const epoch = String(itemDateCreated);
  const oldest = String(itemDateCreated - 2);
  const latest = String(itemDateCreated + 5);

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await slackApi.getChannelHistory(listChannelId, { oldest, latest, limit: 10 });
    const messages = result.messages || [];
    const match = messages.find(m => m.ts && m.ts.startsWith(epoch + '.'));
    if (match) return match.ts;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.name) {
    console.error('Usage: stask create --name "Task Name" [--spec <spec-path>] [--type Feature|Task|Bug]');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const hasSpec = !!args.spec;
  const useCanvas = !!args.useCanvas;
  let specValue = null;
  let fileId = null;
  let canvasId = null;

  if (hasSpec) {
    const ws = CONFIG.specsDir;
    const relPath = args.spec.startsWith('shared/') ? args.spec : path.relative(ws, path.resolve(args.spec));
    const fullPath = path.resolve(ws, relPath);

    // Validate spec exists
    libs.validate.validateSpecExists(relPath);

    const specName = relPath.replace(/^shared\//, '');
    const content = fs.readFileSync(fullPath, 'utf-8');

    if (useCanvas) {
      // Upload spec as a Canvas instead of a File
      const { extractFrontmatter } = await import('../lib/yaml-frontmatter.mjs');
      const { markdownToCanvas } = await import('../lib/canvas-format.mjs');
      const { body } = extractFrontmatter(content);
      const docContent = markdownToCanvas(body);
      const canvasResult = await libs.slackApi.createCanvas({
        title: specName,
        document_content: docContent,
      });
      canvasId = canvasResult.canvas_id;
      specValue = libs.validate.formatSpecValue(specName, canvasId, 'canvas');
      console.error(`Created spec Canvas: ${canvasId}`);
    } else {
      // Upload spec as a Slack File (original behavior)
      const registry = libs.fileUploader.loadRegistry(CONFIG.registryPath);
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

      specValue = libs.validate.formatSpecValue(specName, fileId, 'file');
    }
  }

  const initialStatus = hasSpec ? 'To-Do' : 'Backlog';
  const initialAssignee = hasSpec ? CONFIG.human.name : null;

  const result = await withTransaction(
    (db, libs) => {
      const taskId = libs.trackerDb.getNextTaskId();

      const taskFields = {
        task_id: taskId,
        task_name: args.name,
        status: initialStatus,
        type: args.type || 'Feature',
      };
      if (initialAssignee) taskFields.assigned_to = initialAssignee;
      if (specValue) taskFields.spec = specValue;

      libs.trackerDb.insertTask(taskFields);

      const logSpec = specValue ? `Spec: ${specValue}. ` : '';
      const logAssign = initialAssignee ? ` → ${initialAssignee}` : '';
      libs.trackerDb.addLogEntry(taskId, `${taskId} "${args.name}" created. ${logSpec}Status: ${initialStatus}${logAssign}.`);

      const taskRow = libs.trackerDb.findTask(taskId);
      return { taskId, taskRow, specValue };
    },
    async ({ taskRow }, db) => {
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      return slackOps;
    }
  );

  // Post-commit: discover list item thread and post creation message (best-effort)
  try {
    const listChannelId = CONFIG.slack.listId.replace(/^F/, 'C');
    const db = libs.trackerDb.getDb();
    // Get the Slack item's date_created (Unix epoch) to match the thread ts
    const { getSlackRowId } = await import('../lib/slack-row.mjs');
    const rowId = getSlackRowId(db, result.taskId);
    const itemInfo = await libs.slackApi.slackApiRequest('POST', '/slackLists.items.info', {
      list_id: CONFIG.slack.listId, id: rowId,
    });
    const dateCreated = itemInfo.record?.date_created;
    if (dateCreated) {
      const threadTs = await discoverListItemThread(libs.slackApi, listChannelId, dateCreated);
      if (threadTs) {
        const humanMention = `<@${CONFIG.human.slackUserId}>`;
        const msg = hasSpec
          ? `Creating this thread to discuss *${result.taskId}: ${args.name}*. This will be the thread where we post updates and talk about this task.\n\n${humanMention} spec is ready for your review. Let me know what you think!`
          : `Creating this thread to discuss *${result.taskId}: ${args.name}*. This will be the thread where we post updates and talk about this task.\n\nStatus: *Backlog* — no spec yet. Discuss requirements here before writing the spec.`;
        await libs.slackApi.postMessage(listChannelId, msg, { threadTs });
        setThreadRef(db, result.taskId, listChannelId, threadTs);
      }
    }
  } catch (err) {
    console.error(`WARNING: Thread linking failed: ${err.message}`);
  }

  const assignLabel = initialAssignee || 'Unassigned';
  const specLabel = canvasId || fileId || 'None';
  const specType = useCanvas ? 'Canvas' : 'File';
  console.log(`Created ${result.taskId}: "${args.name}" | Status: ${initialStatus} | Assigned: ${assignLabel} | Spec (${specType}): ${specLabel}`);
}
