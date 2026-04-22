/**
 * lib/setup/openclaw-cli.mjs — Thin wrapper around the `openclaw` CLI.
 *
 * We drive setup through OpenClaw's own commands rather than mutating
 * ~/.openclaw/openclaw.json directly. This keeps us on whatever schema
 * OpenClaw currently speaks and respects any existing user customizations.
 *
 * Gateway dependency: `cron *` commands need a running gateway.
 * `agents *`, `channels *`, `config *` commands only touch the config file.
 */

import { spawnSync } from 'node:child_process';

/**
 * Run `openclaw <args>` synchronously. Returns `{ ok, exitCode, stdout, stderr }`.
 *
 * `bin` can be overridden (useful in tests to point at a stub).
 */
export function runOpenclaw(args, { bin = process.env.STASK_OPENCLAW_BIN || 'openclaw', input } = {}) {
  const result = spawnSync(bin, args, {
    encoding: 'utf-8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    return { ok: false, exitCode: -1, stdout: '', stderr: String(result.error.message || result.error), signal: null };
  }
  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || null,
  };
}

/**
 * Run `openclaw` and parse its stdout as JSON. Throws a descriptive error
 * on non-zero exit or unparseable output.
 */
export function runOpenclawJson(args, opts = {}) {
  const res = runOpenclaw(args, opts);
  if (!res.ok) {
    const err = new Error(`openclaw ${args.join(' ')} failed (exit ${res.exitCode}): ${res.stderr.trim() || res.stdout.trim()}`);
    err.exitCode = res.exitCode;
    err.stderr = res.stderr;
    err.stdout = res.stdout;
    throw err;
  }
  try {
    return JSON.parse(res.stdout);
  } catch (parseErr) {
    const err = new Error(`openclaw ${args.join(' ')} emitted non-JSON stdout: ${parseErr.message}\n--- stdout ---\n${res.stdout}`);
    err.cause = parseErr;
    throw err;
  }
}

// ─── Agents ────────────────────────────────────────────────────────

/**
 * Return the list of configured agents as `{ id, workspace, agentDir, model, ... }`.
 */
export function listAgents(opts) {
  return runOpenclawJson(['agents', 'list', '--json'], opts);
}

/**
 * Check whether an agent id exists.
 */
export function agentExists(id, opts) {
  try {
    return listAgents(opts).some(a => a.id === id);
  } catch {
    return false;
  }
}

/**
 * Add a new agent. Fails loud if the id already exists (see agentExists).
 *
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.workspace
 * @param {string} [args.agentDir]
 * @param {string} [args.model]
 * @param {string[]} [args.bindings]  Each is "channel:accountId" or just "channel".
 */
export function addAgent({ id, workspace, agentDir, model, bindings = [] }, opts) {
  const args = ['agents', 'add', id, '--non-interactive', '--json', '--workspace', workspace];
  if (agentDir) args.push('--agent-dir', agentDir);
  if (model) args.push('--model', model);
  for (const b of bindings) args.push('--bind', b);
  return runOpenclawJson(args, opts);
}

/**
 * Attach one or more routing bindings to an existing agent. Idempotent at the
 * CLI level — "already bound" entries show up in `skipped`, not as an error.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {string[]} args.bindings  Each is "channel:accountId".
 */
export function bindAgent({ id, bindings }, opts) {
  if (!bindings || bindings.length === 0) return { added: [], skipped: [], conflicts: [] };
  const args = ['agents', 'bind', '--agent', id, '--json'];
  for (const b of bindings) args.push('--bind', b);
  return runOpenclawJson(args, opts);
}

/**
 * Delete an agent and prune its state.
 */
export function deleteAgent(id, opts) {
  return runOpenclawJson(['agents', 'delete', id, '--force', '--json'], opts);
}

/**
 * Update an agent identity (display name/emoji/theme/avatar).
 */
export function setAgentIdentity({ id, name, emoji, theme, avatar }, opts) {
  const args = ['agents', 'set-identity', '--agent', id, '--json'];
  if (name) args.push('--name', name);
  if (emoji) args.push('--emoji', emoji);
  if (theme) args.push('--theme', theme);
  if (avatar) args.push('--avatar', avatar);
  return runOpenclawJson(args, opts);
}

// ─── Channels (Slack) ──────────────────────────────────────────────

/**
 * Add or upsert a Slack account. `channels add` is idempotent at the CLI
 * level — calling it twice with the same --account replaces the tokens.
 *
 * @param {object} args
 * @param {string} args.accountId
 * @param {string} args.botToken
 * @param {string} args.appToken
 * @param {string} [args.name]   Display name for this account.
 */
export function upsertSlackAccount({ accountId, botToken, appToken, name }, opts) {
  const args = ['channels', 'add', '--channel', 'slack', '--account', accountId, '--bot-token', botToken, '--app-token', appToken];
  if (name) args.push('--name', name);
  // channels add doesn't support --json, so we settle for exit code + stderr.
  const res = runOpenclaw(args, opts);
  if (!res.ok) {
    const err = new Error(`openclaw channels add slack:${accountId} failed (exit ${res.exitCode}): ${res.stderr.trim() || res.stdout.trim()}`);
    err.exitCode = res.exitCode;
    err.stderr = res.stderr;
    throw err;
  }
  return { ok: true, accountId, stdout: res.stdout };
}

/**
 * Apply the default stask trust policy for a Slack account:
 *
 *   - allowFrom: [humanSlackUserId]              (whitelist the human)
 *   - dmPolicy: "allowlist"                      (DMs only from allowFrom)
 *   - groupPolicy: "open"                        (channel messages pass)
 *   - execApprovals: { enabled: false }          (no approval prompts for the human)
 *
 * `channels add` creates accounts with none of these set, which makes
 * OpenClaw prompt for approval on every DM and channel message. Calling
 * this after upsertSlackAccount silences that for the configured human
 * while keeping the gate closed for everyone else.
 */
/**
 * Enable and configure the bundled acpx plugin so Sub-agent calls with
 * `runtime: "acp"` auto-approve file edits inside agent-managed sessions.
 *
 * Without this, acpx defaults to `permissionMode: "approve-reads"` — writes
 * prompt for approval, which cron-triggered agents cannot answer, so QA/build
 * turns stall indefinitely.
 *
 * Safe to call repeatedly; settings are idempotent.
 */
export function enableAcpxPluginWithAutoApprove(opts) {
  configSet('plugins.entries.acpx.enabled', true, opts);
  configSet('plugins.entries.acpx.config.permissionMode', 'approve-all', opts);
  configSet('plugins.entries.acpx.config.nonInteractivePermissions', 'deny', opts);
  return { ok: true };
}

export function applySlackTrustPolicy({ accountId, humanSlackUserId }, opts) {
  if (!humanSlackUserId) return { ok: false, reason: 'humanSlackUserId required' };
  const base = `channels.slack.accounts.${accountId}`;
  configSet(`${base}.allowFrom`, [humanSlackUserId], opts);
  configSet(`${base}.dmPolicy`, 'allowlist', opts);
  configSet(`${base}.groupPolicy`, 'open', opts);
  configSet(`${base}.execApprovals`, { enabled: false }, opts);
  return { ok: true, accountId };
}

/**
 * Remove a Slack account.
 */
export function removeSlackAccount(accountId, opts) {
  const res = runOpenclaw(['channels', 'remove', '--channel', 'slack', '--account', accountId, '--delete'], opts);
  return { ok: res.ok, accountId, stdout: res.stdout, stderr: res.stderr };
}

// ─── Cron (requires running gateway) ───────────────────────────────

/**
 * List cron jobs. Returns [] if gateway is unreachable (with a warning on
 * stderr so callers can decide whether to retry).
 */
export function listCronJobs(opts = {}) {
  const res = runOpenclaw(['cron', 'list', '--json'], opts);
  if (!res.ok) {
    const gatewayDown = /gateway (closed|unreachable|not running)/i.test(res.stderr);
    if (opts.allowGatewayDown && gatewayDown) {
      return { ok: false, gatewayDown: true, jobs: [] };
    }
    const err = new Error(`openclaw cron list failed: ${res.stderr.trim() || res.stdout.trim()}`);
    err.exitCode = res.exitCode;
    err.gatewayDown = gatewayDown;
    throw err;
  }
  try {
    const parsed = JSON.parse(res.stdout);
    // `openclaw cron list --json` wraps jobs in `{ jobs: [...] }` on current
    // versions; older snapshots returned a bare array. Handle both.
    const jobs = Array.isArray(parsed) ? parsed : (parsed?.jobs || []);
    return { ok: true, jobs };
  } catch (parseErr) {
    const err = new Error(`openclaw cron list emitted non-JSON: ${parseErr.message}\n${res.stdout}`);
    err.cause = parseErr;
    throw err;
  }
}

/**
 * Add a cron job. `cron add` is NOT idempotent — callers should rm first
 * if a job of the same name exists (see replaceCronJob below).
 */
export function addCronJob({ name, cron, every, agent, message, session = 'isolated', wake = 'now', description, tz, stagger, tools, model, thinking, timeoutSeconds }, opts) {
  if (!name) throw new Error('addCronJob: name required');
  if (!cron && !every) throw new Error('addCronJob: one of --cron or --every required');
  const args = ['cron', 'add', '--name', name, '--session', session, '--wake', wake, '--json'];
  if (cron) args.push('--cron', cron);
  if (every) args.push('--every', every);
  if (agent) args.push('--agent', agent);
  if (message) args.push('--message', message);
  if (description) args.push('--description', description);
  if (tz) args.push('--tz', tz);
  if (stagger) args.push('--stagger', stagger);
  if (tools) args.push('--tools', tools);
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (timeoutSeconds) args.push('--timeout-seconds', String(timeoutSeconds));
  return runOpenclawJson(args, opts);
}

/**
 * Remove a cron job by id.
 */
export function removeCronJob(id, opts) {
  return runOpenclawJson(['cron', 'rm', id, '--json'], opts);
}

/**
 * Upsert a cron job by name: if a job with this name exists, remove it
 * first, then add with the new spec. Requires a running gateway.
 *
 * @returns { replaced: boolean, job: <openclaw cron add response> }
 */
export function replaceCronJob(spec, opts) {
  const list = listCronJobs(opts);
  const existing = (list.jobs || []).find(j => j.name === spec.name);
  let replaced = false;
  if (existing) {
    removeCronJob(existing.id, opts);
    replaced = true;
  }
  const job = addCronJob(spec, opts);
  return { replaced, job };
}

// ─── Non-interactive config set ────────────────────────────────────

/**
 * Set a config value via `openclaw config set`. Safer than direct file
 * mutation because OpenClaw validates + writes atomically.
 *
 * @param {string} path  Dot path, e.g. "channels.slack.requireMention".
 * @param {unknown} value  Any JSON value; passed to --strict-json.
 */
export function configSet(path, value, opts) {
  const args = ['config', 'set', path, JSON.stringify(value), '--strict-json'];
  const res = runOpenclaw(args, opts);
  if (!res.ok) {
    const err = new Error(`openclaw config set ${path} failed: ${res.stderr.trim() || res.stdout.trim()}`);
    err.exitCode = res.exitCode;
    throw err;
  }
  return { ok: true, path };
}

/**
 * Read a config value. Returns null if the path isn't set.
 */
export function configGet(path, opts) {
  const res = runOpenclaw(['config', 'get', path], opts);
  if (!res.ok) {
    if (/not found/i.test(res.stderr) || /not found/i.test(res.stdout)) return null;
    const err = new Error(`openclaw config get ${path} failed: ${res.stderr.trim() || res.stdout.trim()}`);
    err.exitCode = res.exitCode;
    throw err;
  }
  const trimmed = res.stdout.trim();
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}
