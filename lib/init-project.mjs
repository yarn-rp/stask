/**
 * lib/init-project.mjs — Programmatic project scaffolding.
 *
 * This module contains the `initProject()` function that was formerly in
 * `commands/init.mjs`. It is used by `commands/setup.mjs` (and its shared
 * step helpers in `lib/setup/steps.mjs`) to scaffold `.stask/` in the
 * project home directory and register the project in `~/.stask/projects.json`.
 *
 * The `stask init` CLI command has been removed. Use `stask setup` instead.
 *
 * Model:
 *   project-home/   ← .stask/ lives here. This IS the project root.
 *     .stask/
 *     repo1/        ← git repo, push target only
 *     repo2/        ← git repo, push target only
 */

import fs from 'fs';
import path from 'path';
import { loadProjectsRegistry, saveProjectsRegistry, GLOBAL_STASK_DIR } from './resolve-home.mjs';
import { appendToExclude } from './setup/git-exclude.mjs';

const CONFIG_TEMPLATE = (name, specsDir, worktreeBaseDir, staskDefaults, extras = {}) => ({
  project: name,
  specsDir,
  repos: extras.repos || [{ path: '.' }],
  baseBranch: extras.baseBranch || 'main',
  worktreeBaseDir,
  ...(extras.jira ? { jira: extras.jira } : {}),
  staleSessionMinutes: staskDefaults?.staleSessionMinutes ?? 30,
  syncIntervalSeconds: staskDefaults?.syncIntervalSeconds ?? 60,
  maxQaRetries: staskDefaults?.maxQaRetries ?? 3,

  coding: {
    backend: 'claude',
  },

  human: {
    name: 'YourName',
    slackUserId: 'UXXXXXXXXXX',
    githubUsername: 'your-github-username',
  },

  agents: {
    'lead-agent':  { role: 'lead',   slackUserId: 'UXXXXXXXXXX' },
    'worker-1':    { role: 'worker', slackUserId: 'UXXXXXXXXXX' },
    'worker-2':    { role: 'worker', slackUserId: 'UXXXXXXXXXX' },
    'qa-agent':    { role: 'qa',     slackUserId: 'UXXXXXXXXXX' },
  },

  slack: {
    listId: 'YOUR_SLACK_LIST_ID',
    columns: {
      name: 'ColXXXXXXXXX',
      task_id: 'ColXXXXXXXXX',
      status: 'ColXXXXXXXXX',
      assignee: 'ColXX',
      spec: 'ColXXXXXXXXX',
      type: 'ColXXXXXXXXX',
      worktree: 'ColXXXXXXXXX',
      pr: 'ColXXXXXXXXX',
      qa_report_1: 'ColXXXXXXXXX',
      qa_report_2: 'ColXXXXXXXXX',
      qa_report_3: 'ColXXXXXXXXX',
      completed: 'ColXX',
      spec_approved: 'ColXXXXXXXXX',
      pr_status: 'ColXXXXXXXXX',
    },
    statusOptions: {
      'To-Do': 'OptXXXXXXXXX',
      'In-Progress': 'OptXXXXXXXXX',
      'Testing': 'OptXXXXXXXXX',
      'Ready for Human Review': 'OptXXXXXXXXX',
      'Blocked': 'OptXXXXXXXXX',
      'Done': 'OptXXXXXXXXX',
    },
    typeOptions: {
      Feature: 'OptXXXXXXXXX',
      Bug: 'OptXXXXXXXXX',
      Improvement: 'OptXXXXXXXXX',
      Research: 'OptXXXXXXXXX',
    },
  },
});

/**
 * Convert an absolute repo path to a relative path from projectHome.
 * Always prefixes with "./" for canonical form.
 */
function toRelativePath(projectHome, absRepoPath) {
  const rel = path.relative(projectHome, absRepoPath);
  // If rel starts with ".." the repo is outside projectHome — keep absolute
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return absRepoPath;
  }
  // Canonicalize: always start with "./"
  return rel.startsWith('.') ? rel : './' + rel;
}

/**
 * Programmatic project init — called by setup.mjs with pre-configured options.
 *
 * New shape:
 * @param {object} opts
 * @param {string} opts.projectHome  - The project home directory. .stask/ is
 *   written here. NOT required to be a git repo. This is the parent folder
 *   that contains the child git repos.
 * @param {string[]} [opts.repos]   - Array of absolute paths to the repos
 *   (git push targets). Stored relative to projectHome in config.json.
 * @param {string}  [opts.name]     - Project name/slug.
 * @param {object}  [opts.configOverrides]
 * @param {object}  [opts.staskDefaults]
 * @param {string}  [opts.baseBranch]
 * @param {object}  [opts.jira]     - e.g. { projectKey: 'ACME' }
 *
 * Legacy shape (back-compat — treated as projectHome with one repo):
 * @param {string} [opts.repoPath]       - Legacy: treated as projectHome
 * @param {string[]} [opts.extraRepoPaths] - Legacy: additional repos
 */
export function initProject({ name, projectHome, repos, repoPath, extraRepoPaths = [], configOverrides, staskDefaults, baseBranch, jira }) {
  // Legacy back-compat: repoPath used as projectHome when projectHome not provided
  const home = projectHome || repoPath;
  if (!home) throw new Error('initProject requires projectHome (or legacy repoPath)');

  const staskDir = path.join(home, '.stask');
  const specsDir = './specs';
  const worktreeBaseDir = path.join(GLOBAL_STASK_DIR, 'worktrees', name);

  fs.mkdirSync(staskDir, { recursive: true });

  // Build the repos list with paths relative to projectHome
  let allAbsRepoPaths;
  if (repos && repos.length > 0) {
    // New shape: explicit repos array (absolute paths)
    allAbsRepoPaths = repos.map((p) => path.resolve(p));
  } else if (repoPath) {
    // Legacy shape: repoPath + extraRepoPaths
    allAbsRepoPaths = [path.resolve(repoPath), ...extraRepoPaths.map((p) => path.resolve(p))];
  } else {
    // No repos provided — treat projectHome itself as the only repo
    allAbsRepoPaths = [path.resolve(home)];
  }

  const repoEntries = allAbsRepoPaths.map((absPath) => ({
    path: toRelativePath(path.resolve(home), absPath),
  }));

  const config = CONFIG_TEMPLATE(name, specsDir, worktreeBaseDir, staskDefaults, {
    repos: repoEntries,
    baseBranch,
    jira,
  });
  if (configOverrides) Object.assign(config, configOverrides);
  fs.writeFileSync(path.join(staskDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  // Only apply git excludes if projectHome itself is a git repo (rare: monorepo wrapper)
  const homeGitDir = path.join(path.resolve(home), '.git');
  if (fs.existsSync(homeGitDir)) {
    try {
      appendToExclude(path.resolve(home), ['.stask/']);
    } catch (err) {
      console.warn(`WARN: Could not update .git/info/exclude in ${home}: ${err.message}`);
    }
  }
  // Do NOT write to .git/info/exclude in child repos — .stask/ is above them.
  // Do NOT write .stask/.gitignore — the parent folder is not a git repo.

  const registry = loadProjectsRegistry();
  registry.projects = registry.projects || {};
  registry.projects[name] = { projectHome: path.resolve(home) };
  saveProjectsRegistry(registry);
}
