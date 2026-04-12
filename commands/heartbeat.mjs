/**
 * stask heartbeat — Get pending work for an agent (JSON output).
 *
 * Usage: stask heartbeat <agent-name>
 *
 * Session-aware: skips tasks claimed by other live sessions.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { CONFIG, LIB_DIR, getWorkspaceLibs } from '../lib/env.mjs';
import { withDb } from '../lib/tx.mjs';
import { syncTaskToSlack, getThreadRef } from '../lib/slack-row.mjs';
import { isTaskClaimable } from '../lib/session-tracker.mjs';
import { getLeadAgent } from '../lib/roles.mjs';

// ─── PR Status Report Generation ───────────────────────────────────

const PR_STATUS_DIR = path.resolve(CONFIG.staskHome, 'pr-status');

function fetchCheckRuns(owner, repo, headSha) {
  try {
    const result = JSON.parse(execSync(
      `gh api repos/${owner}/${repo}/commits/${headSha}/check-runs`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ));
    return (result.check_runs || []).map(cr => ({
      name: cr.name, status: cr.status, conclusion: cr.conclusion,
    }));
  } catch { return []; }
}

function fetchAllPrComments(owner, repo, prNumber) {
  try {
    const issueComments = JSON.parse(execSync(
      `gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ));
    const reviewComments = JSON.parse(execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ));
    const reviews = JSON.parse(execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ));
    return [
      ...issueComments.map(c => ({
        author: c.user?.login || 'unknown', body: c.body, path: null, line: null, createdAt: c.created_at,
      })),
      ...reviewComments.map(c => ({
        author: c.user?.login || 'unknown', body: c.body, path: c.path, line: c.line || c.original_line, createdAt: c.created_at,
      })),
      ...reviews.filter(r => r.body && r.body.trim()).map(r => ({
        author: r.user?.login || 'unknown', body: r.body, path: null, line: null,
        createdAt: r.submitted_at, reviewState: r.state,
      })),
    ].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } catch { return []; }
}

function generatePrStatusMarkdown(task, prState, checkRuns, comments) {
  const taskId = task['Task ID'];
  const now = new Date().toISOString();

  const lines = [
    `# PR Status: ${taskId} — ${task['Task Name']}`,
    '',
    `**PR:** ${task['PR']}`,
    `**State:** ${prState}`,
    `**Assigned To:** ${task['Assigned To']}`,
    `**Last Updated:** ${now}`,
    '',
    '## CI/CD Status', '',
  ];

  if (checkRuns.length === 0) {
    lines.push('No check runs found.', '');
  } else {
    lines.push('| Check | Status | Conclusion |', '|---|---|---|');
    for (const cr of checkRuns) {
      const conclusion = cr.conclusion || 'pending';
      const icon = conclusion === 'success' ? 'pass' : conclusion === 'failure' ? 'FAIL' : conclusion;
      lines.push(`| ${cr.name} | ${cr.status} | ${icon} |`);
    }
    lines.push('');
  }

  lines.push('## Review Comments', '');
  if (comments.length === 0) {
    lines.push('No review comments yet.', '');
  } else {
    const byAuthor = {};
    for (const c of comments) {
      const a = c.author || 'unknown';
      if (!byAuthor[a]) byAuthor[a] = [];
      byAuthor[a].push(c);
    }
    for (const [author, authorComments] of Object.entries(byAuthor)) {
      const isHuman = author === CONFIG.human.githubUsername;
      lines.push(`### ${author}${isHuman ? ' (Human Reviewer)' : ''}`, '');
      for (const c of authorComments) {
        if (c.path) lines.push(`**${c.path}${c.line ? `:${c.line}` : ''}**`);
        lines.push(`> ${c.body.replace(/\n/g, '\n> ')}`, '');
      }
    }
  }

  return lines.join('\n');
}

async function generateAndUploadPrStatus(task, prData, libs) {
  const prMatch = task['PR'].match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!prMatch) return;
  const [, owner, repo, prNumber] = prMatch;

  // Fetch head SHA for CI/CD check runs
  let headSha = null;
  let prState = prData.state || 'open';
  try {
    const prInfo = JSON.parse(execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ));
    headSha = prInfo.head?.sha;
    prState = prInfo.state + (prInfo.draft ? ' (draft)' : '');
  } catch {}

  const checkRuns = headSha ? fetchCheckRuns(owner, repo, headSha) : [];
  const allComments = fetchAllPrComments(owner, repo, prNumber);

  const markdown = generatePrStatusMarkdown(task, prState, checkRuns, allComments);

  // Write to disk
  if (!fs.existsSync(PR_STATUS_DIR)) fs.mkdirSync(PR_STATUS_DIR, { recursive: true });
  const fileName = `${task['Task ID']}.md`;
  fs.writeFileSync(path.join(PR_STATUS_DIR, fileName), markdown);

  // Upload to Slack and get file ID
  const fileId = await libs.slackApi.uploadFile(fileName, markdown, 'text/plain');

  // Update task with path + file ID (same format as Spec)
  libs.trackerDb.updateTask(task['Task ID'], { pr_status: `pr-status/${fileName} (${fileId})` });

  return fileId;
}

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
  const leadName = getLeadAgent();

  // Collect tasks that need PR status updates (async, done after withDb)
  const prStatusQueue = [];

  const result = await withDb((db, libs) => {
    const allTasks = libs.trackerDb.getAllTasks();
    const myTasks = allTasks.filter(t => t['Assigned To'] === agentDisplayName);

    // Lead also monitors all RHR parent tasks (PR comment polling)
    let rhrTasks = [];
    if (agentRole === 'lead') {
      rhrTasks = allTasks.filter(t =>
        t['Status'] === 'Ready for Human Review' &&
        t['Parent'] === 'None' &&
        t['PR'] !== 'None' &&
        t['Assigned To'] !== agentDisplayName // avoid duplicates
      );
    }

    const tasksToCheck = [...myTasks, ...rhrTasks];

    if (tasksToCheck.length === 0) {
      return { agent: agentName, pendingTasks: [], config: { staleSessionMinutes: CONFIG.staleSessionMinutes } };
    }

    const pendingTasks = [];
    const workerSubtaskQueue = [];

    for (const task of tasksToCheck) {
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
          // Richard is assigned a Testing task → QA passed, he needs to create PR
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
        } else if (status === 'Ready for Human Review' && task['PR'] !== 'None') {
          try {
            const result = execFileSync(process.execPath, [path.join(LIB_DIR, 'pr-status.mjs'), taskId], {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
            });
            const prData = JSON.parse(result);

            // Queue PR status report generation (async, runs after withDb)
            prStatusQueue.push({ task, prData });

            if (prData.isMerged) {
              // PR merged → auto-transition to Done
              action = 'pr-merged';
              prompt = `Task ${taskId} "${task['Task Name']}" PR has been merged: ${task['PR']}.\n\nRun: stask transition ${taskId} Done`;
            } else if (prData.yanComments?.length > 0) {
              // Yan has comments → always actionable, address the feedback
              const wt = libs.trackerDb.getParentWorktree(taskId);
              const wtInstruction = wt ? ` Work in worktree: ${wt.path} (branch: ${wt.branch}).` : '';
              action = 'address-pr-feedback';
              const commentSummary = prData.yanComments.map(c =>
                `- ${c.path ? `${c.path}:${c.line}` : 'General'}: "${c.body.slice(0, 200)}"`
              ).join('\n');

              const workers = Object.entries(CONFIG.agents)
                .filter(([, a]) => a.role === 'worker')
                .map(([n]) => n.charAt(0).toUpperCase() + n.slice(1));

              prompt = `Task ${taskId} "${task['Task Name']}" has ${prData.yanComments.length} PR feedback from ${CONFIG.human.name}:

${commentSummary}

PR: ${task['PR']}${wtInstruction}

THIS IS A REVIEW CYCLE. Follow these steps exactly:

1. Run: \`stask transition ${taskId} In-Progress\`
   This moves the task back into the build cycle. The existing worktree, branch, and PR are preserved.

2. Read each comment carefully. For each fix needed, create a subtask:
   \`stask subtask create --parent ${taskId} --name "Fix: <description>" --assign <Worker>\`
   Assign to the right builder: ${workers.join(' or ')}.

3. Workers will pick up their subtasks on heartbeat.

4. When all fix subtasks are Done, the task auto-transitions to Testing.
   Jared will re-test — he can see the existing PR and prior QA report for context.

5. After QA passes again, you create an updated PR description and transition to Ready for Human Review.

The PR stays open. The branch stays the same. This is a fix cycle, not a restart.`;
            } else if (prData.otherComments?.length > 0) {
              // External comments only → notify Yan, don't act
              action = 'notify-external-comments';
              const commentSummary = prData.otherComments.map(c =>
                `- @${c.author}: "${c.body.slice(0, 100)}"`
              ).join('\n');
              prompt = `Task ${taskId} "${task['Task Name']}" has ${prData.otherComments.length} external comment(s) on PR ${task['PR']}:

${commentSummary}

These are NOT from ${CONFIG.human.name}. Send a Slack DM to ${CONFIG.human.name} summarizing these comments and asking how to handle them. Do NOT act on them yourself.`;
            }
          } catch {}
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
          // Single subtask — use original format for backward compatibility
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

    return { agent: agentName, pendingTasks, config: { staleSessionMinutes: CONFIG.staleSessionMinutes } };
  });

  // Process PR status reports (async — uploads to Slack, updates DB)
  if (prStatusQueue.length > 0) {
    const libs = await getWorkspaceLibs();
    const db = libs.trackerDb.getDb();
    for (const { task, prData } of prStatusQueue) {
      try {
        await generateAndUploadPrStatus(task, prData, libs);
        const updatedTask = libs.trackerDb.findTask(task['Task ID']);
        await syncTaskToSlack(db, updatedTask);
        console.error(`PR status report updated for ${task['Task ID']}`);
      } catch (err) {
        console.error(`WARNING: PR status report failed for ${task['Task ID']}: ${err.message}`);
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
}
