/**
 * lib/setup/agent-dir.mjs — Compute the OpenClaw per-agent directory path.
 *
 * Previously this module also created the directory tree and seeded
 * models.json. That's now `openclaw agents add`'s job — it owns the
 * layout (agent/, sessions/, models.json) and stays in sync with the
 * schema OpenClaw currently speaks.
 */

import path from 'node:path';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

/** Standard agentDir path for an agent (no side effects). */
export function getAgentDirPath(agentId) {
  return path.join(OPENCLAW_HOME, 'agents', agentId, 'agent');
}
