/**
 * stask init — Create a new stask project.
 *
 * Usage: stask init <project-name> --repo <path> [--worktrees <path>] [--specs <path>]
 *
 * Creates .stask/ in the target repo with scaffolded config.json and .gitignore.
 * Registers the project in ~/.stask/projects.json.
 */

import fs from 'fs';
import path from 'path';
import { loadProjectsRegistry, saveProjectsRegistry, GLOBAL_STASK_DIR } from '../lib/resolve-home.mjs';
import { appendToExclude } from '../lib/setup/git-exclude.mjs';

function parseArgs(args) {
  const name = args[0];
  if (!name || name.startsWith('--')) {
    return null;
  }
  const opts = { name, repos: [] };
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const val = args[i + 1];
    if (!val) break;
    // --repo can be passed multiple times for multi-repo projects.
    // The first --repo is the host (where .stask/ lives); additional
    // --repos are paired alongside.
    if (flag === '--repo') opts.repos.push(val);
    else if (flag === '--worktrees') opts.worktrees = val;
    else if (flag === '--specs') opts.specs = val;
    else if (flag === '--base-branch') opts.baseBranch = val;
    else if (flag === '--jira-key') opts.jiraKey = val;
  }
  // First --repo wins as `repo` for back-compat with callers that read
  // a single repo path.
  if (opts.repos.length > 0) opts.repo = opts.repos[0];
  return opts;
}

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
 * by appending them to `.git/info/exclude`. Called from both `init` and
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
 * Programmatic init — called by setup.mjs with pre-configured options.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.repoPath  - Host repo (where .stask/ lives). For
 *   single-repo projects this is the only repo. For multi-repo projects,
 *   pass `extraRepoPaths` for the additional ones.
 * @param {string[]} [opts.extraRepoPaths]
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

export async function run(args) {
  const opts = parseArgs(args);
  if (!opts || opts.repos.length === 0) {
    console.error('Usage: stask init <project-name> --repo <path> [--repo <path>]... [--worktrees <path>] [--specs <path>] [--base-branch <branch>] [--jira-key <KEY>]');
    console.error('  Pass --repo multiple times for multi-repo projects. The first --repo hosts .stask/.');
    process.exit(1);
  }

  const allRepoPaths = opts.repos.map((p) => path.resolve(p));
  const [hostRepoPath, ...extraRepoPaths] = allRepoPaths;
  for (const p of allRepoPaths) {
    if (!fs.existsSync(p)) {
      console.error(`ERROR: Repo path does not exist: ${p}`);
      process.exit(1);
    }
  }

  const staskDir = path.join(hostRepoPath, '.stask');
  if (fs.existsSync(path.join(staskDir, 'config.json'))) {
    console.error(`ERROR: Project already initialized at ${staskDir}`);
    console.error('Delete .stask/config.json first if you want to re-initialize.');
    process.exit(1);
  }

  const specsDir = opts.specs || './specs';
  const worktreeBaseDir = opts.worktrees || path.join(GLOBAL_STASK_DIR, 'worktrees', opts.name);

  fs.mkdirSync(staskDir, { recursive: true });

  const repos = allRepoPaths.map((p) => ({ path: p }));
  const config = CONFIG_TEMPLATE(opts.name, specsDir, worktreeBaseDir, undefined, {
    repos,
    baseBranch: opts.baseBranch || 'main',
    jira: opts.jiraKey ? { projectKey: opts.jiraKey } : undefined,
  });
  fs.writeFileSync(
    path.join(staskDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );

  fs.writeFileSync(path.join(staskDir, '.gitignore'), GITIGNORE_CONTENT);

  applyGitExcludes(allRepoPaths);

  const registry = loadProjectsRegistry();
  registry.projects = registry.projects || {};
  registry.projects[opts.name] = { repoPath: hostRepoPath };
  saveProjectsRegistry(registry);

  console.log(`Project "${opts.name}" initialized.`);
  console.log('');
  console.log(`  Config:    ${path.join(staskDir, 'config.json')}`);
  console.log(`  Registry:  ${path.join(GLOBAL_STASK_DIR, 'projects.json')}`);
  console.log(`  Repos:     ${allRepoPaths.length}`);
  for (const p of allRepoPaths) console.log(`               ${p}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit .stask/config.json — fill in agents, Slack list/column IDs, human info');
  console.log('  2. Set SLACK_TOKEN env var or add to ~/.stask/config.json');
  if (opts.jiraKey) console.log('  3. Ensure `jira` CLI is installed and `jira init` has been run');
  console.log(`  ${opts.jiraKey ? '4' : '3'}. Run: cd ${hostRepoPath} && stask list`);
}
