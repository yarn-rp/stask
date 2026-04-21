/**
 * lib/setup/openclaw-config.mjs — Register agents + Slack accounts with OpenClaw.
 *
 * Migrated from direct JSON mutation (~/.openclaw/openclaw.json) to driving
 * the `openclaw` CLI so we stay on whatever schema OpenClaw currently speaks
 * and respect any user customizations.
 *
 * Delegates the actual writes to three commands:
 *   - `openclaw channels add --channel slack ...`   (upsert, idempotent)
 *   - `openclaw agents add <id> ...`                (not idempotent — we check)
 *   - `openclaw agents bind --agent <id> ...`       (add-only, cheap no-op)
 *
 * Anything that isn't clearly ours to own (channel policies, hook entries,
 * agent defaults that aren't stask-specific) is left alone. Whatever the
 * user's `~/.openclaw/openclaw.json` already has wins.
 *
 * Stask-specific knobs (the `acp` block — Codex-via-acpx settings) are
 * written to the per-project `.stask/config.json` instead, where they belong.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  listAgents,
  agentExists,
  addAgent,
  bindAgent,
  upsertSlackAccount,
  applySlackTrustPolicy,
} from './openclaw-cli.mjs';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

/**
 * Register agents with OpenClaw via the CLI.
 *
 * @param {Object} opts
 * @param {string} opts.projectSlug
 * @param {Array<{id, name, workspace, agentDir, model, fallbacks?}>} opts.agents
 * @param {string} opts.leadId
 * @param {Object<string, {botToken, appToken}>} opts.slackAccounts
 * @param {Object} [opts.acpDefaults] — written to .stask/config.json (not openclaw.json).
 * @param {string} [opts.staskConfigPath] — path to .stask/config.json; if present,
 *   `acp` defaults are merged there. Optional; stask wizard passes it.
 * @returns {{ added: string[], skipped: string[], slackAccounts: {added: string[]}, bindings: {added: string[], skipped: string[]} }}
 */
export function registerAgents({
  projectSlug,
  agents,
  leadId,
  slackAccounts,
  acpDefaults,
  staskConfigPath,
  humanSlackUserId,
  // Legacy kwargs kept for back-compat — ignored. OpenClaw owns these now.
  openclawDefaults: _ignoredOpenclawDefaults,
}) {
  const added = [];
  const skipped = [];
  const slackAdded = [];
  const bindAdded = [];
  const bindSkipped = [];
  const trustApplied = [];

  // ── 1. Upsert Slack accounts (idempotent at the CLI level) ───────
  for (const agent of agents) {
    const tokens = slackAccounts?.[agent.id];
    if (!tokens?.botToken || !tokens?.appToken) continue;
    upsertSlackAccount({
      accountId: agent.id,
      botToken: tokens.botToken,
      appToken: tokens.appToken,
      name: agent.name || agent.id,
    });
    slackAdded.push(agent.id);

    // `channels add` creates the account with no trust policy — OpenClaw
    // then prompts for approval on every DM/channel message. Seed the
    // allowlist + disable exec approvals so the configured human can
    // DM the agent and post in its channel without round-tripping through
    // an approval prompt.
    if (humanSlackUserId) {
      try {
        applySlackTrustPolicy({ accountId: agent.id, humanSlackUserId });
        trustApplied.push(agent.id);
      } catch (err) {
        // Non-fatal: user can set this manually later.
        // eslint-disable-next-line no-console
        console.warn(`  ! applySlackTrustPolicy(${agent.id}) failed: ${err.message.split('\n')[0]}`);
      }
    }
  }

  // ── 2. Add agents (skip if already present) ──────────────────────
  const existing = listAgents();
  const existingIds = new Set(existing.map(a => a.id));

  for (const agent of agents) {
    if (existingIds.has(agent.id)) {
      skipped.push(agent.id);
      continue;
    }
    // `--bind slack:<id>` at add-time avoids a second round-trip for new agents.
    const bindings = slackAccounts?.[agent.id] ? [`slack:${agent.id}`] : [];
    addAgent({
      id: agent.id,
      workspace: agent.workspace,
      agentDir: agent.agentDir,
      model: agent.model,
      bindings,
    });
    added.push(agent.id);
    if (bindings.length > 0) bindAdded.push(`${agent.id} -> ${bindings.join(', ')}`);
  }

  // ── 3. Ensure bindings exist for agents that were already present ─
  for (const agent of agents) {
    if (!existingIds.has(agent.id)) continue; // just added above
    if (!slackAccounts?.[agent.id]) continue;
    try {
      const result = bindAgent({ id: agent.id, bindings: [`slack:${agent.id}`] });
      if (result.added && result.added.length > 0) {
        bindAdded.push(`${agent.id} -> slack:${agent.id}`);
      } else {
        bindSkipped.push(`${agent.id} -> slack:${agent.id} (already bound)`);
      }
    } catch (err) {
      // Bindings can fail when the agent doesn't exist or the binding already
      // exists in an incompatible shape. Surface the error loudly — caller can
      // decide whether to continue.
      throw new Error(`openclaw agents bind for "${agent.id}" failed: ${err.message}`);
    }
  }

  // ── 4. Write stask-specific ACP defaults to .stask/config.json ────
  //
  // These used to live under `agents.defaults.acp` in openclaw.json, but
  // OpenClaw's schema doesn't include `acp` — it's a stask concept. Store
  // it in the stask config file so the setup flow stays schema-clean.
  if (acpDefaults && staskConfigPath && fs.existsSync(staskConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(staskConfigPath, 'utf-8'));
    cfg.acp = {
      enabled: acpDefaults.enabled ?? true,
      cli: acpDefaults.cli || 'acpx',
      agent: acpDefaults.agent || 'codex',
      pingIntervalSeconds: acpDefaults.pingIntervalSeconds ?? 60,
      hangTimeoutMinutes: acpDefaults.hangTimeoutMinutes ?? 3,
      ttlSeconds: acpDefaults.ttlSeconds ?? 0,
      fallback: acpDefaults.fallback || 'fail',
    };
    fs.writeFileSync(staskConfigPath, JSON.stringify(cfg, null, 2) + '\n');
  }

  return {
    added,
    skipped,
    slackAccounts: { added: slackAdded, trustApplied },
    bindings: { added: bindAdded, skipped: bindSkipped },
  };
}

// Re-export for tests/scripts that want to probe state directly.
export { listAgents, agentExists } from './openclaw-cli.mjs';
export const OPENCLAW_HOME_PATH = OPENCLAW_HOME;
