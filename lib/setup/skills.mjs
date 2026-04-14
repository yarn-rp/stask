/**
 * lib/setup/skills.mjs — Install skills per agent role.
 *
 * Three types of skills:
 *   A. stask-specific (symlinked from stask package)
 *   B. Core role skills (installed via npx skills add)
 *   C. Cross-agent symlinks (shared from lead workspace)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STASK_SKILLS_DIR = path.resolve(__dirname, '../../skills');

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
  lead: ['stask-general', 'stask-lead'],
  backend: ['stask-general', 'stask-worker'],
  frontend: ['stask-general', 'stask-worker'],
  qa: ['stask-general', 'stask-qa'],
};

/**
 * Get skill lists for a role from manifests (with fallbacks).
 */
function getSkillLists(role, manifests) {
  if (manifests?.teamManifest && manifests?.agentManifests?.[role]) {
    const agentM = manifests.agentManifests[role];
    return {
      universal: manifests.teamManifest.skills?.universal || [],
      clawhub: agentM.skills?.clawhub || [],
      shareFromLead: agentM.skills?.shareFromLead || [],
      stask: agentM.skills?.stask || [],
    };
  }
  // Fallback to hardcoded (backward compat for --only mode without manifests)
  return {
    universal: FALLBACK_UNIVERSAL,
    clawhub: FALLBACK_ROLE_SKILLS[role] || [],
    shareFromLead: [],
    stask: FALLBACK_STASK_SKILLS[role] || [],
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
  const lists = getSkillLists(role, manifests);

  // A. stask-specific skills (symlink from stask package)
  for (const skill of lists.stask) {
    const src = path.join(STASK_SKILLS_DIR, skill);
    const dest = path.join(skillsDir, skill);
    if (fs.existsSync(dest)) { symlinked.push(skill); continue; }
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, dest, 'dir');
        symlinked.push(skill);
      } catch {
        failed.push(skill);
      }
    } else {
      failed.push(skill);
    }
  }

  // B. Determine which skills to install vs symlink from lead
  const clawHubSkills = [...lists.universal, ...lists.clawhub];
  const skillsToInstall = [];
  const skillsToSymlink = [...lists.shareFromLead]; // these always symlink from lead

  for (const skill of clawHubSkills) {
    const dest = path.join(skillsDir, skill);
    if (fs.existsSync(dest)) { installed.push(skill); continue; } // already exists
    skillsToInstall.push(skill);
  }

  // C. Cross-agent symlinks (from lead's workspace)
  for (const skill of skillsToSymlink) {
    const src = path.join(leadWorkspace, 'skills', skill);
    const dest = path.join(skillsDir, skill);
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, dest, 'dir');
        symlinked.push(skill);
      } catch {
        // If symlink fails, add to install list as fallback
        skillsToInstall.push(skill);
      }
    } else {
      // Lead hasn't installed it yet — install directly instead
      skillsToInstall.push(skill);
    }
  }

  // D. Install skills via npx skills add (one by one with progress)
  if (skillsToInstall.length > 0) {
    for (let i = 0; i < skillsToInstall.length; i++) {
      const skill = skillsToInstall[i];
      log(`${agentName}: ${skill} (${i + 1}/${skillsToInstall.length})`);

      // First try shared/known locations (instant — no network)
      const home = process.env.HOME || '';
      const sharedLocations = [
        path.join(home, '.claude', 'skills', skill),
        path.join(home, '.agents', 'skills', skill),
        path.join(home, '.openclaw', 'skills', skill),
        // Also search existing OpenClaw workspaces for skills (e.g. from other teams)
        ...findSkillInWorkspaces(home, skill),
      ];

      let found = false;
      for (const loc of sharedLocations) {
        if (fs.existsSync(loc)) {
          try {
            const dest = path.join(skillsDir, skill);
            if (!fs.existsSync(dest)) fs.symlinkSync(loc, dest, 'dir');
            symlinked.push(skill);
            found = true;
            break;
          } catch { /* continue to next location */ }
        }
      }

      if (found) continue;

      // Fall back to npx skills add (network)
      try {
        execFileSync('npx', ['skills', 'add', skill], {
          cwd: workspacePath,
          encoding: 'utf-8',
          timeout: 30000,
          stdio: 'pipe',
        });
        installed.push(skill);
      } catch {
        failed.push(skill);
      }
    }
  }

  return { installed, symlinked, failed };
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
  return lists.universal.length + lists.clawhub.length + lists.shareFromLead.length + lists.stask.length;
}
