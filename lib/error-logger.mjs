/**
 * error-logger.mjs — Simple JSONL file logger for persistent error records.
 *
 * Writes structured log entries to .stask/logs/errors.jsonl (JSON Lines).
 * Auto-rotates at 10MB, keeping last 3 rotated files.
 * Falls back to console.error if file write fails.
 *
 * Usage:
 *   import { logError, logWarn } from './error-logger.mjs';
 *   logError({ source: 'sync-daemon', operation: 'syncTaskToSlack', taskId: 'T-024', error: 'rate limited', retries: 3 });
 *   logWarn({ source: 'thread-notify', operation: 'postThreadUpdate', taskId: 'T-024', error: 'timeout' });
 */

import fs from 'fs';
import path from 'path';

// ─── Constants ───────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED = 3;

// ─── Resolve log directory from STASK_HOME ───────────────────────

/**
 * Get the log directory path. Uses STASK_HOME env var or falls back
 * to resolving from cwd (same logic as resolve-home.mjs but without
 * importing it to avoid circular deps or early exit on misconfig).
 */
function getLogDir() {
  if (process.env.STASK_HOME) {
    return path.join(process.env.STASK_HOME, 'logs');
  }

  // Walk up from cwd to find .stask/config.json
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, '.stask', 'config.json');
    if (fs.existsSync(candidate)) {
      try {
        const config = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (config.project) {
          return path.join(dir, '.stask', 'logs');
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }

  // Fallback: use .stask/logs relative to cwd
  return path.join(process.cwd(), '.stask', 'logs');
}

/**
 * Get the current log file path.
 */
function getLogFilePath() {
  return path.join(getLogDir(), 'errors.jsonl');
}

// ─── Rotation ────────────────────────────────────────────────────

/**
 * Rotate the log file if it exceeds MAX_FILE_SIZE.
 * Keeps up to MAX_ROTATED rotated files: errors.jsonl.1, .2, .3
 */
function rotateIfNeeded(logFilePath) {
  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_FILE_SIZE) return;

    const dir = path.dirname(logFilePath);

    // Delete oldest rotated file if it exists
    const oldest = `${logFilePath}.${MAX_ROTATED}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // Shift existing rotated files up: .2 → .3, .1 → .2, etc.
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const from = `${logFilePath}.${i}`;
      const to = `${logFilePath}.${i + 1}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, to);
      }
    }

    // Rotate current file to .1
    fs.renameSync(logFilePath, `${logFilePath}.1`);
  } catch {
    // If rotation fails (e.g., file disappeared between stat and rename),
    // just continue — the next write will create a fresh file
  }
}

// ─── Core write ──────────────────────────────────────────────────

/**
 * Append a structured log entry to the JSONL file.
 * Falls back to console.error if file write fails.
 */
function writeEntry(entry) {
  const line = JSON.stringify(entry) + '\n';
  const logFilePath = getLogFilePath();

  try {
    const logDir = path.dirname(logFilePath);
    fs.mkdirSync(logDir, { recursive: true });

    rotateIfNeeded(logFilePath);
    fs.appendFileSync(logFilePath, line, 'utf-8');
  } catch (writeErr) {
    // File write failed — fall back to console
    console.error(`[error-logger] Failed to write to ${logFilePath}: ${writeErr.message}`);
    console.error(`[error-logger] Dropped entry: ${line.trim()}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Log an error entry.
 * @param {Object} params
 * @param {string} params.source - Origin: sync-daemon, transition, thread-notify, guard, assign, heartbeat, slack-api
 * @param {string} params.operation - What was attempted: syncTaskToSlack, postThreadUpdate, etc.
 * @param {string} [params.taskId] - Related task ID
 * @param {string} params.error - Error message
 * @param {number} [params.retries] - Number of retries attempted before giving up
 * @param {Object} [params.metadata] - Additional context
 */
export function logError({ source, operation, taskId, error, retries, metadata } = {}) {
  writeEntry({
    timestamp: new Date().toISOString(),
    level: 'error',
    source,
    operation,
    taskId: taskId ?? null,
    error: typeof error === 'string' ? error : error?.message ?? String(error),
    retries: retries ?? null,
    metadata: metadata ?? {},
  });
}

/**
 * Log a warning entry.
 * @param {Object} params
 * @param {string} params.source
 * @param {string} params.operation
 * @param {string} [params.taskId]
 * @param {string} params.error
 * @param {Object} [params.metadata]
 */
export function logWarn({ source, operation, taskId, error, metadata } = {}) {
  writeEntry({
    timestamp: new Date().toISOString(),
    level: 'warn',
    source,
    operation,
    taskId: taskId ?? null,
    error: typeof error === 'string' ? error : error?.message ?? String(error),
    retries: null,
    metadata: metadata ?? {},
  });
}