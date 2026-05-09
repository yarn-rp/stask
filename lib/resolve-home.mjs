/**
 * resolve-home.mjs — Resolves the stask project root directory.
 *
 * Resolution order:
 *   1. --project <name> or STASK_PROJECT env var → look up ~/.stask/projects.json
 *   2. Walk up from cwd looking for .stask/config.json (crosses git boundaries)
 *   3. Fallback: check if cwd is under any registered project's projectHome
 *   4. No project found → helpful error listing registered projects, exit(1)
 *
 * Model: .stask/ lives in the project home (parent folder), NOT inside a git
 * repo. The walk-up does NOT stop at git boundaries — .stask/ is intentionally
 * above the git repo boundary.
 *
 * This module has ZERO dependencies on env.mjs or tracker-db.mjs to avoid circular imports.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const GLOBAL_STASK_DIR = path.join(os.homedir(), '.stask');
const REGISTRY_PATH = path.join(GLOBAL_STASK_DIR, 'projects.json');
const CENTRAL_CONFIG_PATH = path.join(GLOBAL_STASK_DIR, 'config.json');

// ─── Projects registry ───────────────────────────────────────────

export function registryPath() {
  return REGISTRY_PATH;
}

export function loadProjectsRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return { projects: {} };
  }
}

export function saveProjectsRegistry(registry) {
  fs.mkdirSync(GLOBAL_STASK_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

// ─── Central config (secrets) ─────────────────────────────────────

export function loadCentralConfig() {
  try {
    return JSON.parse(fs.readFileSync(CENTRAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// ─── Resolve SLACK_TOKEN ──────────────────────────────────────────

/**
 * Resolve Slack token with layered precedence:
 *   1. SLACK_TOKEN env var
 *   2. Central config → projects.<name>.slackToken
 *   3. Central config → slackToken (global default)
 */
export function resolveSlackToken(projectName) {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;

  const central = loadCentralConfig();
  if (projectName && central.projects?.[projectName]?.slackToken) {
    return central.projects[projectName].slackToken;
  }
  if (central.slackToken) return central.slackToken;

  return null;
}

// ─── Project name from argv ───────────────────────────────────────

export function extractProjectFlag(argv) {
  const idx = argv.indexOf('--project');
  if (idx !== -1 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return process.env.STASK_PROJECT || null;
}

// ─── Walk up to find .stask/ ──────────────────────────────────────
// NOTE: This walk-up intentionally crosses git repo boundaries.
// .stask/ lives in the project home (parent folder), above any git repos.

function findStaskDir(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, '.stask', 'config.json');
    if (fs.existsSync(candidate)) {
      try {
        const config = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        // Only accept project configs (must have 'project' field).
        // Skips the central ~/.stask/config.json which only has slackToken.
        if (config.project) {
          return path.join(dir, '.stask');
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ─── Registry prefix lookup ───────────────────────────────────────
// Fallback: check if cwd is under any registered project's projectHome.
// This handles the case where walk-up finds nothing but the cwd is inside
// a child repo whose parent folder is a registered project home.

function findStaskDirByRegistry(cwd) {
  const registry = loadProjectsRegistry();
  const entries = Object.entries(registry.projects || {});
  if (entries.length === 0) return null;

  const resolvedCwd = path.resolve(cwd);

  for (const [, info] of entries) {
    // Support both new 'projectHome' field and legacy 'repoPath' field
    const home = info.projectHome || info.repoPath;
    if (!home) continue;
    const resolvedHome = path.resolve(home);

    // Check if cwd is at or under the registered project home
    if (resolvedCwd === resolvedHome || resolvedCwd.startsWith(resolvedHome + path.sep)) {
      const staskDir = path.join(resolvedHome, '.stask');
      const configPath = path.join(staskDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.project) return staskDir;
        } catch {}
      }
    }
  }
  return null;
}

// ─── Get project home from registry entry ────────────────────────
// Legacy compat: records with 'repoPath' and no 'projectHome' are treated
// as having the home at 'repoPath' (where .stask/ was written inside the repo).

export function getProjectHome(registryEntry) {
  if (!registryEntry) return null;
  return registryEntry.projectHome || registryEntry.repoPath || null;
}

// ─── Format registered projects for error messages ────────────────

function formatProjectList(registry) {
  const entries = Object.entries(registry.projects || {});
  if (entries.length === 0) return '  (none registered)';
  const maxName = Math.max(...entries.map(([n]) => n.length));
  return entries
    .map(([name, info]) => {
      const home = info.projectHome || info.repoPath || '(unknown)';
      return `  ${name.padEnd(maxName + 2)}${home}`;
    })
    .join('\n');
}

// ─── Main resolver ────────────────────────────────────────────────

let _resolved = null;

/**
 * Resolve the stask project root (.stask/ directory).
 * Returns an absolute path to the .stask/ folder.
 * Exits with helpful error if no project is found.
 */
export function resolveProjectRoot() {
  if (_resolved) return _resolved;

  // 0. STASK_HOME env var — direct override for CI, Docker, or explicit configuration
  if (process.env.STASK_HOME) {
    _resolved = process.env.STASK_HOME;
    return _resolved;
  }

  const projectName = extractProjectFlag(process.argv);

  // 1. Explicit --project flag or STASK_PROJECT env var
  if (projectName) {
    const registry = loadProjectsRegistry();
    const project = registry.projects?.[projectName];
    if (!project) {
      console.error(`ERROR: Unknown project "${projectName}".`);
      console.error('');
      console.error('Registered projects:');
      console.error(formatProjectList(registry));
      console.error('');
      console.error('Run `stask projects` to see all projects.');
      process.exit(1);
    }
    // Support both new 'projectHome' and legacy 'repoPath' fields
    const home = project.projectHome || project.repoPath;
    const staskDir = path.join(home, '.stask');
    if (!fs.existsSync(path.join(staskDir, 'config.json'))) {
      console.error(`ERROR: Project "${projectName}" is registered but .stask/config.json is missing at ${staskDir}.`);
      console.error('');
      console.error(`Run \`stask setup ${home}\` to re-scaffold.`);
      process.exit(1);
    }
    _resolved = staskDir;
    return _resolved;
  }

  // 2. Walk up from cwd (crosses git boundaries — .stask/ may be above git repos)
  const found = findStaskDir(process.cwd());
  if (found) {
    _resolved = found;
    return _resolved;
  }

  // 3. Fallback: registry prefix lookup — cwd may be inside a child repo
  // whose parent folder is a registered project home with .stask/ there.
  const registryFound = findStaskDirByRegistry(process.cwd());
  if (registryFound) {
    _resolved = registryFound;
    return _resolved;
  }

  // 4. No project found — helpful error
  const registry = loadProjectsRegistry();
  console.error('ERROR: No stask project found.');
  console.error('');
  console.error('No .stask/ folder found in the current directory or any parent.');
  console.error('');

  const entries = Object.entries(registry.projects || {});
  if (entries.length > 0) {
    console.error('Your registered projects:');
    console.error(formatProjectList(registry));
    console.error('');
    const firstHome = entries[0][1].projectHome || entries[0][1].repoPath;
    console.error('To work on a project:');
    console.error(`  cd ${firstHome}${' '.repeat(6)}# auto-detects .stask/`);
    console.error(`  stask --project ${entries[0][0]} <command>  # explicit project selection`);
  } else {
    console.error('No projects registered yet.');
  }
  console.error('');
  console.error('To create a new project:');
  console.error('  stask setup <path>');
  console.error('');
  console.error('Run `stask projects` to see all projects.');
  process.exit(1);
}

/**
 * Get the project name from the resolved .stask/config.json.
 */
export function resolveProjectName() {
  const staskDir = resolveProjectRoot();
  try {
    const config = JSON.parse(fs.readFileSync(path.join(staskDir, 'config.json'), 'utf-8'));
    return config.project || path.basename(path.dirname(staskDir));
  } catch {
    return path.basename(path.dirname(staskDir));
  }
}

export { GLOBAL_STASK_DIR };
