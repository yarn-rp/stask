/**
 * lib/setup/skills.mjs — Install skills per agent role.
 *
 * Three types of skills:
 *   A. stask-specific (symlinked from stask package)
 *   B. Core role skills (installed via each skill's install_cmd)
 *   C. Cross-agent symlinks (shared from lead workspace)
 *
 * Skill entries in manifests can be either:
 *   - a plain string: `"agentic-coding"` — resolved from shared locations
 *     (~/.claude/skills, ~/.agents/skills, etc.). No install fallback.
 *   - an object: `{ "name": "qa-patrol",
 *                   "install_cmd": "npx skills add https://github.com/tahseen137/qa-patrol --skill qa-patrol -g" }`
 *     If shared-location lookup misses, `install_cmd` runs via the shell to
 *     fetch the skill. It should install globally (to ~/.claude/skills) so
 *     future roles + re-runs find it without re-downloading.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STASK_SKILLS_DIR = path.resolve(__dirname, '../../skills');

/**
 * Normalize a skill list entry. Accepts either a string or
 * { name, install_cmd? }. Returns { name, install_cmd? } or null on malformed.
 */
function normalizeSkillItem(item) {
  if (typeof item === 'string') return { name: item };
  if (item && typeof item === 'object' && typeof item.name === 'string') {
    return { name: item.name, install_cmd: item.install_cmd || null };
  }
  return null;
}

function normalizeList(list) {
  return (list || []).map(normalizeSkillItem).filter(Boolean);
}

// ─── Skill definitions ──────────────────────────────────────────
// Skills are now defined in manifest.json files (per-agent + team).
// These constants are kept ONLY as fallbacks when no manifest is provided.

const FALLBACK_UNIVERSAL = ['find-skills', 'actual-self-improvement', 'vassili-clawhub-cli'];

const FALLBACK_ROLE_SKILLS = {
  lead: ['gsd', 'planning-files', 'requirements-analysis', 'technical-spec-design', 'code-review', 'critical-code-reviewer', 'security-auditor', 'agent-team-orchestration', 'agent-orchestration-multi-agent-optimize', 'agentic-workflow-automation', 'pre-mortem-analyst', 'feature-specification'],
  backend: ['agentic-coding', 'code-review', 'security-auditor', 'api-dev', 'api-security-audit', 'database-migrations', 'sql-toolkit', 'debug-pro', 'docker-essentials', 'fullstack-conventions', 'pull-request', 'feature-specification', 'technical-spec-design'],
  frontend: ['agentic-coding', 'code-review', 'feature-specification', 'technical-spec-design', 'react-expert', 'nextjs-expert', 'shadcn-ui', 'tailwind-v4-shadcn', 'figma-integration'],
  qa: ['qa-patrol', 'playwright-pro', 'e2e-testing-patterns', 'afrexai-qa-test-plan', 'openclaw-api-tester', 'feature-specification', 'technical-spec-design'],
};

const FALLBACK_STASK_SKILLS = {
  lead: ['stask-general', 'stask-lead', 'stask-coding'],
  backend: ['stask-general', 'stask-worker', 'stask-coding'],
  frontend: ['stask-general', 'stask-worker', 'stask-coding'],
  qa: ['stask-general', 'stask-qa', 'stask-coding'],
};

/**
 * Get skill lists for a role from manifests (with fallbacks). All returned
 * lists are normalized to `{name, install_cmd?}` objects regardless of the
 * raw manifest form (string or object).
 */
function getSkillLists(role, manifests) {
  if (manifests?.teamManifest && manifests?.agentManifests?.[role]) {
    const agentM = manifests.agentManifests[role];
    return {
      universal: normalizeList(manifests.teamManifest.skills?.universal),
      clawhub: normalizeList(agentM.skills?.clawhub),
      shareFromLead: normalizeList(agentM.skills?.shareFromLead),
      stask: normalizeList(agentM.skills?.stask),
    };
  }
  // Fallback to hardcoded (backward compat for --only mode without manifests)
  return {
    universal: normalizeList(FALLBACK_UNIVERSAL),
    clawhub: normalizeList(FALLBACK_ROLE_SKILLS[role] || []),
    shareFromLead: [],
    stask: normalizeList(FALLBACK_STASK_SKILLS[role] || []),
  };
}

/**
 * Install all skills for a specific agent.
 *
 * @param {Object} opts
 * @param {string} opts.agentName      — e.g. 'professor'
 * @param {string} opts.role           — 'lead' | 'backend' | 'frontend' | 'qa'
 * @param {string} opts.workspacePath  — e.g. ~/.openclaw/workspace-<project>/<agent>
 * @param {string} opts.leadWorkspace  — Lead agent's workspace path (for cross-agent symlinks)
 * @param {Function} opts.onProgress   — Callback for progress updates: (msg) => void
 * @returns {{ installed: string[], symlinked: string[], failed: string[] }}
 */
export async function installSkillsForAgent({ agentName, role, workspacePath, leadWorkspace, onProgress, manifests }) {
  const skillsDir = path.join(workspacePath, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const installed = [];
  const symlinked = [];
  const failed = [];

  const log = onProgress || (() => {});

  // Test/sandbox short-circuit: skip clawhub skill installs entirely.
  // Used by the QA sandbox so seed generation doesn't pull hundreds of MB
  // of skills over the network. Stask-specific skills still symlink below.
  if (process.env.STASK_SKIP_SKILLS_INSTALL) {
    const lists = getSkillLists(role, manifests);
    for (const { name } of lists.stask) {
      const src = path.join(STASK_SKILLS_DIR, name);
      const dest = path.join(skillsDir, name);
      if (fs.existsSync(dest)) { symlinked.push(name); continue; }
      if (fs.existsSync(src)) {
        try { fs.symlinkSync(src, dest, 'dir'); symlinked.push(name); }
        catch { failed.push(name); }
      }
    }
    return { installed, symlinked, failed };
  }

  const lists = getSkillLists(role, manifests);

  // A. stask-specific skills (symlink from stask package)
  for (const { name } of lists.stask) {
    const src = path.join(STASK_SKILLS_DIR, name);
    const dest = path.join(skillsDir, name);
    if (fs.existsSync(dest)) { symlinked.push(name); continue; }
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, dest, 'dir');
        symlinked.push(name);
      } catch {
        failed.push(name);
      }
    } else {
      failed.push(name);
    }
  }

  // B. Determine which clawhub/universal skills need resolution (not already in this workspace)
  const clawHubSkills = [...lists.universal, ...lists.clawhub];
  const skillsToResolve = [];
  const skillsToSymlinkFromLead = [...lists.shareFromLead];

  for (const item of clawHubSkills) {
    const dest = path.join(skillsDir, item.name);
    if (fs.existsSync(dest)) { installed.push(item.name); continue; }
    skillsToResolve.push(item);
  }

  // C. Cross-agent symlinks (from lead's workspace) — try symlink first, fall
  // through to resolve if the lead doesn't have it
  for (const item of skillsToSymlinkFromLead) {
    const src = path.join(leadWorkspace, 'skills', item.name);
    const dest = path.join(skillsDir, item.name);
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, dest, 'dir');
        symlinked.push(item.name);
        continue;
      } catch { /* fall through to resolve */ }
    }
    skillsToResolve.push(item);
  }

  // D. Resolve each skill: shared-location symlink first, else run install_cmd
  for (let i = 0; i < skillsToResolve.length; i++) {
    const { name, install_cmd } = skillsToResolve[i];
    log(`${agentName}: ${name} (${i + 1}/${skillsToResolve.length})`);

    if (resolveFromSharedLocations(name, skillsDir, symlinked)) continue;

    if (install_cmd) {
      // Run the manifest-declared install command; then re-check shared locations
      // (the cmd should have landed the skill globally somewhere we look).
      const ok = runInstallCmd(install_cmd, workspacePath);
      if (ok && resolveFromSharedLocations(name, skillsDir, symlinked)) {
        installed.push(name);
        continue;
      }
    }

    failed.push(name);
  }

  return { installed, symlinked, failed };
}

/**
 * Try to symlink a skill into skillsDir from any known shared location.
 * Returns true on success, pushes the skill name into `symlinked`.
 */
function resolveFromSharedLocations(skillName, skillsDir, symlinked) {
  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.claude', 'skills', skillName),
    path.join(home, '.agents', 'skills', skillName),
    path.join(home, '.openclaw', 'skills', skillName),
    ...findSkillInWorkspaces(home, skillName),
  ];
  for (const loc of candidates) {
    if (!fs.existsSync(loc)) continue;
    const dest = path.join(skillsDir, skillName);
    if (fs.existsSync(dest)) { symlinked.push(skillName); return true; }
    try {
      fs.symlinkSync(loc, dest, 'dir');
      symlinked.push(skillName);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

/**
 * Run a manifest-declared install command. These strings come from stask's
 * own templated manifests (not user input), so shelling them out is acceptable.
 * Returns true if the command exited 0.
 */
function runInstallCmd(cmd, cwd) {
  try {
    execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' }, // suppress interactive prompts where possible
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Search existing OpenClaw workspaces for a skill directory.
 * Returns an array of paths where the skill was found.
 */
function findSkillInWorkspaces(home, skillName) {
  const openclawDir = path.join(home, '.openclaw');
  const results = [];
  try {
    const entries = fs.readdirSync(openclawDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('workspace')) continue;
      const wsDir = path.join(openclawDir, entry.name);
      // Search agent subdirectories within each workspace
      try {
        const agents = fs.readdirSync(wsDir, { withFileTypes: true });
        for (const agent of agents) {
          if (!agent.isDirectory() || agent.name === 'shared' || agent.name.startsWith('.')) continue;
          const skillPath = path.join(wsDir, agent.name, 'skills', skillName);
          if (fs.existsSync(skillPath)) {
            results.push(skillPath);
          }
        }
      } catch { /* workspace not readable */ }
    }
  } catch { /* .openclaw not readable */ }
  return results;
}

/**
 * Get the total skill count for a role.
 */
export function getSkillCount(role, manifests) {
  const lists = getSkillLists(role, manifests);
  // Lists are arrays of {name, install_cmd?} — count is just array length.
  return lists.universal.length + lists.clawhub.length + lists.shareFromLead.length + lists.stask.length;
}
