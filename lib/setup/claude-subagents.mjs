/**
 * lib/setup/claude-subagents.mjs — Scaffold Claude Code subagent + skill files
 * into <repoPath>/.claude/ so coding sessions opened via `claude --agent <name>`
 * preload the role playbook at startup.
 *
 * One agent file per configured stask agent (using the agent's actual name).
 * Each agent preloads its role's coding skills (universal + clawhub from the
 * manifest) — e.g. agentic-coding, code-review, react-expert, qa-patrol.
 *
 * The stask-* skills (stask-lead, stask-worker, stask-qa, stask-general)
 * describe the OpenClaw outer-agent lifecycle (heartbeat, transitions, Slack
 * sync) and stay in the OpenClaw workspace only — the Claude coding session
 * does not need them.
 *
 * Skill contents are copied (not symlinked) from the agent's OpenClaw
 * workspace so `.claude/` is self-contained and travels with task worktrees.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates/claude');

const ROLE_TITLES = {
  lead: 'Team Lead',
  backend: 'Backend Engineer',
  frontend: 'Frontend Engineer',
  qa: 'QA Engineer',
};

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function renderTemplate(tmpl, values) {
  let out = tmpl;
  for (const [k, v] of Object.entries(values)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/**
 * Copy a skill dir, dereferencing any symlinks so the repo gets the actual
 * content (skills in the workspace are often symlinks into ~/.claude/skills
 * or ~/.agents/skills).
 */
function copySkill(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true, force: true });
}

/**
 * Resolve the skill list for a role from manifests (mirrors skills.mjs).
 * Returns universal + clawhub skill names — the ones the Claude coding
 * session actually uses. stask-* skills are intentionally excluded.
 */
function getCodingSkillsForRole(roleId, manifests) {
  const team = manifests?.teamManifest;
  const agentM = manifests?.agentManifests?.[roleId];
  const universal = team?.skills?.universal || [];
  const clawhub = agentM?.skills?.clawhub || [];
  const shareFromLead = agentM?.skills?.shareFromLead || [];
  // De-dup while preserving order (universal first, then role-specific, then shared).
  const seen = new Set();
  const out = [];
  for (const s of [...universal, ...clawhub, ...shareFromLead]) {
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * Scaffold .claude/agents and .claude/skills directories into the repo.
 *
 * @param {Object} opts
 * @param {string} opts.repoPath       - Target repo (files land at <repoPath>/.claude/)
 * @param {string} opts.projectName
 * @param {string} opts.projectSlug
 * @param {string} opts.humanName
 * @param {string} opts.openclawHome   - e.g. ~/.openclaw
 * @param {Array<{name: string, roleId: string}>} opts.agents
 *        `roleId` is the manifest role (lead, backend, frontend, qa).
 *        `name` is the configured agent name (lowercase).
 * @param {Object} opts.manifests      - { teamManifest, agentManifests } from manifest.mjs
 * @returns {{ agentsWritten: number, skillsCopied: number, skillsMissing: string[], claudeDir: string }}
 */
export function scaffoldClaudeSubagents({ repoPath, projectName, projectSlug, humanName, openclawHome, agents, manifests }) {
  const claudeDir = path.join(repoPath, '.claude');
  const agentsDir = path.join(claudeDir, 'agents');
  const skillsDir = path.join(claudeDir, 'skills');

  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  const tmplPath = path.join(TEMPLATE_DIR, 'agents', 'agent.md.tmpl');
  const tmpl = fs.readFileSync(tmplPath, 'utf-8');

  const workspaceBase = path.join(openclawHome, `workspace-${projectSlug}`);

  // Copy union of all skills referenced by any configured agent so the repo
  // carries a single deduplicated skill set. Record any that were missing on
  // disk so the caller can surface the gap.
  const skillsMissing = new Set();
  const skillsAvailable = new Set(); // ends up in at least one agent's frontmatter

  let agentsWritten = 0;
  for (const { name, roleId } of agents) {
    const roleTitle = ROLE_TITLES[roleId] || 'Engineer';
    const skillList = getCodingSkillsForRole(roleId, manifests);

    // Copy each skill from the agent's workspace into <repo>/.claude/skills/,
    // and track which ones actually landed so we only advertise real skills
    // in the agent's preload frontmatter.
    const workspaceSkillsDir = path.join(workspaceBase, name, 'skills');
    const presentSkills = [];
    for (const skill of skillList) {
      const dest = path.join(skillsDir, skill);
      if (fs.existsSync(dest)) {
        presentSkills.push(skill);
        skillsAvailable.add(skill);
        continue;
      }
      const src = path.join(workspaceSkillsDir, skill);
      if (fs.existsSync(src)) {
        try {
          copySkill(src, dest);
          presentSkills.push(skill);
          skillsAvailable.add(skill);
        } catch (err) {
          skillsMissing.add(`${skill} (copy failed: ${err.message})`);
        }
      } else {
        skillsMissing.add(skill);
      }
    }

    // Render the agent file with only the skills that actually landed on disk.
    // Listing missing skills in `skills:` frontmatter would tell Claude Code
    // to preload files that don't exist.
    const skillsYaml = presentSkills.map((s) => `  - ${s}`).join('\n');
    const rendered = renderTemplate(tmpl, {
      AGENT_NAME: capitalize(name),
      AGENT_NAME_LOWER: name,
      ROLE_TITLE: roleTitle,
      PROJECT_NAME: projectName,
      PROJECT_SLUG: projectSlug,
      HUMAN_NAME: humanName || 'your human teammate',
      SKILLS_YAML: skillsYaml,
    });
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), rendered);
    agentsWritten++;
  }

  return {
    agentsWritten,
    skillsCopied: skillsAvailable.size,
    skillsMissing: [...skillsMissing],
    claudeDir,
  };
}
