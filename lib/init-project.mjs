/**
 * lib/init-project.mjs — Programmatic project scaffolding.
 *
 * This module contains the `initProject()` function that was formerly in
 * `commands/init.mjs`. It is used by `commands/setup.mjs` (and its shared
 * step helpers in `lib/setup/steps.mjs`) to scaffold `.stask/` in one or
 * more repos and register the project in `~/.stask/projects.json`.
 *
 * The `stask init` CLI command has been removed. Use `stask setup` instead.
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

const GITIGNORE_CONTENT = `# stask runtime data (do not commit)
tracker.db
tracker.db-wal
tracker.db-shm
FILE_REGISTRY.json
logs/
pr-status/
`;

/**
 * Hide stask's per-clone artifacts from each work repo's `git status`
 * by appending them to `.git/info/exclude`. Called from both `initProject` and
 * `setup`. Idempotent.
 */
function applyGitExcludes(repos) {
  const patterns = ['.stask/'];
  for (const r of repos) {
    try {
      appendToExclude(r.path || r, patterns);
    } catch (err) {
      console.warn(`WARN: Could not update .git/info/exclude in ${r.path || r}: ${err.message}`);
    }
  }
}

/**
 * Programmatic project init — called by setup.mjs with pre-configured options.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.repoPath  - Host repo (where .stask/ lives). For
 *   single-repo projects this is the only repo. For multi-repo projects,
 *   pass `extraRepoPaths` for the additional ones.
 * @param {string[]} [opts.extraRepoPaths]
 * @param {object}  [opts.configOverrides]
 * @param {object}  [opts.staskDefaults]
 * @param {string}  [opts.baseBranch]
 * @param {object}  [opts.jira]  - e.g. { projectKey: 'ACME' }
 */
export function initProject({ name, repoPath, extraRepoPaths = [], configOverrides, staskDefaults, baseBranch, jira }) {
  const staskDir = path.join(repoPath, '.stask');
  const specsDir = './specs';
  const worktreeBaseDir = path.join(GLOBAL_STASK_DIR, 'worktrees', name);

  fs.mkdirSync(staskDir, { recursive: true });

  const allRepoPaths = [repoPath, ...extraRepoPaths.map((p) => path.resolve(p))];
  const repos = allRepoPaths.map((p) => ({ path: p }));

  const config = CONFIG_TEMPLATE(name, specsDir, worktreeBaseDir, staskDefaults, {
    repos,
    baseBranch,
    jira,
  });
  if (configOverrides) Object.assign(config, configOverrides);
  fs.writeFileSync(path.join(staskDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  fs.writeFileSync(path.join(staskDir, '.gitignore'), GITIGNORE_CONTENT);

  applyGitExcludes(allRepoPaths);

  const registry = loadProjectsRegistry();
  registry.projects = registry.projects || {};
  registry.projects[name] = { repoPath };
  saveProjectsRegistry(registry);
}
