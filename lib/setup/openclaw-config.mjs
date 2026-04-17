/**
 * lib/setup/openclaw-config.mjs — Register agents via the openclaw CLI.
 *
 * This used to rewrite ~/.openclaw/openclaw.json in-place with fs.writeFileSync.
 * That race-conditioned with the live gateway writing the same file, producing
 * the `openclaw.json.clobbered.*` snapshots you can see in the directory.
 *
 * Everything now flows through `openclaw config set --batch-file`:
 *   • Schema-validated (the CLI runs --dry-run first).
 *   • Gateway-safe (the CLI coordinates with the running gateway).
 *   • Atomic (single apply step at the end).
 *
 * Hard rule: this module does NOT touch gateway.*. The CLI helper enforces
 * that with an assertion — if a future edit tries to set a gateway key the
 * batch aborts loudly.
 */

import { configGet, configSetBatch } from './openclaw-cli.mjs';

/**
 * Register agents, Slack accounts, bindings, hooks, and sensible subagent defaults.
 *
 * @param {Object} opts
 * @param {string} opts.projectSlug
 * @param {Array<Object>} opts.agents - Each: { id, name, role, model, fallbacks, workspace, agentDir }
 * @param {string} opts.leadId - ID of the lead agent (gets higher concurrency)
 * @param {Object} opts.slackAccounts - Map of agentId → { botToken, appToken }
 * @param {Object} [opts.openclawDefaults] - Subset from team manifest's openclaw block
 * @returns {{ added: string[], skipped: string[] }}
 */
export function registerAgents({ projectSlug, agents, leadId, slackAccounts, openclawDefaults }) {
  const ocDefaults = openclawDefaults || {};
  const ops = [];
  const added = [];
  const skipped = [];

  // ── agents.defaults.* ──────────────────────────────────────────
  // Only set keys that aren't already present so we don't clobber operator
  // choices made outside of stask.
  const existingDefaults = configGet('agents.defaults') || {};

  if (existingDefaults.heartbeat?.every === undefined) {
    ops.push({
      path: 'agents.defaults.heartbeat.every',
      value: ocDefaults.heartbeat?.every || '10m',
    });
  }
  if (existingDefaults.compaction?.mode === undefined) {
    ops.push({
      path: 'agents.defaults.compaction.mode',
      value: ocDefaults.compaction?.mode || 'safeguard',
    });
  }
  // agents.defaults.maxConcurrent caps concurrent turns per agent. When the
  // lead is processing one worker announce and a second worker finishes, the
  // second announce waits for a free slot — that wait is what blew past the
  // (previously too-short) announceTimeoutMs. Raising to 8 team-wide lets
  // the lead absorb all workers + heartbeat + Slack activity without queueing.
  // Per-agent overrides aren't in the schema, so this is the only lever.
  const wantMaxConcurrent = ocDefaults.maxConcurrent ?? 8;
  if ((existingDefaults.maxConcurrent ?? 0) < wantMaxConcurrent) {
    ops.push({ path: 'agents.defaults.maxConcurrent', value: wantMaxConcurrent });
  }

  // Subagents block — the one that was missing before, which caused the
  // gateway timeout spam. 120000ms is the built-in default; cloud models
  // regularly exceed that during a full parent turn.
  const wantSubagents = {
    maxConcurrent: ocDefaults.subagents?.maxConcurrent ?? 8,
    announceTimeoutMs: ocDefaults.subagents?.announceTimeoutMs ?? 600_000,
    runTimeoutSeconds: ocDefaults.subagents?.runTimeoutSeconds ?? 1800,
  };
  for (const [key, want] of Object.entries(wantSubagents)) {
    const have = existingDefaults.subagents?.[key];
    // Raise if unset OR if the configured value is still at/below the stale
    // default — we own these knobs and a previous install with a too-low
    // value should be upgraded automatically.
    if (have === undefined || (key === 'announceTimeoutMs' && have < 600_000)) {
      ops.push({ path: `agents.defaults.subagents.${key}`, value: want });
    }
  }

  if (existingDefaults.memorySearch?.provider === undefined) {
    ops.push({
      path: 'agents.defaults.memorySearch.provider',
      value: ocDefaults.memorySearch?.provider || 'ollama',
    });
  }

  // ── agents.list[] — additive merge by id ───────────────────────
  //
  // Concurrency for the lead is handled by agents.defaults.maxConcurrent
  // (raised above); per-agent maxConcurrent isn't in the schema.
  const existingList = configGet('agents.list') || [];
  const existingIds = new Set(existingList.map((a) => a.id));
  const workerIds = agents.filter((a) => a.id !== leadId).map((a) => a.id);

  const mergedList = existingList.slice();
  let listDirty = false;

  for (const agent of agents) {
    if (existingIds.has(agent.id)) {
      skipped.push(agent.id);
      continue;
    }

    const entry = {
      id: agent.id,
      name: agent.id,
      workspace: agent.workspace,
      agentDir: agent.agentDir,
    };

    // Model: object form when fallbacks present, scalar otherwise
    if (agent.fallbacks && agent.fallbacks.length > 0) {
      entry.model = { primary: agent.model, fallbacks: agent.fallbacks };
    } else {
      entry.model = agent.model;
    }

    // Topology — lead talks to all workers, workers only to lead.
    if (agent.id === leadId) {
      entry.subagents = { allowAgents: workerIds };
    } else {
      entry.subagents = { allowAgents: [leadId] };
    }

    mergedList.push(entry);
    added.push(agent.id);
    listDirty = true;
  }

  if (listDirty) {
    ops.push({ path: 'agents.list', value: mergedList });
  }

  // ── channels.slack.* (idempotent scalar defaults) ──────────────
  const existingSlack = configGet('channels.slack') || {};
  const slackScalarDefaults = {
    enabled: true,
    mode: existingSlack.mode || 'socket',
    webhookPath: existingSlack.webhookPath || '/slack/events',
    userTokenReadOnly: true,
    groupPolicy: existingSlack.groupPolicy || 'allowlist',
    dmPolicy: existingSlack.dmPolicy || 'open',
    allowFrom: existingSlack.allowFrom || ['*'],
    streaming: existingSlack.streaming || 'partial',
    nativeStreaming: existingSlack.nativeStreaming !== undefined ? existingSlack.nativeStreaming : true,
  };
  for (const [key, value] of Object.entries(slackScalarDefaults)) {
    if (existingSlack[key] === undefined || (key === 'enabled' && existingSlack[key] !== true)) {
      ops.push({ path: `channels.slack.${key}`, value });
    }
  }
  if (!existingSlack.channels?.['*']?.requireMention) {
    ops.push({ path: 'channels.slack.channels.*.requireMention', value: true });
  }

  // ── channels.slack.accounts[<id>] — per-agent ──────────────────
  const existingAccounts = existingSlack.accounts || {};
  for (const agent of agents) {
    const tokens = slackAccounts[agent.id];
    if (!tokens) continue;
    if (existingAccounts[agent.id]) continue; // don't overwrite

    ops.push({
      path: `channels.slack.accounts.${agent.id}`,
      value: {
        name: agent.name,
        botToken: tokens.botToken,
        appToken: tokens.appToken,
        userTokenReadOnly: true,
        streaming: 'partial',
        nativeStreaming: true,
        requireMention: true,
      },
    });
  }

  // ── bindings[] — additive merge by agentId ─────────────────────
  const existingBindings = configGet('bindings') || [];
  const boundAgentIds = new Set(existingBindings.map((b) => b.agentId));
  const mergedBindings = existingBindings.slice();
  let newBindings = 0;
  for (const agent of agents) {
    if (boundAgentIds.has(agent.id)) continue;
    mergedBindings.push({
      agentId: agent.id,
      match: { channel: 'slack', accountId: agent.id },
    });
    newBindings++;
  }
  if (newBindings > 0) {
    ops.push({ path: 'bindings', value: mergedBindings });
  }

  // ── hooks.internal — enable stask's required hooks ─────────────
  const existingHooks = configGet('hooks.internal') || {};
  if (existingHooks.enabled !== true) {
    ops.push({ path: 'hooks.internal.enabled', value: true });
  }
  for (const hook of ['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory']) {
    if (!existingHooks.entries?.[hook]?.enabled) {
      ops.push({ path: `hooks.internal.entries.${hook}.enabled`, value: true });
    }
  }

  // ── Apply atomically (dry-run + validate, then commit) ─────────
  if (ops.length > 0) {
    configSetBatch(ops);
  }

  return { added, skipped };
}
