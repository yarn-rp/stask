/**
 * lib/setup/manifest.mjs — Load and access team + agent manifest files.
 *
 * The template directory contains:
 *   - manifest.json         — team-level orchestration config
 *   - <role>/manifest.json  — per-agent config (model, skills, cron, slack)
 *
 * The CLI discovers roles by scanning for manifest.json files in subdirectories.
 * No hardcoded role list — the template defines the team.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Load the team manifest and all agent manifests from a template directory.
 *
 * @param {string} templateDir - Path to templates/team/
 * @returns {{ team: Object, agents: Object<string, Object> }}
 */
export function loadManifests(templateDir) {
  // Team manifest
  const teamPath = path.join(templateDir, 'manifest.json');
  if (!fs.existsSync(teamPath)) {
    throw new Error(`Team manifest not found: ${teamPath}`);
  }
  const team = JSON.parse(fs.readFileSync(teamPath, 'utf-8'));

  // Discover agent manifests by scanning subdirectories
  const agents = {};
  for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared') continue;
    const agentPath = path.join(templateDir, entry.name, 'manifest.json');
    if (fs.existsSync(agentPath)) {
      agents[entry.name] = JSON.parse(fs.readFileSync(agentPath, 'utf-8'));
    }
  }

  if (Object.keys(agents).length === 0) {
    throw new Error(`No agent manifests found in ${templateDir}. Each role directory needs a manifest.json.`);
  }

  return { team, agents };
}

/**
 * Get all roles as an ordered array: lead first, then workers.
 */
export function getRoles(agents) {
  const entries = Object.entries(agents);
  const lead = entries.filter(([_, m]) => m.subagents === 'all');
  const workers = entries.filter(([_, m]) => m.subagents !== 'all');
  return [...lead, ...workers].map(([id, manifest]) => ({ id, ...manifest }));
}

/**
 * Get the lead role (subagents: "all").
 */
export function getLeadRole(agents) {
  const entry = Object.entries(agents).find(([_, m]) => m.subagents === 'all');
  if (!entry) throw new Error('No lead role found (subagents: "all")');
  return { id: entry[0], ...entry[1] };
}

/**
 * Get worker roles (subagents: "lead-only").
 */
export function getWorkerRoles(agents) {
  return Object.entries(agents)
    .filter(([_, m]) => m.subagents === 'lead-only')
    .map(([id, manifest]) => ({ id, ...manifest }));
}

/**
 * Generate the Slack app manifest JSON string for an agent.
 * Reads the manifest template from the agent's manifest.json and replaces placeholders.
 *
 * @param {Object} agentManifest - The agent's manifest.json
 * @param {string} agentName - Display name (e.g., "Richard")
 * @returns {string} Ready-to-paste Slack manifest JSON
 */
export function generateSlackManifest(agentManifest, agentName) {
  const template = agentManifest.slack.manifest;
  let json = JSON.stringify(template, null, 2);

  const displayName = agentName;
  const description = agentManifest.description;
  const color = agentManifest.slack.color;

  json = json.replaceAll('{{AGENT_DISPLAY_NAME}}', displayName);
  json = json.replaceAll('{{AGENT_DESCRIPTION}}', description);
  json = json.replaceAll('{{AGENT_COLOR}}', color);

  return json;
}
