/**
 * stask heartbeat — Get pending work for an agent (JSON output).
 *
 * Usage: stask heartbeat <agent-name>
 *
 * Session-aware: skips tasks claimed by other live sessions.
 *
 * Solo-agent pipeline: one project agent owns every task end to end. This
 * command returns the flat list of active tasks the agent is assigned to,
 * with a suggested action per task (requirements-analysis / plan / build /
 * qa / create-pr / review-qa-failure). The agent decides what to drive
 * forward per tick based on the phase loop in HEARTBEAT.md.
 *
 * Coding CLI (`acpx <agent>`) is configured per-project in `.stask/config.json`
 * under `acp.agent`. This command does not hard-code it — prompts just say
 * "acpx" and the agent's BODY.md knows which backend to drive.
 */

import { CONFIG } from '../lib/env.mjs';
import { withDb } from '../lib/tx.mjs';
import { getThreadRef } from '../lib/slack-row.mjs';
import { isTaskClaimable } from '../lib/session-tracker.mjs';

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
  const acpAgent = CONFIG.acp?.agent || 'codex';

  const result = await withDb((db, libs) => {
    const allTasks = libs.trackerDb.getAllTasks();
    const myTasks = allTasks.filter(t => t['Assigned To'] === agentDisplayName);

    if (myTasks.length === 0) {
      return emptyResponse(agentName, agentRole);
    }

    const pendingTasks = [];

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
      const wt = libs.trackerDb.getParentWorktree(isSubtask ? task['Parent'] : taskId);
      const wtInstruction = wt ? ` Worktree: ${wt.path} (branch: ${wt.branch}).` : '';

      let action = null;
      let prompt = null;

      // Backlog parent → requirements analysis
      if (status === 'Backlog' && !isSubtask) {
        action = 'requirements-analysis';
        prompt = `Task ${taskId} "${task['Task Name']}" is in Backlog. Drive requirements analysis: spawn (or resume) your exploration session via \`acpx ${acpAgent} -s "<threadId>:explore" --cwd ${wt?.path || '<repo>'} --ttl 0 ...\`, alternate clarifying questions in Slack with codebase questions to acpx, then write the spec and transition to Ready for Human Review. Spec file ID once written: ${specFileId}.`;
      }
      // To-Do parent, no subtasks yet → plan + create subtasks
      else if (status === 'To-Do' && !isSubtask && !hasSubtasks) {
        action = 'plan';
        prompt = `Task ${taskId} "${task['Task Name']}" spec has been approved. Create an ordered subtask list from the spec and assign each subtask to yourself. Spec file ID: ${specFileId}. After creating subtasks, transition the parent to In-Progress. On the next tick you'll start running them in your \`<threadId>:code\` acpx session.`;
      }
      // In-Progress subtask assigned to you → build it via the <threadId>:code session
      else if (status === 'In-Progress' && isSubtask) {
        action = 'build';
        prompt = `Build subtask ${taskId}: "${task['Task Name']}". Spec file ID: ${specFileId}.${wtInstruction}\n\nRun this subtask inside your task-lifecycle coding session: \`acpx ${acpAgent} -s "<threadId>:code" --cwd ${wt?.path || '<repo>'} --ttl 0 "<subtask prompt>"\`. The session persists across all subtasks for this task — subsequent subtasks reuse the same \`-s\` name. acpx ${acpAgent} --version must succeed before you start; if it doesn't, fail loud and report up the chain.\n\nWhen complete, run: stask subtask done ${taskId}`;
      }
      // Testing parent → QA via a fresh <threadId>:qa session
      else if (status === 'Testing' && !isSubtask) {
        // If the task has QA reports and PASSED, time to open the PR.
        const qaReports = [task['QA Report 1'], task['QA Report 2'], task['QA Report 3']].filter(r => r !== 'None');
        const taskLog = libs.trackerDb.getLogForTask(taskId);
        const passed = taskLog.some(e => e.message.includes('QA PASS'));
        if (passed) {
          action = 'create-pr';
          const subtasksList = libs.trackerDb.getSubtasks(taskId)
            .map(s => `- ${s['Task ID']}: ${s['Task Name']}`)
            .join('\n');
          prompt = `Task ${taskId} "${task['Task Name']}" has PASSED QA. Create a pull request and transition to Ready for Human Review.

SPEC: File ID ${specFileId}. Read it for the full context of what was built.

SUBTASKS COMPLETED:
${subtasksList}

QA REPORT(S): ${qaReports.join(', ')}
Include test results and reference screenshots in the PR description.

WORKTREE:${wtInstruction}

YOUR JOB:
1. Read the spec — understand what was built and why
2. Read the QA report — what was tested, results, screenshots
3. Review the git log: cd to worktree, run \`git log --oneline main..HEAD\`
4. Review the diff: \`git diff main..HEAD --stat\`
5. Write a rich PR description (Summary / Changes / Testing / Acceptance Criteria)
6. Create the draft PR: \`gh pr create --base main --head <branch> --title "<title>" --body "<body>" --draft\`
7. Run: \`stask transition ${taskId} "Ready for Human Review"\`

The PR description is what humans see first. Make it count.`;
        } else {
          action = 'qa';
          prompt = `QA task ${taskId}: "${task['Task Name']}". Spec file ID: ${specFileId}.${wtInstruction}\n\nRun verification in a **fresh** acpx session: \`acpx ${acpAgent} -s "<threadId>:qa" --cwd ${wt?.path || '<repo>'} --ttl 0 "<test prompt from spec acceptance criteria>"\`. This is intentionally separate from the \`<threadId>:code\` session — QA does not inherit the coder's assumptions.\n\nTest each acceptance criterion, write a QA report to shared/qa-reports/<name>.md, and submit via: stask qa ${taskId} --report shared/qa-reports/<your-report>.md --verdict <PASS|FAIL>`;
        }
      }
      // In-Progress parent with subtasks + logged QA failure → review & refix
      else if (status === 'In-Progress' && !isSubtask && hasSubtasks) {
        const taskLog = libs.trackerDb.getLogForTask(taskId);
        const hasQaFail = taskLog.some(e => e.message.includes('QA FAIL'));
        if (hasQaFail) {
          action = 'review-qa-failure';
          prompt = `Task ${taskId} "${task['Task Name']}" returned from QA failure. Review the latest QA report via your persistent \`<threadId>:explore\` session (it retains prior spec context). Identify what failed, create fix-subtasks assigned to yourself, and re-enter the \`<threadId>:code\` session to apply them — same session name, resumes where it left off. Spec file ID: ${specFileId}.${wtInstruction}`;
        }
      }

      if (action && prompt) {
        const threadRef = getThreadRef(db, isSubtask ? task['Parent'] : taskId);
        const thread = threadRef ? { channelId: threadRef.channelId, threadTs: threadRef.threadTs } : null;
        const worktree = wt ? { path: wt.path, branch: wt.branch } : null;
        pendingTasks.push({ taskId, taskName: task['Task Name'], status, parent: task['Parent'], specFileId, action, prompt, thread, worktree });
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

    return {
      agent: agentName,
      role: agentRole,
      pendingTasks,
      inboxItems,
      config: {
        staleSessionMinutes: CONFIG.staleSessionMinutes,
        acpAgent,
      },
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

function emptyResponse(agentName, agentRole) {
  return {
    agent: agentName,
    role: agentRole,
    pendingTasks: [],
    inboxItems: [],
    config: { staleSessionMinutes: CONFIG.staleSessionMinutes, acpAgent: CONFIG.acp?.agent || 'codex' },
  };
}
