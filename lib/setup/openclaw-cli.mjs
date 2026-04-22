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

/** Echo the command we're about to run so setup gives feedback in the terminal.
 *  Suppress with STASK_QUIET=1. Writes to stderr so JSON stdout parsers stay
 *  clean. */
function traceCommand(args) {
  if (process.env.STASK_QUIET === '1') return;
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';
  const rendered = args
    .map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))
    .join(' ');
  process.stderr.write(`${DIM}  → openclaw ${rendered}${RESET}\n`);
}

/** Run `openclaw <args>` and return stdout. Throws OpenclawCliError on non-zero exit. */
function runOpenclaw(args, { input, timeoutMs = DEFAULT_TIMEOUT_MS, trace = false } = {}) {
  if (trace) traceCommand(args);
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
    runOpenclaw(['config', 'set', '--batch-file', tmp, '--dry-run'], { trace: true });
    // Apply for real
    runOpenclaw(['config', 'set', '--batch-file', tmp], { trace: true });
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
 * Uses the documented CLI flags (`openclaw cron add --help`). Matches the
 * old direct-file layout in cron-setup.mjs:
 *   sessionTarget: 'isolated'   → --session isolated
 *   wakeMode: 'now'             → CLI default; omit
 *   delivery.mode: 'none'       → --no-deliver
 *   payload.timeoutSeconds      → --timeout-seconds
 *
 * Returns { action: 'created' | 'updated' | 'unchanged', name }.
 */
export function cronUpsert({ agentId, name, cronExpr, description, message, timeoutSeconds = 600 }) {
  if (!agentId || !name || !cronExpr || !message) {
    throw new OpenclawCliError('cronUpsert requires agentId, name, cronExpr, message');
  }

  const existing = cronList().find((j) => j.name === name);
  if (existing) {
    if (existing.schedule?.expr !== cronExpr || existing.agentId !== agentId) {
      runOpenclaw([
        'cron', 'edit', existing.id || existing.name,
        '--cron', cronExpr,
        '--agent', agentId,
        '--description', description || '',
      ], { trace: true });
      return { action: 'updated', name };
    }
    return { action: 'unchanged', name };
  }

  runOpenclaw([
    'cron', 'add',
    '--name', name,
    '--agent', agentId,
    '--cron', cronExpr,
    '--description', description || '',
    '--message', message,
    '--session', 'isolated',
    '--no-deliver',
    '--timeout-seconds', String(timeoutSeconds),
  ], { trace: true });
  return { action: 'created', name };
}

/** Heartbeat-specific alias kept for call-site clarity. */
export const cronUpsertHeartbeat = cronUpsert;

/**
 * Remove a cron job by name. Safe to call for a job that doesn't exist.
 */
export function cronRemove(name) {
  const existing = cronList().find((j) => j.name === name);
  if (!existing) return false;
  try {
    runOpenclaw(['cron', 'rm', existing.id || existing.name], { trace: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a config key. Delegates to `openclaw config unset <path>`. Safe
 * to call on a key that doesn't exist — the CLI returns 0 in that case.
 * Throws OpenclawCliError on real failure.
 */
export function configUnset(p) {
  assertWritableConfigPath(p);
  runOpenclaw(['config', 'unset', p], { trace: true });
}

/**
 * `openclaw agents delete <id>`. Best-effort — returns false if the CLI
 * refuses (unknown agent, etc.); caller can decide whether that's fatal.
 */
export function agentsDelete(agentId) {
  try {
    runOpenclaw(['agents', 'delete', agentId, '--non-interactive'], { trace: true });
    return true;
  } catch (err) {
    // Some versions may lack --non-interactive; retry without.
    try {
      runOpenclaw(['agents', 'delete', agentId], { trace: true });
      return true;
    } catch {
      return false;
    }
  }
}

/** `openclaw agents list --json`. Returns [] on error. */
export function agentsList() {
  try {
    const out = runOpenclaw(['agents', 'list', '--json']).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : (parsed.agents || []);
  } catch {
    return [];
  }
}

/**
 * `openclaw agents add <id>` — creates the agent workspace + agentDir, writes
 * models.json, and (when --bind is passed) registers the routing binding in
 * one shot. Idempotent at the caller level: we skip when agentsList() already
 * contains the id.
 *
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.workspace
 * @param {string} opts.agentDir
 * @param {string} [opts.model]            primary model id
 * @param {string[]} [opts.binds]          each "channel:accountId"
 * @returns {{ created: boolean, id: string }}
 */
export function agentsAdd({ id, workspace, agentDir, model, binds = [] }) {
  if (!id || !workspace || !agentDir) {
    throw new OpenclawCliError('agentsAdd requires id, workspace, agentDir');
  }
  const args = ['agents', 'add', id, '--non-interactive', '--workspace', workspace, '--agent-dir', agentDir];
  if (model) args.push('--model', model);
  for (const b of binds) args.push('--bind', b);
  runOpenclaw(args, { trace: true });
  return { created: true, id };
}

/**
 * `openclaw agents bind --agent <id> --bind ...`. Safe to call repeatedly;
 * the CLI treats already-bound entries as no-ops.
 */
export function agentsBind({ agentId, binds }) {
  if (!agentId || !Array.isArray(binds) || binds.length === 0) return;
  const args = ['agents', 'bind', '--agent', agentId];
  for (const b of binds) args.push('--bind', b);
  try {
    runOpenclaw(args, { trace: true });
  } catch (err) {
    // If the binding already exists the CLI may exit non-zero on some versions;
    // swallow only when stderr indicates that.
    if (err.stderr && /already (bound|exists)/i.test(err.stderr)) return;
    throw err;
  }
}

/**
 * `openclaw channels add --channel <c> --account <a> ...` — add or update a
 * channel account (idempotent per the CLI's own docs).
 *
 * @param {Object} opts
 * @param {string} opts.channel      e.g. "slack"
 * @param {string} opts.account      account id
 * @param {string} [opts.name]       display name
 * @param {string} [opts.botToken]
 * @param {string} [opts.appToken]
 */
export function channelsAdd({ channel, account, name, botToken, appToken }) {
  if (!channel || !account) {
    throw new OpenclawCliError('channelsAdd requires channel and account');
  }
  const args = ['channels', 'add', '--channel', channel, '--account', account];
  if (name) args.push('--name', name);
  if (botToken) args.push('--bot-token', botToken);
  if (appToken) args.push('--app-token', appToken);
  runOpenclaw(args, { trace: true });
}

/**
 * `openclaw hooks enable <name>`. Idempotent — exits 0 even if the hook is
 * already enabled.
 */
export function hooksEnable(name) {
  if (!name) throw new OpenclawCliError('hooksEnable requires a hook name');
  runOpenclaw(['hooks', 'enable', name], { trace: true });
}

/**
 * `openclaw models --agent <id> fallbacks add <model>`. Idempotent is the
 * caller's problem (CLI has no equivalent of "add-or-ignore" yet) — we swallow
 * "already present" errors.
 */
export function modelsFallbacksAdd({ agentId, model }) {
  if (!agentId || !model) throw new OpenclawCliError('modelsFallbacksAdd requires agentId and model');
  try {
    runOpenclaw(['models', '--agent', agentId, 'fallbacks', 'add', model], { trace: true });
  } catch (err) {
    if (err.stderr && /already (present|exists|configured)/i.test(err.stderr)) return;
    throw err;
  }
}

/**
 * Apply a stask trust policy to a Slack account so channel messages from the
 * configured human flow through without approval prompts. Single-key
 * `config set` per field — no dedicated verb exists on `channels add` for
 * these keys. Never batched.
 *
 * Two role-based modes:
 *   • 'lead'   — human can DM; exec approvals enabled with human as approver
 *                (matches the shape OpenClaw uses on the `default` account).
 *   • 'worker' — channel-only; DMs closed; execApprovals disabled so the
 *                lead supervises without every channel msg needing approval.
 *
 * @param {Object} opts
 * @param {string} opts.accountId
 * @param {string} opts.humanSlackUserId
 * @param {'lead'|'worker'} opts.role
 */
export function applySlackTrustPolicy({ accountId, humanSlackUserId, role }) {
  if (!accountId || !humanSlackUserId) {
    throw new OpenclawCliError('applySlackTrustPolicy requires accountId and humanSlackUserId');
  }
  const base = `channels.slack.accounts.${accountId}`;
  configSet(`${base}.allowFrom`, [humanSlackUserId]);
  configSet(`${base}.groupPolicy`, 'open');

  if (role === 'lead') {
    configSet(`${base}.dmPolicy`, 'allowlist');
    configSet(`${base}.execApprovals`, {
      enabled: true,
      approvers: [humanSlackUserId],
      target: 'dm',
    });
  } else {
    // worker — channel-only, DMs disabled, no approval prompts
    configSet(`${base}.dmPolicy`, 'disabled');
    configSet(`${base}.execApprovals`, { enabled: false });
  }
}

/**
 * Single-key `openclaw config set <path> <value>`. Used only for fields that
 * have no dedicated CLI verb (e.g. stask-specific lead↔worker topology on
 * agents.list[].subagents.allowAgents). Never use for batch writes — call the
 * verb for the thing you're setting instead.
 */
export function configSet(p, value) {
  assertWritableConfigPath(p);
  runOpenclaw(['config', 'set', p, JSON.stringify(value), '--strict-json'], { trace: true });
}

/** Read gateway.bind (loopback | lan | tailnet | …). Undefined if unset. */
export function getGatewayBind() {
  return configGet('gateway.bind');
}

/**
 * Read a value from the openclaw.json FILE directly, bypassing the CLI's
 * automatic secret redaction (which turns bot tokens etc. into
 * `__OPENCLAW_REDACTED__` strings).
 *
 * Use only for READ-ONLY access to secrets (bot tokens, app tokens). Never
 * use this to WRITE — writes must still go through configSetBatch so the
 * gateway is notified and the schema is enforced.
 *
 * Returns undefined if the file is missing or the dot-path doesn't resolve.
 */
export function readRawSecret(dotPath) {
  if (typeof dotPath !== 'string' || !dotPath) return undefined;
  const home = process.env.HOME || '';
  const configPath = path.join(home, '.openclaw', 'openclaw.json');
  if (!fs.existsSync(configPath)) return undefined;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return undefined;
  }
  let cur = doc;
  for (const seg of dotPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
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
