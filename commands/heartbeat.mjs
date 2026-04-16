/**
 * stask heartbeat — Get pending work for an agent (JSON output).
 *
 * Usage: stask heartbeat <agent-name>
 *
 * Session-aware: skips tasks claimed by other live sessions.
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withDb } from '../lib/tx.mjs';
<<<<<<< HEAD
import { getThreadRef } from '../lib/slack-row.mjs';
=======
import { withTransaction } from '../lib/tx.mjs';
import { syncTaskToSlack } from '../lib/slack-row.mjs';
import { logError } from '../lib/error-logger.mjs';
>>>>>>> origin/main
import { isTaskClaimable } from '../lib/session-tracker.mjs';
import { getLeadAgent } from '../lib/roles.mjs';

export async function run(argv) {
  const agentName = argv[0];

  if (!agentName) {
    console.error('Usage: stask heartbeat <agent-name>');
    process.exit(1);
  }

  const agentDisplayName = agentName.charAt(0).toUpperCase() + agentName.slice(1).toLowerCase();
  const agentConfig = CONFIG.agents[agentName.toLowerCase()];

  if (!agentConfig) {
    console.error(`ERROR: Unknown agent "${agentName}". Known agents: ${Object.keys(CONFIG.agents).join(', ')}`);
    process.exit(1);
  }

  const agentRole = agentConfig.role;

  const result = await withDb((db, libs) => {
    const allTasks = libs.trackerDb.getAllTasks();
    const myTasks = allTasks.filter(t => t['Assigned To'] === agentDisplayName);

    if (myTasks.length === 0) {
      return { agent: agentName, pendingTasks: [], inboxItems: [], config: { staleSessionMinutes: CONFIG.staleSessionMinutes } };
    }

    const pendingTasks = [];
    const workerSubtaskQueue = [];

    for (const task of myTasks) {
      const taskId = task['Task ID'];
      const status = task['Status'];
      const isSubtask = task['Parent'] !== 'None';
      const hasSubtasks = libs.trackerDb.getSubtasks(taskId).length > 0;

      if (status === 'Done' || status === 'Blocked') continue;

      // Session awareness: skip if claimed by another agent's live session
      if (!isTaskClaimable(db, taskId, agentName)) continue;

      const specParsed = libs.validate.parseSpecValue(task['Spec']);
      const specFileId = specParsed?.fileId || 'unknown';

      let action = null;
      let prompt = null;

      // ─── Lead actions ──────────────────────────────────────────
      if (agentRole === 'lead') {
        if (status === 'To-Do' && !hasSubtasks) {
          action = 'delegate';
          const workers = Object.entries(CONFIG.agents)
            .filter(([, a]) => a.role === 'worker')
            .map(([n]) => n.charAt(0).toUpperCase() + n.slice(1));
          prompt = `Task ${taskId} "${task['Task Name']}" spec has been approved. Create subtasks and delegate to the appropriate builders (${workers.join(', ')}). Spec file ID: ${specFileId}. After creating subtasks, transition the parent to In-Progress.`;
        } else if (status === 'Testing' && !isSubtask) {
          action = 'create-pr';
          const wt = libs.trackerDb.getParentWorktree(taskId);
          const wtInstruction = wt ? ` Worktree: ${wt.path} (branch: ${wt.branch}).` : '';

          const qaReports = [task['QA Report 1'], task['QA Report 2'], task['QA Report 3']]
            .filter(r => r !== 'None');

          const subtasksList = libs.trackerDb.getSubtasks(taskId)
            .map(s => `- ${s['Task ID']}: ${s['Task Name']} (${s['Assigned To']})`)
            .join('\n');

          prompt = `Task ${taskId} "${task['Task Name']}" has PASSED QA. Create a pull request and transition to Ready for Human Review.

SPEC: File ID ${specFileId}. Read it for the full context of what was built.

SUBTASKS COMPLETED:
${subtasksList}

QA REPORT(S): ${qaReports.join(', ')}
Download and read the QA report(s) from Slack. Include test results and reference screenshots in the PR description.

WORKTREE:${wtInstruction}

YOUR JOB:
1. Read the spec — understand what was built and why
2. Read the QA report — what was tested, results, screenshots
3. Review the git log: cd to worktree, run \`git log --oneline main..HEAD\`
4. Review the diff: \`git diff main..HEAD --stat\`
5. Write a rich PR description:
   - **Summary:** what was built and why (from spec)
   - **Changes:** key files changed and what each does (from diff)
   - **Testing:** QA results — which ACs passed, reference screenshots (from QA report)
   - **Acceptance Criteria:** checklist from spec, all checked off
6. Create the draft PR:
   \`gh pr create --base main --head <branch> --title "<concise title>" --body "<your description>" --draft\`
7. Run: \`stask transition ${taskId} "Ready for Human Review"\`

The PR description is what Yan sees first. Make it count.`;
        } else if (status === 'In-Progress' && !isSubtask && hasSubtasks) {
          const taskLog = libs.trackerDb.getLogForTask(taskId);
          const hasQaFail = taskLog.some(e => e.message.includes('QA FAIL'));
          if (hasQaFail) {
            action = 'review-qa-failure';
            const wt = libs.trackerDb.getParentWorktree(taskId);
            const wtInstruction = wt ? ` Worktree: ${wt.path} (branch: ${wt.branch}).` : '';
            prompt = `Task ${taskId} "${task['Task Name']}" returned from QA failure. Review the latest QA report. Identify what failed, then re-delegate fixes. Spec file ID: ${specFileId}.${wtInstruction}`;
          }
        }
        // PR status checks removed — now handled by inbox-pollerd.mjs daemon
      }

      // ─── Worker actions (collected, grouped by parent after loop) ─
      if (agentRole === 'worker' && status === 'In-Progress' && isSubtask) {
        workerSubtaskQueue.push({ task, specFileId });
      }

      // ─── QA actions ────────────────────────────────────────────
      if (agentRole === 'qa' && status === 'Testing' && !isSubtask) {
        action = 'qa';
        const wt = libs.trackerDb.getParentWorktree(taskId);
        const wtInstruction = wt ? `\nIMPORTANT: The code to test is in the task worktree at: ${wt.path} (branch: ${wt.branch}).` : '';
        prompt = `QA task ${taskId}: "${task['Task Name']}". Spec file ID: ${specFileId}. Read the spec for acceptance criteria.${wtInstruction}\nTest each AC via browser at http://localhost:3000. Write QA report to shared/qa-reports/. Submit via: stask qa ${taskId} --report shared/qa-reports/<your-report>.md --verdict <PASS|FAIL>`;
      }

      if (action && prompt) {
        const threadRef = getThreadRef(db, isSubtask ? task['Parent'] : taskId);
        const thread = threadRef ? { channelId: threadRef.channelId, threadTs: threadRef.threadTs } : null;
        pendingTasks.push({ taskId, taskName: task['Task Name'], status, parent: task['Parent'], specFileId, action, prompt, thread });
      }
    }

    // ─── Group worker subtasks by parent into batch entries ────
    if (workerSubtaskQueue.length > 0) {
      const grouped = new Map();
      for (const { task, specFileId } of workerSubtaskQueue) {
        const parentId = task['Parent'];
        if (!grouped.has(parentId)) grouped.set(parentId, []);
        grouped.get(parentId).push({ task, specFileId });
      }

      for (const [parentId, subtasks] of grouped) {
        const wt = libs.trackerDb.getParentWorktree(parentId);
        const wtInstruction = wt
          ? `\nWORKTREE: ${wt.path} (branch: ${wt.branch}). cd there before making any changes.`
          : '';

        const subtaskList = subtasks.map((s, i) =>
          `${i + 1}. ${s.task['Task ID']}: "${s.task['Task Name']}"`
        ).join('\n');

        const doneCommands = subtasks.map(s =>
          `npx @web42/stask subtask done ${s.task['Task ID']}`
        ).join('\n');

        const prompt = `You have ${subtasks.length} subtask(s) to implement IN ORDER. Complete each one fully before moving to the next.
${wtInstruction}

SUBTASKS:
${subtaskList}

Spec file ID: ${subtasks[0].specFileId}. Read the spec for full details on each subtask.

WORKFLOW — for each subtask:
1. Read the relevant spec section for that subtask
2. Implement the changes
3. git add + git commit with a clear message referencing the subtask ID
4. git push
5. Run: npx @web42/stask subtask done <subtask-id>
6. Post progress to the task thread
7. Run /compact to free up context before starting the next subtask

DONE COMMANDS (run after completing each):
${doneCommands}

IMPORTANT: Complete subtasks sequentially. Commit, push, and mark done after EACH one. Use /compact between subtasks to manage context.`;

        const threadRef = getThreadRef(db, parentId);
        const thread = threadRef ? { channelId: threadRef.channelId, threadTs: threadRef.threadTs } : null;

        if (subtasks.length === 1) {
          const s = subtasks[0];
          const singleWt = wt
            ? `\nIMPORTANT: Work in the task worktree at: ${wt.path} (branch: ${wt.branch}). cd to that directory before making any changes.`
            : '';
          pendingTasks.push({
            taskId: s.task['Task ID'],
            taskName: s.task['Task Name'],
            status: s.task['Status'],
            parent: parentId,
            specFileId: s.specFileId,
            action: 'build',
            prompt: `Build subtask ${s.task['Task ID']}: "${s.task['Task Name']}". Spec file ID: ${s.specFileId}. Read the spec from shared/specs/ for full details.${singleWt}\nWhen complete, run: npx @web42/stask subtask done ${s.task['Task ID']}`,
            thread,
          });
        } else {
          pendingTasks.push({
            taskId: parentId,
            taskName: `[${subtasks.length} subtasks] ${subtasks.map(s => s.task['Task ID']).join(', ')}`,
            status: 'In-Progress',
            parent: 'None',
            specFileId: subtasks[0].specFileId,
            action: 'build-batch',
            prompt,
            thread,
            subtaskIds: subtasks.map(s => s.task['Task ID']),
          });
        }
      }
    }

    // ─── Unprocessed inbox items ──────────────────────────────
    let inboxItems = [];
    try {
      libs.trackerDb.ensureInboxTables();
      inboxItems = libs.trackerDb.getNewInboxItems();
    } catch {
      // inbox tables may not exist yet
    }

    return { agent: agentName, pendingTasks, inboxItems, config: { staleSessionMinutes: CONFIG.staleSessionMinutes } };
  });

<<<<<<< HEAD
=======
  // Process PR status reports (async — uploads to Slack, updates DB)
  if (prStatusQueue.length > 0) {
    const libs = await getWorkspaceLibs();
    const db = libs.trackerDb.getDb();
    for (const { task, prData } of prStatusQueue) {
      try {
        await withTransaction(
          (db, libs) => {
            // The actual changes are handled by generateAndUploadPrStatus
            const fileId = await generateAndUploadPrStatus(task, prData, libs);
            return { fileId };
          },
          async ({ fileId }, db) => {
            const updatedTask = libs.trackerDb.findTask(task['Task ID']);
            const { slackOps } = await syncTaskToSlack(db, updatedTask);
            return slackOps;
          }
        );
        console.error(`PR status report updated for ${task['Task ID']}`);
      } catch (err) {
        logError({
          source: 'heartbeat',
          operation: 'pr_status_update',
          taskId: task['Task ID'],
          error: err
        });
        console.error(`WARNING: PR status report failed for ${task['Task ID']}: ${err.message}`);
      }
    }
  }

>>>>>>> origin/main
  console.log(JSON.stringify(result, null, 2));
}