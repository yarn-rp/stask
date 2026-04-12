/**
 * guards.mjs — Pre-transition guards.
 *
 * Two types of guards:
 *   - setup:  Can create side effects (worktree, PR). Run first.
 *             Returns { pass, reason } — if fail, transition stops.
 *   - check:  Read-only validation. Run after setup.
 *             Returns { pass, reason } — if fail, transition stops.
 *
 * Guards are registered per target status. A transition fails if ANY
 * guard fails — all reasons are collected and reported.
 */

import path from 'path';
import { execFileSync } from 'child_process';
import { CONFIG, LIB_DIR, getWorkspaceLibs } from './env.mjs';

// ─── Setup guards (create side effects) ────────────────────────────

/**
 * Create worktree for parent task moving to In-Progress.
 * Checks out a feature branch based on current main.
 */
function setupWorktree(task, libs) {
  const wt = parseWorktree(task);
  if (wt) return { pass: true }; // already has one

  try {
    const result = execFileSync(process.execPath, [path.join(LIB_DIR, 'worktree-create.mjs'), task['Task ID']], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.error(`  ${result.trim()}`);

    // Verify it was set
    const refreshed = libs.trackerDb.findTask(task['Task ID']);
    if (!refreshed || refreshed['Worktree'] === 'None') {
      return { pass: false, reason: 'Worktree creation ran but worktree was not set in DB.' };
    }

    // Update the task object so subsequent guards see the worktree
    task['Worktree'] = refreshed['Worktree'];
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: `Worktree creation failed: ${err.stderr || err.message}` };
  }
}

/**
 * Create draft PR for parent task moving to Ready for Human Review.
 */
function setupPR(task, libs) {
  if (task['PR'] !== 'None') return { pass: true }; // already has one

  try {
    const result = execFileSync(process.execPath, [path.join(LIB_DIR, 'pr-create.mjs'), task['Task ID']], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.error(`  ${result.trim()}`);

    const refreshed = libs.trackerDb.findTask(task['Task ID']);
    if (!refreshed || refreshed['PR'] === 'None') {
      return { pass: false, reason: 'PR creation ran but PR URL was not set in DB.' };
    }

    task['PR'] = refreshed['PR'];
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: `Draft PR creation failed: ${err.stderr || err.message}` };
  }
}

// ─── Check guards (read-only validation) ───────────────────────────

/**
 * Task must not be assigned to human (needs approve first).
 * Only applies when coming FROM To-Do (initial approval gate).
 * Review cycles (RHR → In-Progress) skip this — the transition
 * itself reassigns to the lead.
 */
function requireApproved(task) {
  if (task['Status'] === 'To-Do' && task['Assigned To'] === CONFIG.human.name) {
    return { pass: false, reason: `Still assigned to ${CONFIG.human.name}. Approval must happen via the spec_approved checkbox in Slack.` };
  }
  return { pass: true };
}

/**
 * Task must have a PR before moving to Ready for Human Review.
 * Richard creates this manually via `gh pr create`.
 */
function requirePR(task) {
  if (task['PR'] === 'None' || !task['PR']) {
    return { pass: false, reason: 'No PR found. Create a draft PR with `gh pr create --draft` first.' };
  }
  return { pass: true };
}

/**
 * All subtasks must be Done before parent can move to Testing.
 */
function allSubtasksDone(task, libs) {
  const subtasks = libs.trackerDb.getSubtasks(task['Task ID']);
  if (subtasks.length === 0) return { pass: true };

  const notDone = subtasks.filter(s => s['Status'] !== 'Done');
  if (notDone.length === 0) return { pass: true };

  const summary = notDone.map(s => `${s['Task ID']} (${s['Status']}, ${s['Assigned To']})`).join(', ');
  return { pass: false, reason: `${notDone.length} subtask(s) not Done: ${summary}` };
}

/**
 * Worktree must have no uncommitted changes.
 */
function worktreeClean(task) {
  const wt = parseWorktree(task);
  if (!wt) return { pass: true };

  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: wt.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (status === '') return { pass: true };

    const lines = status.split('\n');
    return {
      pass: false,
      reason: `Uncommitted changes in worktree (${lines.length} file(s)):\n${lines.map(l => `    ${l}`).join('\n')}`,
    };
  } catch (err) {
    return { pass: false, reason: `Could not check worktree: ${err.message}` };
  }
}

/**
 * Worktree must have no unpushed commits.
 */
function worktreePushed(task) {
  const wt = parseWorktree(task);
  if (!wt) return { pass: true };

  try {
    const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], {
      cwd: wt.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const unpushed = execFileSync('git', ['log', `${upstream}..HEAD`, '--oneline'], {
      cwd: wt.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (unpushed === '') return { pass: true };

    const commits = unpushed.split('\n');
    return {
      pass: false,
      reason: `${commits.length} unpushed commit(s) in worktree:\n${commits.map(c => `    ${c}`).join('\n')}`,
    };
  } catch (err) {
    // No upstream = branch was never pushed
    try {
      const commits = execFileSync('git', ['log', '--oneline'], {
        cwd: wt.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (commits) {
        return { pass: false, reason: `Branch "${parseWorktree(task).branch}" has never been pushed to remote.` };
      }
    } catch {}
    return { pass: false, reason: `Could not check push state: ${err.message}` };
  }
}

// ─── Guard registry ────────────────────────────────────────────────

/**
 * Guards mapped to target status.
 *
 * Each entry has:
 *   - name: displayed in output
 *   - type: 'check' (read-only, runs first) or 'setup' (side effects, runs after all checks pass)
 *   - fn: (task, libs) => { pass, reason }
 *
 * Only parent tasks run guards.
 */
const GUARDS = {
  'In-Progress': [
    { name: 'require_approved',  type: 'check', fn: requireApproved },
    { name: 'setup_worktree',    type: 'setup', fn: setupWorktree },
  ],
  'Testing': [
    { name: 'all_subtasks_done', type: 'check', fn: allSubtasksDone },
    { name: 'worktree_clean',    type: 'check', fn: worktreeClean },
    { name: 'worktree_pushed',   type: 'check', fn: worktreePushed },
  ],
  'Ready for Human Review': [
    { name: 'worktree_clean',    type: 'check', fn: worktreeClean },
    { name: 'worktree_pushed',   type: 'check', fn: worktreePushed },
    { name: 'setup_pr',          type: 'setup', fn: setupPR },
  ],
};

// ─── Public API ────────────────────────────────────────────────────

/**
 * Run all guards for a transition. Returns { ok, failures[] }.
 *
 * Execution order:
 *   1. All check guards run first (read-only). Collects all failures.
 *   2. If ANY check fails → stop. No setup guards run.
 *   3. If all checks pass → run setup guards (side effects).
 *      If a setup fails → stop immediately.
 */
export function runGuards(task, newStatus, libs) {
  const isParent = task['Parent'] === 'None';
  if (!isParent) return { ok: true, failures: [] };

  const guards = GUARDS[newStatus];
  if (!guards) return { ok: true, failures: [] };

  const checks = guards.filter(g => g.type === 'check');
  const setups = guards.filter(g => g.type === 'setup');
  const failures = [];

  // Phase 1: Run all checks (read-only)
  for (const guard of checks) {
    const result = guard.fn(task, libs);
    if (!result.pass) {
      failures.push({ name: guard.name, reason: result.reason });
      console.error(`  GUARD ${guard.name}: FAIL — ${result.reason}`);
    } else {
      console.error(`  GUARD ${guard.name}: OK`);
    }
  }

  // If any check failed, don't run setups
  if (failures.length > 0) return { ok: false, failures };

  // Phase 2: Run setups (side effects) — stop on first failure
  for (const guard of setups) {
    const result = guard.fn(task, libs);
    if (!result.pass) {
      failures.push({ name: guard.name, reason: result.reason });
      console.error(`  GUARD ${guard.name}: FAIL — ${result.reason}`);
      break;
    } else {
      console.error(`  GUARD ${guard.name}: OK`);
    }
  }

  return { ok: failures.length === 0, failures };
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseWorktree(task) {
  const wt = task['Worktree'];
  if (!wt || wt === 'None') return null;
  const match = wt.match(/^(.+?)\s+\((.+)\)$/);
  if (match) return { branch: match[1].trim(), path: match[2].trim() };
  return null;
}
