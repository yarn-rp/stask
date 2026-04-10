/**
 * session-tracker.mjs — Session claim/release/status.
 *
 * Tracks which agent session is actively working on a task.
 * Prevents multiple agent threads from colliding on the same task.
 *
 * Inspired by OpenClaw's KeyedAsyncQueue — serializes work per task key.
 */

import { getWorkspaceLibs, getPipelineConfig } from './env.mjs';

const SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS active_sessions (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(task_id),
  agent       TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  claimed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let _tableCreated = false;

/**
 * Ensure the active_sessions table exists.
 */
function ensureTable(db) {
  if (_tableCreated) return;
  db.exec(SESSION_TABLE_SQL);
  _tableCreated = true;
}

/**
 * Claim a task for an agent session.
 * Fails if already claimed by a different session (unless stale).
 *
 * @returns {{ ok: boolean, message: string, claimedBy?: string }}
 */
export function claimTask(db, taskId, agent, sessionId) {
  ensureTable(db);
  const config = getPipelineConfig();
  const staleMinutes = config.staleSessionMinutes || 30;

  const existing = db.prepare('SELECT * FROM active_sessions WHERE task_id = ?').get(taskId);

  if (existing) {
    // Same session reclaiming — just refresh
    if (existing.session_id === sessionId) {
      db.prepare('UPDATE active_sessions SET claimed_at = datetime(\'now\') WHERE task_id = ?').run(taskId);
      return { ok: true, message: `Refreshed claim on ${taskId}` };
    }

    // Check if stale
    const claimedAt = new Date(existing.claimed_at + 'Z');
    const ageMinutes = (Date.now() - claimedAt.getTime()) / 60000;

    if (ageMinutes < staleMinutes) {
      return {
        ok: false,
        message: `${taskId} is claimed by ${existing.agent} (session: ${existing.session_id}, ${Math.round(ageMinutes)}m ago). Still active.`,
        claimedBy: existing.agent,
      };
    }

    // Stale — reclaim
    db.prepare('UPDATE active_sessions SET agent = ?, session_id = ?, claimed_at = datetime(\'now\') WHERE task_id = ?')
      .run(agent, sessionId, taskId);
    return { ok: true, message: `Reclaimed stale lock on ${taskId} (was ${existing.agent}, ${Math.round(ageMinutes)}m stale)` };
  }

  // No existing claim — create
  db.prepare('INSERT INTO active_sessions (task_id, agent, session_id) VALUES (?, ?, ?)')
    .run(taskId, agent, sessionId);
  return { ok: true, message: `Claimed ${taskId} for ${agent}` };
}

/**
 * Release a task session claim.
 */
export function releaseTask(db, taskId, sessionId = null) {
  ensureTable(db);
  if (sessionId) {
    const result = db.prepare('DELETE FROM active_sessions WHERE task_id = ? AND session_id = ?')
      .run(taskId, sessionId);
    return result.changes > 0
      ? { ok: true, message: `Released ${taskId}` }
      : { ok: false, message: `${taskId} not claimed by session ${sessionId}` };
  }
  // Force release (no session check)
  const result = db.prepare('DELETE FROM active_sessions WHERE task_id = ?').run(taskId);
  return result.changes > 0
    ? { ok: true, message: `Force-released ${taskId}` }
    : { ok: false, message: `${taskId} has no active session` };
}

/**
 * Get session status for a task (or all tasks).
 */
export function getSessionStatus(db, taskId = null) {
  ensureTable(db);
  const config = getPipelineConfig();
  const staleMinutes = config.staleSessionMinutes || 30;

  const rows = taskId
    ? db.prepare('SELECT * FROM active_sessions WHERE task_id = ?').all(taskId)
    : db.prepare('SELECT * FROM active_sessions ORDER BY claimed_at DESC').all();

  return rows.map(row => {
    const claimedAt = new Date(row.claimed_at + 'Z');
    const ageMinutes = (Date.now() - claimedAt.getTime()) / 60000;
    return {
      ...row,
      ageMinutes: Math.round(ageMinutes),
      isStale: ageMinutes >= staleMinutes,
    };
  });
}

/**
 * Check if a task is claimable by a given agent.
 * Returns true if: no claim, same agent, or stale.
 */
export function isTaskClaimable(db, taskId, agent) {
  ensureTable(db);
  const config = getPipelineConfig();
  const staleMinutes = config.staleSessionMinutes || 30;

  const existing = db.prepare('SELECT * FROM active_sessions WHERE task_id = ?').get(taskId);
  if (!existing) return true;
  if (existing.agent === agent) return true;

  const claimedAt = new Date(existing.claimed_at + 'Z');
  const ageMinutes = (Date.now() - claimedAt.getTime()) / 60000;
  return ageMinutes >= staleMinutes;
}

/**
 * Clean up stale sessions (run periodically).
 */
export function cleanStaleSessions(db) {
  ensureTable(db);
  const config = getPipelineConfig();
  const staleMinutes = config.staleSessionMinutes || 30;

  const result = db.prepare(`
    DELETE FROM active_sessions
    WHERE (julianday('now') - julianday(claimed_at)) * 24 * 60 >= ?
  `).run(staleMinutes);

  return result.changes;
}
