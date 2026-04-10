/**
 * stask qa — Submit QA verdict for a task.
 *
 * Usage: stask qa <task-id> --report <path> [--screenshots <dir>] [--verdict PASS|FAIL|PASS_WITH_ISSUES]
 */

import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';
import { getAutoAssign, getLeadAgent } from '../lib/roles.mjs';

const TRIGGER_SQL = `
  CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON tasks WHEN OLD.status != NEW.status
  BEGIN SELECT CASE
    WHEN OLD.status = 'Done' THEN RAISE(ABORT, 'Cannot transition from Done')
    WHEN OLD.status = 'To-Do' AND NEW.status NOT IN ('In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from To-Do')
    WHEN OLD.status = 'In-Progress' AND NEW.status NOT IN ('Testing','Blocked') THEN RAISE(ABORT, 'Invalid from In-Progress')
    WHEN OLD.status = 'Testing' AND NEW.status NOT IN ('Ready for Human Review','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from Testing')
    WHEN OLD.status = 'Ready for Human Review' AND NEW.status NOT IN ('Done','In-Progress','Blocked') THEN RAISE(ABORT, 'Invalid from RHR')
    WHEN OLD.status = 'Blocked' AND NEW.status NOT IN ('To-Do','In-Progress','Testing','Ready for Human Review') THEN RAISE(ABORT, 'Invalid from Blocked')
  END; END;
`;

function parseArgs(argv) {
  const args = { taskId: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--report' && argv[i + 1]) args.report = argv[++i];
    else if (argv[i] === '--screenshots' && argv[i + 1]) args.screenshots = argv[++i];
    else if (argv[i] === '--verdict' && argv[i + 1]) args.verdict = argv[++i];
  }
  return args;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (!args.taskId || !args.report) {
    console.error('Usage: stask qa <task-id> --report <path> [--screenshots <dir>] [--verdict PASS|FAIL]');
    process.exit(1);
  }

  const verdict = (args.verdict || 'PASS').toUpperCase();
  if (!['PASS', 'FAIL', 'PASS_WITH_ISSUES'].includes(verdict)) {
    console.error('ERROR: Verdict must be PASS, FAIL, or PASS_WITH_ISSUES');
    process.exit(1);
  }

  const libs = await getWorkspaceLibs();
  const ws = CONFIG.specsDir;

  const task = libs.trackerDb.findTask(args.taskId);
  if (!task) { console.error(`ERROR: Task ${args.taskId} not found`); process.exit(1); }
  if (task['Status'] !== 'Testing') { console.error(`ERROR: ${args.taskId} is "${task['Status']}". Must be "Testing".`); process.exit(1); }

  // Upload QA report
  const registry = libs.fileUploader.loadRegistry(CONFIG.registryPath);

  async function uploadAndRegister(filePath) {
    const relPath = filePath.startsWith('shared/') ? filePath : path.relative(ws, path.resolve(filePath));
    const fullPath = path.resolve(ws, relPath);
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const existing = registry.files[relPath];
    if (existing && existing.hash === hash && existing.fileId) return { fileId: existing.fileId, relPath };
    const filename = path.basename(relPath);
    const fileId = await libs.slackApi.uploadFile(filename, content);
    registry.files[relPath] = { fileId, hash, title: filename, uploadedAt: new Date().toISOString(), sizeBytes: content.length };
    return { fileId, relPath };
  }

  const reportResult = await uploadAndRegister(args.report);
  if (!reportResult) { console.error(`ERROR: QA report not found: ${args.report}`); process.exit(1); }
  console.log(`Uploaded report: ${reportResult.fileId}`);

  // Bundle screenshots
  const allFileIds = [reportResult.fileId];
  const screenshotsDir = args.screenshots || path.join(path.dirname(path.resolve(ws, reportResult.relPath)), 'screenshots');
  const screenshotsDirFull = path.resolve(ws, screenshotsDir.startsWith('shared/') ? screenshotsDir : path.relative(ws, path.resolve(screenshotsDir)));

  if (fs.existsSync(screenshotsDirFull)) {
    const imageFiles = fs.readdirSync(screenshotsDirFull).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
    if (imageFiles.length > 0) {
      const reportFullPath = path.resolve(ws, reportResult.relPath);
      const zipName = `${args.taskId}-qa-bundle.zip`;
      const zipPath = path.join(path.dirname(reportFullPath), zipName);
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        execSync(`zip -j "${zipPath}" "${reportFullPath}"`, { stdio: 'pipe' });
        const imgPaths = imageFiles.map(f => `"${path.join(screenshotsDirFull, f)}"`).join(' ');
        execSync(`zip -j "${zipPath}" ${imgPaths}`, { stdio: 'pipe' });
        const zipContent = fs.readFileSync(zipPath);
        const zipFileId = await libs.slackApi.uploadFile(zipName, zipContent, 'application/zip');
        allFileIds.push(zipFileId);
        const zipRelPath = path.relative(ws, zipPath);
        const zipHash = createHash('sha256').update(zipContent).digest('hex').slice(0, 16);
        registry.files[zipRelPath] = { fileId: zipFileId, hash: zipHash, title: zipName, uploadedAt: new Date().toISOString(), sizeBytes: zipContent.length };
      } catch (err) { console.error(`WARNING: Failed to create zip: ${err.message}`); }
    }
  }

  libs.fileUploader.saveRegistry(CONFIG.registryPath, registry);

  // Determine outcome
  const currentFailCount = task['qa_fail_count'] || 0;
  const reportRef = allFileIds.map(id => `(${id})`).join(' ');
  let newStatus, newAssignee;
  const updates = {};

  if (verdict !== 'FAIL') {
    updates[`qa_report_${currentFailCount + 1}`] = reportRef;
    // QA PASS → stays in Testing, reassigned to Lead.
    // Lead creates a rich PR with full context, then transitions to RHR.
    newStatus = 'Testing';
    newAssignee = getLeadAgent();
  } else if (currentFailCount + 1 >= CONFIG.maxQaRetries) {
    updates[`qa_report_${currentFailCount + 1}`] = reportRef;
    updates.qa_fail_count = currentFailCount + 1;
    newStatus = 'Blocked';
    newAssignee = CONFIG.human.name;
    console.error(`QA failed ${currentFailCount + 1} times. Escalating to ${CONFIG.human.name}.`);
  } else {
    updates[`qa_report_${currentFailCount + 1}`] = reportRef;
    updates.qa_fail_count = currentFailCount + 1;
    newStatus = 'In-Progress';
    newAssignee = getLeadAgent();
    console.error(`QA failure #${currentFailCount + 1}/${CONFIG.maxQaRetries}. Back to ${newAssignee} for fixes.`);
  }

  updates.status = newStatus;
  if (newAssignee) updates.assigned_to = newAssignee;

  await withTransaction(
    (db, libs) => {
      libs.trackerDb.updateTask(args.taskId, updates);

      // Cascade to subtasks
      const subtasks = libs.trackerDb.getSubtasks(args.taskId);
      const cascaded = [];
      if (subtasks.length > 0) {
        db.exec('DROP TRIGGER IF EXISTS validate_status_transition');
        try {
          for (const sub of subtasks) {
            if (sub['Status'] === 'Done' || sub['Status'] === newStatus) continue;
            const subUpdates = [newStatus];
            let sql = 'UPDATE tasks SET status = ?';
            if (newAssignee && newStatus !== 'In-Progress') { sql += ', assigned_to = ?'; subUpdates.push(newAssignee); }
            sql += ' WHERE task_id = ?';
            subUpdates.push(sub['Task ID']);
            db.prepare(sql).run(...subUpdates);
            cascaded.push(sub['Task ID']);
          }
        } finally {
          db.exec(TRIGGER_SQL);
        }
      }

      const bundleNote = allFileIds.length > 1 ? ' + bundle zip' : '';
      libs.trackerDb.addLogEntry(args.taskId, `${args.taskId} "${task['Task Name']}": QA ${verdict} by QA. Report: ${reportResult.fileId}${bundleNote}. Testing → ${newStatus}.`);

      const updatedTask = libs.trackerDb.findTask(args.taskId);
      const cascadedTasks = cascaded.map(id => libs.trackerDb.findTask(id));
      return { taskRow: updatedTask, cascadedTasks };
    },
    async ({ taskRow, cascadedTasks }, db) => {
      const allOps = [];
      const { slackOps } = await syncTaskToSlack(db, taskRow);
      allOps.push(...slackOps);
      for (const sub of cascadedTasks) {
        if (!sub) continue;
        try { const { slackOps: subOps } = await syncTaskToSlack(db, sub); allOps.push(...subOps); } catch {}
      }
      return allOps;
    }
  );

  console.log(`${args.taskId}: QA ${verdict} | Testing → ${newStatus} | Attachments: ${allFileIds.length}`);
}
