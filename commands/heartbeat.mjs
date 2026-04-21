/**
 * stask heartbeat — Get pending work for an agent (JSON output).
 *
 * Usage: stask heartbeat <agent-name>
 *
 * Session-aware: skips tasks claimed by other live sessions.
 *
 * New architecture: the lead's response also includes a `byAgent` grouping
 * of pending subtasks so the supervisor loop can batch-delegate per
 * (task, worker) pair without recomputing the grouping client-side.
 */

import { CONFIG, getWorkspaceLibs } from '../lib/env.mjs';
import { withDb } from '../lib/tx.mjs';
import { getThreadRef } from '../lib/slack-row.mjs';
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
      return emptyResponse(agentName, agentRole);
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
        if (status === 'Backlog' && !isSubtask) {
          action = 'requirements-analysis';
          prompt = `Task ${taskId} "${task['Task Name']}" is in Backlog. Drive requirements analysis: spawn (or resume) your exploration Codex session via \`acpx codex -s "<threadId>:${agentName}" --ttl 0 ...\`, alternate clarifying questions in Slack with codebase questions to Codex, then write the spec and transition to Ready for Human Review. Spec file ID once written: ${specFileId}.`;
        } else if (status === 'To-Do' && !hasSubtasks) {
          action = 'delegate';
          const workers = Object.entries(CONFIG.agents)
            .filter(([, a]) => a.role === 'worker')
            .map(([n]) => n.charAt(0).toUpperCase() + n.slice(1));
          prompt = `Task ${taskId} "${task['Task Name']}" spec has been approved. Create subtasks and delegate via sessions_spawn to the appropriate worker(s): ${workers.join(', ')}. The worker will decide its own bundling; you just ship the ordered subtask list. Spec file ID: ${specFileId}. After creating subtasks, transition the parent to In-Progress.`;
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
            prompt = `Task ${taskId} "${task['Task Name']}" returned from QA failure. Review the latest QA report via your \`T:${agentName}\` Codex session (it retains prior context). Identify what failed, then re-delegate fixes — same worker sessions will resume by name. Spec file ID: ${specFileId}.${wtInstruction}`;
          }
        }
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

        const prompt = `You have ${subtasks.length} subtask(s) to implement. Inspect the list and **decide your own bundling** — group subtasks that share files / feature / dependency order into one Codex session (\`acpx codex -s "<threadId>:${agentName}:<primary-subtask>" --ttl 0 ...\`); run bundles sequentially.
${wtInstruction}

SUBTASKS:
${subtaskList}

Spec file ID: ${subtasks[0].specFileId}. Read the spec for full details on each subtask.

WORKFLOW per bundle:
1. Pick a primary subtask \`sP\`; group related subtasks with it
2. Invoke Codex via acpx (session name \`<threadId>:${agentName}:<sP>\`) with the batched prompt
3. Verify the diff + run any required tests
4. For each subtask in the bundle: git add/commit/push referencing the subtask ID, then \`npx @web42/stask subtask done <subtask-id>\`
5. Post progress to the thread
6. Move to next bundle (don't close the prior Codex session — sessions persist per task lifecycle)

DONE COMMANDS (run after completing each subtask):
${doneCommands}

IMPORTANT: All coding goes through Codex CLI via acpx (see BODY.md). \`codex --version\` must succeed at start — fail loud otherwise.`;

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
            prompt: `Build subtask ${s.task['Task ID']}: "${s.task['Task Name']}". Spec file ID: ${s.specFileId}. Read the spec for full details.${singleWt}\n\nAll coding goes through Codex CLI: \`acpx codex -s "<threadId>:${agentName}:${s.task['Task ID']}" --ttl 0 ...\`. codex --version must succeed at start.\n\nWhen complete, run: npx @web42/stask subtask done ${s.task['Task ID']}`,
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

    // ─── byAgent grouping for the lead (supervisor loop input) ──
    //
    // Walk ALL tasks (not just myTasks) to build a map keyed by assigned
    // agent, with subtasks listed per parent task. The lead uses this to
    // drive the supervisor loop in HEARTBEAT.md.
    let byAgent = null;
    if (agentRole === 'lead') {
      byAgent = buildLeadByAgent(db, libs, allTasks);
    }

    // ─── Unprocessed inbox items ──────────────────────────────
    let inboxItems = [];
    try {
      libs.trackerDb.ensureInboxTables();
      inboxItems = libs.trackerDb.getNewInboxItems();
    } catch {
      // inbox tables may not exist yet
    }

    const response = {
      agent: agentName,
      role: agentRole,
      pendingTasks,
      inboxItems,
      config: {
        staleSessionMinutes: CONFIG.staleSessionMinutes,
      },
    };
    if (byAgent) response.byAgent = byAgent;
    return response;
  });

  console.log(JSON.stringify(result, null, 2));
}

// ─── Helpers ───────────────────────────────────────────────────────

function emptyResponse(agentName, agentRole) {
  const r = {
    agent: agentName,
    role: agentRole,
    pendingTasks: [],
    inboxItems: [],
    config: { staleSessionMinutes: CONFIG.staleSessionMinutes },
  };
  if (agentRole === 'lead') r.byAgent = {};
  return r;
}

/**
 * Build the lead's `byAgent` grouping:
 *
 *   {
 *     "berlin": [
 *       {
 *         parentTaskId, parentTaskName, threadId, phase,
 *         subtasks: [{ subtaskId, subtaskName, specFileId }, ...]
 *       },
 *     ],
 *     "helsinki": [ ... ],
 *   }
 *
 * `phase` reflects where the parent sits in the pipeline so the lead knows
 * what to do (delegate / supervise / qa / close).
 */
function buildLeadByAgent(db, libs, allTasks) {
  const byAgent = {};
  // Lookup name → role from CONFIG.
  const agentMeta = Object.fromEntries(
    Object.entries(CONFIG.agents).map(([name, a]) => [
      name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
      { name, role: a.role },
    ])
  );

  // Index tasks by parent status for phase derivation.
  const taskById = new Map(allTasks.map(t => [t['Task ID'], t]));

  for (const task of allTasks) {
    const isSubtask = task['Parent'] !== 'None';
    const assignedDisplay = task['Assigned To'];
    if (!assignedDisplay || assignedDisplay === 'None') continue;
    const meta = agentMeta[assignedDisplay];
    if (!meta) continue;
    if (meta.role === 'lead') continue; // Lead's own work is elsewhere.
    const status = task['Status'];
    if (status === 'Done' || status === 'Blocked') continue;

    // Only surface work that's actively in motion.
    if (meta.role === 'worker' && !(isSubtask && status === 'In-Progress')) continue;
    if (meta.role === 'qa' && !(!isSubtask && status === 'Testing')) continue;

    const parentId = isSubtask ? task['Parent'] : task['Task ID'];
    const parent = taskById.get(parentId);
    if (!parent) continue;

    const threadRef = getThreadRef(db, parentId);
    const threadId = threadRef?.threadTs || null;

    const bucket = (byAgent[meta.name] ||= []);
    let entry = bucket.find(e => e.parentTaskId === parentId);
    if (!entry) {
      entry = {
        parentTaskId: parentId,
        parentTaskName: parent['Task Name'],
        threadId,
        phase: meta.role === 'qa' ? 'qa' : 'build',
        subtasks: [],
      };
      bucket.push(entry);
    }

    if (isSubtask) {
      const specParsed = libs.validate.parseSpecValue(parent['Spec']);
      entry.subtasks.push({
        subtaskId: task['Task ID'],
        subtaskName: task['Task Name'],
        specFileId: specParsed?.fileId || 'unknown',
      });
    }
  }

  return byAgent;
}
