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

CREATE TABLE IF NOT EXISTS acp_sessions (
  label        TEXT PRIMARY KEY,
  task_id      TEXT REFERENCES tasks(task_id),
  agent        TEXT NOT NULL,
  subtask_id   TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_ping_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acp_sessions_task ON acp_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_acp_sessions_agent ON acp_sessions(agent);

CREATE TABLE IF NOT EXISTS subtask_bundles (
  task_id            TEXT NOT NULL REFERENCES tasks(task_id),
  agent              TEXT NOT NULL,
  primary_subtask_id TEXT NOT NULL,
  member_subtask_id  TEXT NOT NULL,
  ordinal            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, agent, member_subtask_id)
);
CREATE INDEX IF NOT EXISTS idx_subtask_bundles_primary
  ON subtask_bundles(task_id, agent, primary_subtask_id);
`;

let _tableCreated = false;

/**
 * Ensure both session tables exist.
 */
function ensureTable(db) {
  if (_tableCreated) return;
  db.exec(SESSION_TABLE_SQL);
  _tableCreated = true;
}

// ─── ACP session liveness (label-keyed, for acpx Codex sessions) ──
//
// Distinct from active_sessions (task-keyed, one-per-task claim).
// acp_sessions tracks multiple concurrent acpx named sessions per task:
//   - T:professor         (lead exploration session)
//   - T:berlin:s1         (worker bundle, primary subtask s1)
//   - T:berlin:s3         (worker bundle, primary subtask s3)
//
// The label is the acpx -s <name> argument; same string used by the agent
// when re-invoking to resume. Session rows persist across the whole task
// lifecycle and are only closed when the task transitions to Done.

const HANG_TIMEOUT_MINUTES_DEFAULT = 3;

function parseLabel(label) {
  const parts = label.split(':');
  return {
    taskPrefix: parts[0] || null,
    agent: parts[1] || null,
    subtaskId: parts[2] || null,
  };
}

/**
 * Record or refresh an ACP session's liveness ping.
 * Creates the row if missing; otherwise updates last_ping_at.
 *
 * @param {string} label   acpx session name, e.g. "T-042:berlin:s1"
 * @param {object} meta    { taskId?, agent?, subtaskId? } — only used on insert
 * @returns {{ ok: boolean, created: boolean, label: string }}
 */
export function pingAcpSession(db, label, meta = {}) {
  ensureTable(db);
  const existing = db.prepare('SELECT label FROM acp_sessions WHERE label = ?').get(label);
  if (existing) {
    db.prepare("UPDATE acp_sessions SET last_ping_at = datetime('now') WHERE label = ?").run(label);
    return { ok: true, created: false, label };
  }
  const parsed = parseLabel(label);
  const agent = meta.agent ?? parsed.agent;
  if (!agent) {
    return { ok: false, created: false, label, error: `Cannot derive agent from label "${label}" and none provided.` };
  }
  db.prepare(
    'INSERT INTO acp_sessions (label, task_id, agent, subtask_id) VALUES (?, ?, ?, ?)'
  ).run(label, meta.taskId ?? null, agent, meta.subtaskId ?? parsed.subtaskId ?? null);
  return { ok: true, created: true, label };
}

/**
 * Health check for an ACP session.
 * Returns one of: 'alive' | 'hung' | 'missing'.
 *
 * @param {string} label
 * @param {number} [hangTimeoutMinutes] — defaults to pipeline config or 3
 */
export function acpSessionHealth(db, label, hangTimeoutMinutes) {
  ensureTable(db);
  const row = db.prepare('SELECT last_ping_at FROM acp_sessions WHERE label = ?').get(label);
  if (!row) return { status: 'missing', label };

  const timeout = hangTimeoutMinutes
    ?? getPipelineConfig().acpHangTimeoutMinutes
    ?? HANG_TIMEOUT_MINUTES_DEFAULT;
  const pingedAt = new Date(row.last_ping_at + 'Z');
  const ageMinutes = (Date.now() - pingedAt.getTime()) / 60000;
  return {
    status: ageMinutes >= timeout ? 'hung' : 'alive',
    label,
    ageMinutes: Math.round(ageMinutes * 10) / 10,
    timeoutMinutes: timeout,
  };
}

/**
 * List all tracked ACP sessions, optionally filtered by task or agent.
 */
export function listAcpSessions(db, { taskId = null, agent = null } = {}) {
  ensureTable(db);
  const clauses = [];
  const params = [];
  if (taskId) { clauses.push('task_id = ?'); params.push(taskId); }
  if (agent) { clauses.push('agent = ?'); params.push(agent); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM acp_sessions ${where} ORDER BY last_ping_at DESC`).all(...params);
}

/**
 * Forget an ACP session row. Called at task-Done cleanup.
 */
export function closeAcpSession(db, label) {
  ensureTable(db);
  const result = db.prepare('DELETE FROM acp_sessions WHERE label = ?').run(label);
  return { ok: result.changes > 0, label };
}

/**
 * Forget all ACP sessions for a task. Called when a task reaches Done.
 */
export function closeAcpSessionsForTask(db, taskId) {
  ensureTable(db);
  const result = db.prepare('DELETE FROM acp_sessions WHERE task_id = ?').run(taskId);
  return { ok: true, removed: result.changes, taskId };
}

// ─── Subtask bundles (worker's bundling choice) ───────────────────
//
// When a worker receives a batch of subtasks it groups related ones into
// bundles — one Codex session per bundle, keyed by a primary subtask id. If
// the worker dies mid-bundle, the replacement worker needs to re-attach to
// the SAME Codex sessions (so context isn't lost), not re-derive the grouping
// from scratch. We persist the grouping here.
//
// Schema: (task_id, agent, primary_subtask_id, member_subtask_id, ordinal).
// One row per subtask in each bundle. ordinal preserves bundle order within
// a worker's batch so replacement workers process them in the original order.

/**
 * Save a worker's bundling choice for a task.
 *
 * @param {string} taskId  The parent task id.
 * @param {string} agent   The worker instance name (e.g. "berlin").
 * @param {Array<{primarySubtaskId: string, memberSubtaskIds: string[]}>} bundles
 *   Ordered bundles. First bundle runs first; within a bundle, member ids are
 *   stored with an ordinal so the replacement can replay them in the same
 *   order.
 */
export function saveSubtaskBundles(db, taskId, agent, bundles) {
  ensureTable(db);
  // Idempotent replace — if called again for the same (task, agent), drop
  // the previous bundling.
  db.prepare('DELETE FROM subtask_bundles WHERE task_id = ? AND agent = ?').run(taskId, agent);

  const insert = db.prepare(`
    INSERT INTO subtask_bundles (task_id, agent, primary_subtask_id, member_subtask_id, ordinal)
    VALUES (?, ?, ?, ?, ?)
  `);
  let ordinal = 0;
  for (const bundle of bundles) {
    const primary = bundle.primarySubtaskId;
    for (const member of bundle.memberSubtaskIds) {
      insert.run(taskId, agent, primary, member, ordinal++);
    }
  }
  return { ok: true, bundles: bundles.length };
}

/**
 * Read the saved bundling for a (task, agent). Returns ordered bundles or
 * null if no bundling has been saved yet.
 */
export function getSubtaskBundles(db, taskId, agent) {
  ensureTable(db);
  const rows = db.prepare(`
    SELECT primary_subtask_id, member_subtask_id, ordinal
    FROM subtask_bundles
    WHERE task_id = ? AND agent = ?
    ORDER BY ordinal ASC
  `).all(taskId, agent);
  if (rows.length === 0) return null;

  const byPrimary = new Map();
  for (const r of rows) {
    const bundle = byPrimary.get(r.primary_subtask_id) || {
      primarySubtaskId: r.primary_subtask_id,
      memberSubtaskIds: [],
      firstOrdinal: r.ordinal,
    };
    bundle.memberSubtaskIds.push(r.member_subtask_id);
    if (r.ordinal < bundle.firstOrdinal) bundle.firstOrdinal = r.ordinal;
    byPrimary.set(r.primary_subtask_id, bundle);
  }
  return [...byPrimary.values()]
    .sort((a, b) => a.firstOrdinal - b.firstOrdinal)
    .map(({ primarySubtaskId, memberSubtaskIds }) => ({ primarySubtaskId, memberSubtaskIds }));
}

/**
 * Drop all bundling rows for a task (at task Done).
 */
export function clearSubtaskBundles(db, taskId) {
  ensureTable(db);
  const result = db.prepare('DELETE FROM subtask_bundles WHERE task_id = ?').run(taskId);
  return { ok: true, removed: result.changes, taskId };
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
