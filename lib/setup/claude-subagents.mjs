/**
 * lib/setup/claude-subagents.mjs — Scaffold Claude Code subagent + skill files
 * into <repoPath>/.claude/ so coding sessions opened via `claude --agent <name>`
 * preload the role playbook at startup.
 *
 * One agent file per configured stask agent (using the agent's actual name).
 * Each agent preloads:
 *   - The role's coding skills (universal + clawhub + shareFromLead from the
 *     role manifest) — e.g. agentic-coding, code-review, react-expert, qa-patrol.
 *   - The role's stask-* skills (from the role manifest's `stask` list) so the
 *     Claude session can close its own work via stask CLI — marking subtasks
 *     done, submitting QA verdicts, pinging sessions. The outer OpenClaw agent
 *     verifies state after Claude returns.
 *
 * Coding skills are sourced from the agent's OpenClaw workspace (populated by
 * stepSkills). stask-* skills are sourced directly from the stask package
 * (<stask>/skills/stask-*) since they ship with stask itself.
 *
 * Skill contents are copied (not symlinked) with symlinks dereferenced, so
 * `.claude/` is self-contained and travels with task worktrees.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates/claude');
const STASK_SKILLS_DIR = path.resolve(__dirname, '../../skills');

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
 *
 * Skip-if-exists by default — if the team already committed a skill of
 * the same name, theirs wins and we leave it alone. Pass `force: true`
 * for stask-* skills the team can't reasonably own.
 */
function copySkill(src, dest, { force = false } = {}) {
  if (!force && fs.existsSync(dest)) return false;
  fs.cpSync(src, dest, { recursive: true, dereference: true, force: true });
  return true;
}

const FORCE_OVERWRITE_PREFIXES = ['stask-'];

function shouldForceOverwrite(skillName) {
  return FORCE_OVERWRITE_PREFIXES.some((p) => skillName.startsWith(p));
}

/**
 * Resolve the skill list for a role from manifests (mirrors skills.mjs).
 * Returns universal + clawhub skill *names* — the ones the Claude coding
 * session actually uses. stask-* skills are intentionally excluded.
 *
 * Manifest entries may be strings or objects with `{name, install_cmd}`.
 * We only need the `name` here; the install side in skills.mjs has already
 * resolved the skill onto disk.
 */
function skillName(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof item.name === 'string') return item.name;
  return null;
}

function getCodingSkillsForRole(roleId, manifests) {
  const team = manifests?.teamManifest;
  const agentM = manifests?.agentManifests?.[roleId];
  const universal = (team?.skills?.universal || []).map(skillName).filter(Boolean);
  const clawhub = (agentM?.skills?.clawhub || []).map(skillName).filter(Boolean);
  const shareFromLead = (agentM?.skills?.shareFromLead || []).map(skillName).filter(Boolean);
  // De-dup while preserving order (universal first, then role-specific, then shared).
  const seen = new Set();
  const out = [];
  for (const s of [...universal, ...clawhub, ...shareFromLead]) {
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * stask skills that are outer-agent-only and must NOT be preloaded into the
 * Claude coding session. `stask-coding` is the prompt-builder playbook the
 * OpenClaw agent uses to assemble the prompt passed to `claude -p` — Claude
 * itself doesn't need to read it.
 */
const STASK_SKILLS_OUTER_AGENT_ONLY = new Set(['stask-coding']);

/**
 * Stask lifecycle skills for a role that should be preloaded into the Claude
 * session. These let Claude close its own work via the stask CLI (e.g.
 * `stask subtask done`, `stask qa submit`). Sourced from <stask>/skills/stask-*.
 * Falls back to sensible defaults if the manifest doesn't declare them.
 * Outer-agent-only skills (STASK_SKILLS_OUTER_AGENT_ONLY) are filtered out.
 */
function getStaskSkillsForRole(roleId, manifests) {
  const agentM = manifests?.agentManifests?.[roleId];
  const declared = (agentM?.skills?.stask || []).map(skillName).filter(Boolean);
  const base = declared.length
    ? declared
    : roleId === 'lead' ? ['stask-general', 'stask-lead']
    : roleId === 'qa' ? ['stask-general', 'stask-qa']
    : ['stask-general', 'stask-worker'];
  return base.filter((s) => !STASK_SKILLS_OUTER_AGENT_ONLY.has(s));
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
 * @returns {{ agentsWritten: number, skillsCopied: number, skillsMissing: string[], skillsSkipped: string[], agentsSkipped: string[], writtenPaths: string[], claudeDir: string }}
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

  // Track everything we actually wrote so callers (e.g. setup/init) can
  // hand the list to git-exclude. Paths are relative to repoPath so they
  // can be appended to `.git/info/exclude` directly.
  const writtenRelPaths = new Set();

  // Copy union of all skills referenced by any configured agent so the repo
  // carries a single deduplicated skill set. Record any that were missing on
  // disk so the caller can surface the gap.
  const skillsMissing = new Set();
  const skillsAvailable = new Set(); // ends up in at least one agent's frontmatter
  const skillsSkipped = new Set();   // present on disk already (team-committed)
  const agentsSkipped = [];

  let agentsWritten = 0;
  for (const { name, roleId } of agents) {
    const roleTitle = ROLE_TITLES[roleId] || 'Engineer';
    const codingSkills = getCodingSkillsForRole(roleId, manifests);
    const staskSkills = getStaskSkillsForRole(roleId, manifests);

    const presentSkills = [];
    const workspaceSkillsDir = path.join(workspaceBase, name, 'skills');

    // 1. Copy stask-* skills from the stask package (these ship with stask
    // itself — authoritative source). These are owned by stask, so we
    // overwrite to keep them current; the team isn't expected to maintain
    // their own forks of stask-worker / stask-qa / etc.
    for (const skill of staskSkills) {
      const dest = path.join(skillsDir, skill);
      const src = path.join(STASK_SKILLS_DIR, skill);
      if (!fs.existsSync(src)) {
        skillsMissing.add(skill);
        continue;
      }
      try {
        copySkill(src, dest, { force: shouldForceOverwrite(skill) });
        presentSkills.push(skill);
        skillsAvailable.add(skill);
        writtenRelPaths.add(path.posix.join('.claude', 'skills', skill) + '/');
      } catch (err) {
        skillsMissing.add(`${skill} (copy failed: ${err.message})`);
      }
    }

    // 2. Copy coding skills (universal + clawhub + shareFromLead) from the
    // agent's OpenClaw workspace into <repo>/.claude/skills/. If the team
    // already committed a skill of the same name, theirs wins.
    for (const skill of codingSkills) {
      const dest = path.join(skillsDir, skill);
      if (fs.existsSync(dest)) {
        presentSkills.push(skill);
        skillsAvailable.add(skill);
        skillsSkipped.add(skill);  // honored an existing file
        continue;
      }
      const src = path.join(workspaceSkillsDir, skill);
      if (fs.existsSync(src)) {
        try {
          const wrote = copySkill(src, dest);
          if (wrote) {
            writtenRelPaths.add(path.posix.join('.claude', 'skills', skill) + '/');
          }
          presentSkills.push(skill);
          skillsAvailable.add(skill);
        } catch (err) {
          skillsMissing.add(`${skill} (copy failed: ${err.message})`);
        }
      } else {
        skillsMissing.add(skill);
      }
    }

    // Render the agent file. Skip-if-exists so a team-committed agent
    // file with the same name wins — log a warning so the user knows
    // their agent definition didn't get the stask-flavored playbook.
    const agentRel = path.posix.join('.claude', 'agents', `${name}.md`);
    const agentDest = path.join(agentsDir, `${name}.md`);
    if (fs.existsSync(agentDest)) {
      console.warn(`WARN: ${agentRel} already exists; leaving it untouched. Stask agent playbook NOT applied for "${name}".`);
      agentsSkipped.push(name);
      continue;
    }

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
    fs.writeFileSync(agentDest, rendered);
    writtenRelPaths.add(agentRel);
    agentsWritten++;
  }

  return {
    agentsWritten,
    skillsCopied: skillsAvailable.size,
    skillsMissing: [...skillsMissing],
    skillsSkipped: [...skillsSkipped],
    agentsSkipped,
    writtenPaths: [...writtenRelPaths],
    claudeDir,
  };
}
