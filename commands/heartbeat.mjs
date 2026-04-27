/**
 * stask heartbeat — Get pending work for an agent (JSON output).
 *
 * Usage: stask heartbeat <agent-name>
 *
 * Session-aware: skips tasks claimed by other live sessions.
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withDb } from '../lib/tx.mjs';
import { getThreadRef } from '../lib/slack-row.mjs';
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
    const myTasks = libs.trackerDb.getTasksByAssignee(agentDisplayName);

    if (myTasks.length === 0) {
      return {
        agent: agentName,
        pendingTasks: [],
        summary: { totalAssignedOpen: 0, awaitingApproval: 0 },
        inboxItems: [],
        config: { staleSessionMinutes: CONFIG.staleSessionMinutes },
      };
    }

    const pendingTasks = [];
    const workerSubtaskQueue = [];
    // Track which task IDs got a rich-prompt entry so the resume pass can skip them.
    const handledTaskIds = new Set();

    // Approval gate: a task is "approved" iff the human ticked the
    // spec_approved checkbox in Slack — slack-reconcile persists that as
    // spec_approved_at. For subtasks the parent's approval is what counts.
    // Unapproved tasks never produce work-starting prompts. For the lead,
    // they produce a `request-approval` action (ping the human in Slack);
    // for workers / QA they're skipped (the lead owns approval shepherding).
    const isApproved = (task) => {
      if (task['Parent'] !== 'None') {
        const parent = libs.trackerDb.findTask(task['Parent']);
        return Boolean(parent?.['spec_approved_at']);
      }
      return Boolean(task['spec_approved_at']);
    };

    // Idempotency for `request-approval`: don't re-ping more than once
    // every APPROVAL_PING_COOLDOWN_MIN minutes per task. The action prompt
    // tells the agent to write a log entry matching APPROVAL_LOG_PATTERN
    // after posting the Slack message.
    const APPROVAL_LOG_PATTERN = /\[approval-request\]/;
    const APPROVAL_PING_COOLDOWN_MIN = 360; // 6h
    const recentlyPingedForApproval = (taskId) => {
      const taskLog = libs.trackerDb.getLogForTask(taskId);
      const last = taskLog.find(e => APPROVAL_LOG_PATTERN.test(e.message));
      if (!last) return false;
      const ts = new Date(last.created_at + 'Z').getTime();
      if (Number.isNaN(ts)) return false;
      return (Date.now() - ts) / 60000 < APPROVAL_PING_COOLDOWN_MIN;
    };

    // Counts for the slim summary returned at the end.
    let totalAssignedOpen = 0;
    let awaitingApprovalCount = 0;

    for (const task of myTasks) {
      const taskId = task['Task ID'];
      const status = task['Status'];
      const isSubtask = task['Parent'] !== 'None';
      const hasSubtasks = libs.trackerDb.getSubtasks(taskId).length > 0;

      if (status === 'Done' || status === 'Blocked') continue;

      // Liveness is the consumer's job: HEARTBEAT.md filters via OpenClaw
      // sessions_list(activeMinutes=10) on label `pipeline:<taskId>`. Heartbeat
      // surfaces every open task; the consumer decides whether to spawn.

      totalAssignedOpen += 1;
      const approved = isApproved(task);
      if (!approved) awaitingApprovalCount += 1;

      const specParsed = libs.validate.parseSpecValue(task['Spec']);
      const specFileId = specParsed?.fileId || 'unknown';

      let action = null;
      let prompt = null;

      // ─── Lead: ping human for approval on unapproved tasks ────
      // Catches the bug at heartbeat time, not after we've spawned a
      // subagent that reads "do not work" and exits. Cooldown prevents
      // re-pinging every cron tick.
      if (agentRole === 'lead' && !approved && !isSubtask) {
        if (!recentlyPingedForApproval(taskId)) {
          action = 'request-approval';
          prompt = `Task ${taskId} "${task['Task Name']}" is assigned to you but the human has not approved the spec. No work may start until they tick the spec_approved checkbox in Slack.

Spec file ID: ${specFileId}.

YOUR JOB — do this and exit:
1. Read the spec briefly. If it's still missing detail or has open questions, surface those concretely.
2. Post one message to the task thread asking ${CONFIG.human.name} to approve the spec. If you have open questions, list them in the same message so they're answered before approval. Be concise.
3. Record the ping so we don't re-ping every heartbeat tick:
   \`stask log ${taskId} "[approval-request] pinged ${CONFIG.human.name} for spec approval"\`

Do NOT create subtasks. Do NOT transition status. Do NOT write code.`;
        }
      }

      // ─── Lead actions (approved tasks only) ───────────────────
      if (agentRole === 'lead' && approved && !action) {
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
      if (agentRole === 'worker' && status === 'In-Progress' && isSubtask && approved) {
        workerSubtaskQueue.push({ task, specFileId });
      }

      // ─── QA actions ────────────────────────────────────────────
      if (agentRole === 'qa' && status === 'Testing' && !isSubtask && approved) {
        action = 'qa';
        const wt = libs.trackerDb.getParentWorktree(taskId);
        const wtInstruction = wt ? `\nIMPORTANT: The code to test is in the task worktree at: ${wt.path} (branch: ${wt.branch}).` : '';
        prompt = `QA task ${taskId}: "${task['Task Name']}". Spec file ID: ${specFileId}. Read the spec for acceptance criteria.${wtInstruction}\nTest each AC via browser at http://localhost:3000. Write QA report to shared/qa-reports/. Submit via: stask qa ${taskId} --report shared/qa-reports/<your-report>.md --verdict <PASS|FAIL>`;
      }

      if (action && prompt) {
        const threadRef = getThreadRef(db, isSubtask ? task['Parent'] : taskId);
        const thread = threadRef ? { channelId: threadRef.channelId, threadTs: threadRef.threadTs } : null;
        pendingTasks.push({ taskId, taskName: task['Task Name'], status, parent: task['Parent'], specFileId, action, prompt, thread });
        handledTaskIds.add(taskId);
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
          handledTaskIds.add(s.task['Task ID']);
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
          for (const s of subtasks) handledTaskIds.add(s.task['Task ID']);
        }
      }
    }

    // ─── Resume pass: catch approved-but-stale work the canned branches missed.
    // Skipped for unapproved tasks — those are either already covered by the
    // lead's request-approval action above (parent tasks) or the lead's job
    // to escalate (an orphan subtask of an unapproved parent shouldn't exist).
    // The HEARTBEAT.md consumer still gates on OpenClaw session liveness —
    // if a fresh thread is already streaming against `pipeline:<taskId>`,
    // the consumer skips the spawn.
    for (const task of myTasks) {
      const taskId = task['Task ID'];
      const status = task['Status'];
      if (status === 'Done' || status === 'Blocked') continue;
      if (handledTaskIds.has(taskId)) continue;
      if (!isApproved(task)) continue; // unapproved parents already pinged; subtasks shouldn't exist

      const isSubtask = task['Parent'] !== 'None';
      const updatedAt = task['updated_at'];
      let ageMinutes = null;
      if (updatedAt) {
        const t = new Date(updatedAt + 'Z').getTime();
        if (!Number.isNaN(t)) ageMinutes = Math.round((Date.now() - t) / 60000);
      }

      const specParsed = libs.validate.parseSpecValue(task['Spec']);
      const specFileId = specParsed?.fileId || 'unknown';
      const wt = libs.trackerDb.getParentWorktree(isSubtask ? task['Parent'] : taskId);
      const wtInstruction = wt
        ? `\nWORKTREE: ${wt.path} (branch: ${wt.branch}). cd there before inspecting code.`
        : '';
      const ageNote = ageMinutes != null ? ` Last updated ~${ageMinutes}m ago.` : '';

      const prompt = `Task ${taskId} "${task['Task Name']}" (status: ${status}) is assigned to you and not Done.${ageNote} No specific action template matched, which usually means the task is mid-flight or in a state the heartbeat doesn't have a canned prompt for.

Spec file ID: ${specFileId}.${wtInstruction}

YOUR JOB:
1. Read the spec for context.
2. Check git/worktree state and the task log: \`stask log ${taskId}\`.
3. Decide:
   - If this is a parent task whose subtasks are still in flight, no action needed — confirm and exit.
   - If real work is stuck, pick it up: implement, transition, or re-delegate as appropriate to your role.
   - If you're blocked, transition the task to Blocked with a reason.

Do not duplicate work — if another live session is already driving this task, exit immediately.`;

      const threadRef = getThreadRef(db, isSubtask ? task['Parent'] : taskId);
      const thread = threadRef ? { channelId: threadRef.channelId, threadTs: threadRef.threadTs } : null;

      pendingTasks.push({
        taskId,
        taskName: task['Task Name'],
        status,
        parent: task['Parent'],
        specFileId,
        action: 'resume',
        prompt,
        thread,
        ageMinutes,
      });
      handledTaskIds.add(taskId);
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
      pendingTasks,
      // Slim summary so the agent always knows their plate without us
      // dumping every row into a parallel array.
      summary: { totalAssignedOpen, awaitingApproval: awaitingApprovalCount },
      inboxItems,
      config: { staleSessionMinutes: CONFIG.staleSessionMinutes },
    };
  });

  console.log(JSON.stringify(result, null, 2));
}