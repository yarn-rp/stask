/**
 * lib/setup/openclaw-config.mjs — Read/merge/write ~/.openclaw/openclaw.json.
 *
 * Registers agents, Slack accounts, bindings, and global settings.
 */

import fs from 'node:fs';
import path from 'node:path';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');

/**
 * Load openclaw.json. Returns a minimal skeleton if the file doesn't exist.
 */
export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { agents: { defaults: {}, list: [] }, bindings: [], channels: {} };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

/**
 * Save openclaw.json.
 */
export function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Register 4 agents with full configuration.
 *
 * @param {Object} opts
 * @param {string} opts.projectSlug
 * @param {Array<Object>} opts.agents - Each: { id, name, role, model, fallbacks, workspace, agentDir }
 * @param {string} opts.leadId - ID of the lead agent
 * @param {Object} opts.slackAccounts - Map of agentId → { botToken, appToken }
 * @returns {{ added: string[], skipped: string[] }}
 */
export function registerAgents({ projectSlug, agents, leadId, slackAccounts, openclawDefaults }) {
  const config = loadConfig();
  const added = [];
  const skipped = [];

  // ── Agent defaults (from team manifest or hardcoded fallbacks) ──
  const ocDefaults = openclawDefaults || {};
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};

  const defaults = config.agents.defaults;
  if (!defaults.heartbeat) defaults.heartbeat = {};
  defaults.heartbeat.every = defaults.heartbeat.every || ocDefaults.heartbeat?.every || '10m';
  if (!defaults.compaction) defaults.compaction = {};
  defaults.compaction.mode = defaults.compaction.mode || ocDefaults.compaction?.mode || 'safeguard';
  defaults.maxConcurrent = defaults.maxConcurrent || ocDefaults.maxConcurrent || 4;
  if (!defaults.subagents) defaults.subagents = {};
  defaults.subagents.maxConcurrent = defaults.subagents.maxConcurrent || ocDefaults.subagents?.maxConcurrent || 8;
  if (!defaults.memorySearch) defaults.memorySearch = {};
  defaults.memorySearch.provider = defaults.memorySearch.provider || ocDefaults.memorySearch?.provider || 'ollama';

  // ── Add agents to list ─────────────────────────────────────────
  if (!config.agents.list) config.agents.list = [];
  const existingIds = new Set(config.agents.list.map((a) => a.id));

  const workerIds = agents.filter((a) => a.id !== leadId).map((a) => a.id);

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
      model: agent.model,
    };

    // Add fallback models if provided
    if (agent.fallbacks && agent.fallbacks.length > 0) {
      entry.model = {
        primary: agent.model,
        fallbacks: agent.fallbacks,
      };
    }

    // Hub-and-spoke: lead → all workers, workers → lead only
    if (agent.id === leadId) {
      entry.subagents = { allowAgents: workerIds };
    } else {
      entry.subagents = { allowAgents: [leadId] };
    }

    config.agents.list.push(entry);
    added.push(agent.id);
  }

  // ── Slack channel config ───────────────────────────────────────
  if (!config.channels) config.channels = {};
  if (!config.channels.slack) config.channels.slack = {};

  const slack = config.channels.slack;
  slack.enabled = true;
  slack.mode = slack.mode || 'socket';
  slack.webhookPath = slack.webhookPath || '/slack/events';
  slack.userTokenReadOnly = true;
  slack.groupPolicy = slack.groupPolicy || 'allowlist';
  slack.dmPolicy = slack.dmPolicy || 'open';
  slack.allowFrom = slack.allowFrom || ['*'];
  slack.streaming = slack.streaming || 'partial';
  slack.nativeStreaming = slack.nativeStreaming !== undefined ? slack.nativeStreaming : true;

  if (!slack.channels) slack.channels = {};
  if (!slack.channels['*']) slack.channels['*'] = {};
  slack.channels['*'].requireMention = true;

  // ── Slack accounts ─────────────────────────────────────────────
  if (!slack.accounts) slack.accounts = {};

  for (const agent of agents) {
    const tokens = slackAccounts[agent.id];
    if (!tokens) continue;
    if (slack.accounts[agent.id]) continue; // Don't overwrite existing

    slack.accounts[agent.id] = {
      name: agent.name,
      botToken: tokens.botToken,
      appToken: tokens.appToken,
      userTokenReadOnly: true,
      streaming: 'partial',
      nativeStreaming: true,
      requireMention: true,
    };
  }

  // ── Bindings ───────────────────────────────────────────────────
  if (!config.bindings) config.bindings = [];
  const existingBindings = new Set(config.bindings.map((b) => b.agentId));

  for (const agent of agents) {
    if (existingBindings.has(agent.id)) continue;
    config.bindings.push({
      agentId: agent.id,
      match: { channel: 'slack', accountId: agent.id },
    });
  }

  // ── Hooks ──────────────────────────────────────────────────────
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.internal) config.hooks.internal = {};
  config.hooks.internal.enabled = true;
  if (!config.hooks.internal.entries) config.hooks.internal.entries = {};
  const entries = config.hooks.internal.entries;
  for (const hook of ['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory']) {
    if (!entries[hook]) entries[hook] = {};
    entries[hook].enabled = true;
  }

  // ── Save ───────────────────────────────────────────────────────
  saveConfig(config);
  return { added, skipped };
}
