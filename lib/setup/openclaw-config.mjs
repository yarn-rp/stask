/**
 * lib/setup/openclaw-config.mjs — Register agents via the openclaw CLI.
 *
 * Rule: every side-effect goes through an `openclaw` CLI verb with its
 * documented arguments. No raw file mutation, no `config set --batch-file`.
 *
 *   • `openclaw channels add`             — Slack account (tokens + name)
 *   • `openclaw agents add --bind ...`    — create agent (agentDir, workspace,
 *                                            model, routing binding in one go)
 *   • `openclaw agents bind`              — idempotent re-bind for existing agents
 *   • `openclaw models --agent <id> fallbacks add` — per-agent model fallbacks
 *   • `openclaw hooks enable`             — internal hooks stask relies on
 *
 * Lead↔worker topology lives on `agents.list[].subagents.allowAgents`, which
 * has no dedicated verb. For that one field we use a single-key
 * `openclaw config set`, still through the CLI — never a batch file.
 *
 * Anything that used to be set under `agents.defaults.*` or the
 * `channels.slack.*` scalars is now left to OpenClaw's own defaults / the
 * operator's own tuning.
 */

import {
  agentsList,
  agentsAdd,
  agentsBind,
  channelsAdd,
  hooksEnable,
  modelsFallbacksAdd,
  configSet,
  applySlackTrustPolicy,
} from './openclaw-cli.mjs';

/**
 * Register agents, Slack accounts, bindings, hooks, and topology.
 *
 * @param {Object} opts
 * @param {string} opts.projectSlug
 * @param {Array<Object>} opts.agents - Each: { id, name, role, model, fallbacks, workspace, agentDir }
 * @param {string} opts.leadId - ID of the lead agent
 * @param {Object} opts.slackAccounts - Map of agentId → { botToken, appToken }
 * @returns {{ added: string[], skipped: string[] }}
 */
// Top-level openclaw.json paths the team manifest may set during register.
// Anything outside this allowlist is ignored — manifests can't write arbitrary
// config. Each entry is the dot-path that's read out of teamManifest.openclaw.
const APPLICABLE_OPENCLAW_PATHS = [
  'tools.sessions.visibility',
];

function pickPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export function registerAgents({ agents, leadId, slackAccounts, humanSlackUserId, openclawDefaults }) {
  const added = [];
  const skipped = [];

  // ── 1. Slack accounts — `openclaw channels add` (idempotent per docs) ──
  //      + trust policy so channel messages from the human don't stall on
  //      approval prompts. Lead gets DM access; workers are channel-only.
  for (const agent of agents) {
    const tokens = slackAccounts?.[agent.id];
    if (!tokens?.botToken) continue;
    channelsAdd({
      channel: 'slack',
      account: agent.id,
      name: agent.name,
      botToken: tokens.botToken,
      appToken: tokens.appToken,
    });
    if (humanSlackUserId) {
      applySlackTrustPolicy({
        accountId: agent.id,
        humanSlackUserId,
        role: agent.id === leadId ? 'lead' : 'worker',
      });
    }
  }

  // ── 2. Agents — `openclaw agents add` creates agentDir + models.json + binding ──
  const existingIds = new Set(agentsList().map((a) => a.id));

  for (const agent of agents) {
    if (existingIds.has(agent.id)) {
      skipped.push(agent.id);
      continue;
    }
    const binds = slackAccounts?.[agent.id]?.botToken ? [`slack:${agent.id}`] : [];
    agentsAdd({
      id: agent.id,
      workspace: agent.workspace,
      agentDir: agent.agentDir,
      model: agent.model,
      binds,
    });
    added.push(agent.id);

    // Per-agent model fallbacks — `openclaw models --agent <id> fallbacks add`
    for (const fb of agent.fallbacks || []) {
      modelsFallbacksAdd({ agentId: agent.id, model: fb });
    }
  }

  // ── 3. Bindings — idempotent re-bind for agents that already existed ──
  for (const agent of agents) {
    if (!existingIds.has(agent.id)) continue; // brand-new agents were bound via --bind
    if (!slackAccounts?.[agent.id]?.botToken) continue;
    agentsBind({ agentId: agent.id, binds: [`slack:${agent.id}`] });
  }

  // ── 4. Hooks — `openclaw hooks enable <name>` (idempotent) ──
  for (const hook of ['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory']) {
    hooksEnable(hook);
  }

  // ── 4b. Team-wide openclaw config from the manifest. Allowlisted paths
  //    only; values not declared by the manifest are left untouched.
  for (const dotPath of APPLICABLE_OPENCLAW_PATHS) {
    const value = pickPath(openclawDefaults, dotPath);
    if (value !== undefined) configSet(dotPath, value);
  }

  // ── 5. Topology — no CLI verb for subagents.allowAgents; use single-key
  //    `openclaw config set`. Lead talks to all workers; workers talk only to
  //    the lead. Read agents.list back after `agents add` so we know the
  //    correct array indices.
  const finalList = agentsList();
  const workerIds = agents.filter((a) => a.id !== leadId).map((a) => a.id);
  for (const agent of agents) {
    const idx = finalList.findIndex((a) => a.id === agent.id);
    if (idx === -1) continue;
    const allowAgents = agent.id === leadId ? workerIds : [leadId];
    configSet(`agents.list.${idx}.subagents.allowAgents`, allowAgents);
  }

  return { added, skipped };
}
