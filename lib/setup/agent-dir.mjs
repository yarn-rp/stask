/**
 * lib/setup/agent-dir.mjs — Create ~/.openclaw/agents/<id>/agent/ with models.json.
 *
 * Each agent needs an isolated agentDir for auth profiles, model config,
 * and session storage. This module creates the directory structure and
 * writes the Ollama-only models.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_TEMPLATE = path.resolve(__dirname, '../../templates/team/models.json');
const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

/**
 * Create the agent directory structure and write models.json.
 *
 * @param {string} agentId - e.g. 'richard'
 * @returns {string} The agentDir path created
 */
export function createAgentDir(agentId) {
  const agentDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'agent');
  const sessionsDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions');

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Write models.json (Ollama-only)
  const modelsPath = path.join(agentDir, 'models.json');
  if (!fs.existsSync(modelsPath)) {
    fs.copyFileSync(MODELS_TEMPLATE, modelsPath);
  }

  return agentDir;
}

/**
 * Get the standard agentDir path for an agent.
 */
export function getAgentDirPath(agentId) {
  return path.join(OPENCLAW_HOME, 'agents', agentId, 'agent');
}
