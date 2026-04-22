/**
 * lib/setup/claude-subagents.mjs — Scaffold Claude Code subagent + skill files
 * into <repoPath>/.claude/ so coding sessions opened via `claude --agent <name>`
 * preload the role playbook at startup.
 *
 * One agent file per configured stask agent (using the agent's actual name).
 * Shared skill tree copied verbatim from templates/claude/skills/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates/claude');

const ROLE_TITLES = {
  lead: 'Team Lead',
  worker: 'Engineer',
  qa: 'QA Engineer',
};

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function normalizeStaskRole(roleId) {
  if (roleId === 'lead') return 'lead';
  if (roleId === 'qa') return 'qa';
  return 'worker';
}

function renderTemplate(tmpl, values) {
  let out = tmpl;
  for (const [k, v] of Object.entries(values)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Scaffold .claude/agents and .claude/skills directories into the repo.
 *
 * @param {Object} opts
 * @param {string} opts.repoPath  - Target repo (files land at <repoPath>/.claude/)
 * @param {string} opts.projectName
 * @param {string} opts.projectSlug
 * @param {string} opts.humanName
 * @param {Array<{name: string, roleId: string}>} opts.agents
 *        `roleId` is the manifest role (lead, backend, frontend, qa).
 *        `name` is the configured agent name (lowercase).
 * @returns {{ agentsWritten: number, skillsCopied: number, claudeDir: string }}
 */
export function scaffoldClaudeSubagents({ repoPath, projectName, projectSlug, humanName, agents }) {
  const claudeDir = path.join(repoPath, '.claude');
  const agentsDir = path.join(claudeDir, 'agents');
  const skillsDir = path.join(claudeDir, 'skills');

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  const tmplPath = path.join(TEMPLATE_DIR, 'agents', 'agent.md.tmpl');
  const tmpl = fs.readFileSync(tmplPath, 'utf-8');

  let agentsWritten = 0;
  for (const { name, roleId } of agents) {
    const staskRole = normalizeStaskRole(roleId);
    const roleTitle = ROLE_TITLES[staskRole] || 'Engineer';
    const rendered = renderTemplate(tmpl, {
      AGENT_NAME: capitalize(name),
      AGENT_NAME_LOWER: name,
      ROLE_TITLE: roleTitle,
      STASK_ROLE: staskRole,
      PROJECT_NAME: projectName,
      PROJECT_SLUG: projectSlug,
      HUMAN_NAME: humanName || 'your human teammate',
    });
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), rendered);
    agentsWritten++;
  }

  // Copy skills tree (stask-lead, stask-worker, stask-qa, stask-general)
  const srcSkills = path.join(TEMPLATE_DIR, 'skills');
  let skillsCopied = 0;
  for (const entry of fs.readdirSync(srcSkills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    copyDirRecursive(path.join(srcSkills, entry.name), path.join(skillsDir, entry.name));
    skillsCopied++;
  }

  return { agentsWritten, skillsCopied, claudeDir };
}
