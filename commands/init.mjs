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

function parseArgs(args) {
  const name = args[0];
  if (!name || name.startsWith('--')) {
    return null;
  }
  const opts = { name };
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const val = args[i + 1];
    if (!val) break;
    if (flag === '--repo') opts.repo = val;
    else if (flag === '--worktrees') opts.worktrees = val;
    else if (flag === '--specs') opts.specs = val;
  }
  return opts;
}

const CONFIG_TEMPLATE = (name, specsDir, worktreeBaseDir, staskDefaults) => ({
  project: name,
  specsDir,
  projectRepoPath: '.',
  worktreeBaseDir,
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
 * Programmatic init — called by setup.mjs with pre-configured options.
 */
export function initProject({ name, repoPath, configOverrides, staskDefaults }) {
  const staskDir = path.join(repoPath, '.stask');
  const specsDir = './specs';
  const worktreeBaseDir = path.join(GLOBAL_STASK_DIR, 'worktrees', name);

  fs.mkdirSync(staskDir, { recursive: true });

  const config = CONFIG_TEMPLATE(name, specsDir, worktreeBaseDir, staskDefaults);
  if (configOverrides) Object.assign(config, configOverrides);
  fs.writeFileSync(path.join(staskDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  fs.writeFileSync(path.join(staskDir, '.gitignore'), GITIGNORE_CONTENT);

  const registry = loadProjectsRegistry();
  registry.projects = registry.projects || {};
  registry.projects[name] = { repoPath };
  saveProjectsRegistry(registry);
}

export async function run(args) {
  const opts = parseArgs(args);
  if (!opts || !opts.repo) {
    console.error('Usage: stask init <project-name> --repo <path> [--worktrees <path>] [--specs <path>]');
    process.exit(1);
  }

  const repoPath = path.resolve(opts.repo);
  if (!fs.existsSync(repoPath)) {
    console.error(`ERROR: Repo path does not exist: ${repoPath}`);
    process.exit(1);
  }

  const staskDir = path.join(repoPath, '.stask');
  if (fs.existsSync(path.join(staskDir, 'config.json'))) {
    console.error(`ERROR: Project already initialized at ${staskDir}`);
    console.error('Delete .stask/config.json first if you want to re-initialize.');
    process.exit(1);
  }

  const specsDir = opts.specs || './specs';
  const worktreeBaseDir = opts.worktrees || path.join(GLOBAL_STASK_DIR, 'worktrees', opts.name);

  // Create .stask/ directory
  fs.mkdirSync(staskDir, { recursive: true });

  // Write config.json
  const config = CONFIG_TEMPLATE(opts.name, specsDir, worktreeBaseDir);
  fs.writeFileSync(
    path.join(staskDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );

  // Write .gitignore
  fs.writeFileSync(path.join(staskDir, '.gitignore'), GITIGNORE_CONTENT);

  // Register in global projects.json
  const registry = loadProjectsRegistry();
  registry.projects = registry.projects || {};
  registry.projects[opts.name] = { repoPath };
  saveProjectsRegistry(registry);

  console.log(`Project "${opts.name}" initialized.`);
  console.log('');
  console.log(`  Config:   ${path.join(staskDir, 'config.json')}`);
  console.log(`  Registry: ${path.join(GLOBAL_STASK_DIR, 'projects.json')}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit .stask/config.json — fill in agents, Slack list/column IDs, human info');
  console.log('  2. Set SLACK_TOKEN env var or add to ~/.stask/config.json');
  console.log(`  3. Run: cd ${repoPath} && stask list`);
}
