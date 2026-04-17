/**
 * lib/setup/openclaw-cli.mjs — Thin wrapper around the `openclaw` CLI.
 *
 * Every write to ~/.openclaw/openclaw.json or ~/.openclaw/cron/jobs.json must
 * go through this helper. Two reasons:
 *
 *  1. Racing the live gateway on direct fs.writeFileSync causes clobbers.
 *     The gateway writes openclaw.json back periodically; the `openclaw config
 *     set --batch-file` path is the documented gateway-aware mutation channel.
 *  2. Schema validation is free — `openclaw config set --batch-file --dry-run`
 *     validates against the live schema before we commit.
 *
 * Hard rule: this helper REFUSES to touch any `gateway.*` key. gateway.bind
 * and friends are operator policy, not stask's business.
 */
import { execFileSync, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const DEFAULT_TIMEOUT_MS = 30_000;

class OpenclawCliError extends Error {
  constructor(message, { argv, stderr, stdout, code } = {}) {
    super(message);
    this.name = 'OpenclawCliError';
    this.argv = argv;
    this.stderr = stderr;
    this.stdout = stdout;
    this.code = code;
  }
}

/** Run `openclaw <args>` and return stdout. Throws OpenclawCliError on non-zero exit. */
function runOpenclaw(args, { input, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const stdout = execFileSync(OPENCLAW_BIN, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      input,
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });
    return stdout;
  } catch (err) {
    const stderr = err.stderr?.toString?.() || '';
    const stdout = err.stdout?.toString?.() || '';
    throw new OpenclawCliError(
      `openclaw ${args.join(' ')} failed (exit ${err.status}): ${stderr.trim() || err.message}`,
      { argv: args, stderr, stdout, code: err.status },
    );
  }
}

/** `openclaw config validate`. Returns true on success, throws on validation failure. */
export function validateConfig() {
  runOpenclaw(['config', 'validate']);
  return true;
}

/** `openclaw config get <path>`. Returns parsed JSON. Returns undefined for a missing key. */
export function configGet(path) {
  // Reads are always fine — including gateway.*. Only writes are restricted.
  if (typeof path !== 'string' || !path) {
    throw new OpenclawCliError(`Invalid config path: ${JSON.stringify(path)}`);
  }
  try {
    const out = runOpenclaw(['config', 'get', path, '--json']).trim();
    if (!out) return undefined;
    return JSON.parse(out);
  } catch (err) {
    // `openclaw config get` exits non-zero for missing keys; treat as undefined
    // unless the failure looks like something else (schema error, gateway down).
    if (err.stderr && /not found|unknown key|no value/i.test(err.stderr)) return undefined;
    // Best-effort: return undefined on any `get` error so callers can fall
    // back to their existing discovery paths (e.g. reading setup state).
    return undefined;
  }
}

/**
 * Apply a batch of config set operations atomically.
 *
 * ops: array of { path: string, value: any, strictJson?: boolean }
 *  - path MUST NOT start with `gateway.` (see module header).
 *  - value is serialized as JSON; OpenClaw accepts JSON/JSON5 in batch mode.
 *
 * Runs a dry-run first (= schema validation). If dry-run succeeds, applies.
 */
export function configSetBatch(ops, { spinnerMessage } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) return { applied: 0 };

  for (const op of ops) assertWritableConfigPath(op.path);

  // Write the batch to a temp file — `openclaw config set --batch-file`
  // reads a JSON array of { path, value, strictJson? } operations.
  const tmp = path.join(os.tmpdir(), `stask-batch-${crypto.randomUUID()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(ops, null, 2));

  try {
    // Dry-run = schema validation without touching openclaw.json
    runOpenclaw(['config', 'set', '--batch-file', tmp, '--dry-run']);
    // Apply for real
    runOpenclaw(['config', 'set', '--batch-file', tmp]);
    return { applied: ops.length };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * `openclaw cron list --json`. Returns the parsed array (or []).
 */
export function cronList() {
  try {
    const out = runOpenclaw(['cron', 'list', '--json']).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : (parsed.jobs || []);
  } catch {
    return [];
  }
}

/**
 * Add or update a cron job. Idempotent — finds the job by `name` and edits
 * schedule if it already exists, otherwise adds it.
 *
 * Uses the documented CLI flags from `openclaw cron add --help`:
 *   --agent <id>  --cron <expr>  --name <name>  --description <text>
 *   --announce  (we don't want announce on heartbeats — omit)
 *
 * Returns { action: 'created' | 'updated' | 'unchanged', name }.
 */
export function cronUpsertHeartbeat({ agentId, name, cronExpr, description, message }) {
  const existing = cronList().find((j) => j.name === name);
  if (existing) {
    // Edit in place if schedule changed
    if (existing.schedule?.expr !== cronExpr || existing.agentId !== agentId) {
      runOpenclaw([
        'cron', 'edit', existing.id || existing.name,
        '--cron', cronExpr,
        '--agent', agentId,
        '--description', description,
      ]);
      return { action: 'updated', name };
    }
    return { action: 'unchanged', name };
  }

  // New job. Flags mirror the previous direct-file layout in cron-setup.mjs:
  //   sessionTarget: 'isolated'      → --session isolated
  //   wakeMode: 'now'                → CLI default; omit
  //   delivery.mode: 'none'          → --no-deliver (no Slack announce)
  //   payload.timeoutSeconds: 600    → --timeout-seconds 600
  runOpenclaw([
    'cron', 'add',
    '--name', name,
    '--agent', agentId,
    '--cron', cronExpr,
    '--description', description,
    '--message', message,
    '--session', 'isolated',
    '--no-deliver',
    '--timeout-seconds', '600',
  ]);
  return { action: 'created', name };
}

/**
 * Remove a cron job by name. Safe to call for a job that doesn't exist.
 */
export function cronRemove(name) {
  const existing = cronList().find((j) => j.name === name);
  if (!existing) return false;
  try {
    runOpenclaw(['cron', 'rm', existing.id || existing.name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `openclaw agents delete <id>`. Best-effort — returns false if the CLI
 * refuses (unknown agent, etc.); caller can decide whether that's fatal.
 */
export function agentsDelete(agentId) {
  try {
    runOpenclaw(['agents', 'delete', agentId, '--non-interactive']);
    return true;
  } catch (err) {
    // Some versions may lack --non-interactive; retry without.
    try {
      runOpenclaw(['agents', 'delete', agentId]);
      return true;
    } catch {
      return false;
    }
  }
}

/** Read gateway.bind (loopback | lan | tailnet | …). Undefined if unset. */
export function getGatewayBind() {
  return configGet('gateway.bind');
}

// ─── Internals ───────────────────────────────────────────────────

function assertWritableConfigPath(p) {
  if (typeof p !== 'string' || !p) {
    throw new OpenclawCliError(`Invalid config path: ${JSON.stringify(p)}`);
  }
  if (p === 'gateway' || p.startsWith('gateway.')) {
    throw new OpenclawCliError(
      `Refusing to write to "${p}" — stask never modifies gateway.* settings. ` +
      `Change it manually with: openclaw config set gateway.<key> <value>`,
    );
  }
}

export { OpenclawCliError };
