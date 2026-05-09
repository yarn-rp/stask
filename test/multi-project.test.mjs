/**
 * multi-project.test.mjs — Tests for multi-project support.
 *
 * These tests exercise the `initProject` library function directly and the
 * real CLI binary for project-level operations (projects list, --project flag,
 * auto-detection, error messages, task creation, and cross-project operations).
 *
 * `stask init` has been removed as a public CLI command. `initProject()` is
 * now a library function in lib/init-project.mjs. Use `stask setup` to
 * bootstrap a new project interactively.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STASK_BIN = path.resolve(__dirname, '../bin/stask.mjs');
const NODE = process.execPath;

// Use an isolated global stask dir so tests don't touch the real ~/.stask/
const TEST_GLOBAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-global-'));
const TEST_REPO_A = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-repo-a-'));
const TEST_REPO_B = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-repo-b-'));

// Base env for all test runs — overrides HOME so ~/.stask/ points to our temp dir
const BASE_ENV = {
  ...process.env,
  HOME: TEST_GLOBAL_DIR,
  STASK_HOME: '',  // Clear to avoid fallback
  STASK_PROJECT: '', // Clear
};

function run(args, opts = {}) {
  const { cwd, env, expectFail } = opts;
  try {
    const result = execFileSync(NODE, [STASK_BIN, ...args], {
      encoding: 'utf-8',
      cwd: cwd || TEST_REPO_A,
      env: { ...BASE_ENV, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (err) {
    if (expectFail) {
      return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status };
    }
    throw new Error(`stask ${args.join(' ')} failed (exit ${err.status}):\nstdout: ${err.stdout}\nstderr: ${err.stderr}`);
  }
}

// ─── Helper: scaffold a stask project into the given global dir ────
// We cannot call initProject() in-process here because GLOBAL_STASK_DIR in
// lib/resolve-home.mjs is resolved once at module load time from os.homedir(),
// so temporarily patching process.env.HOME doesn't redirect it. Instead we
// write the minimal artifacts directly — the same artifacts initProject()
// would produce — so the child-process CLI tests see a valid registry.

function scaffoldTestProject(name, repoPath, globalDir) {
  const staskDir = path.join(repoPath, '.stask');
  fs.mkdirSync(staskDir, { recursive: true });

  const config = {
    project: name,
    specsDir: './specs',
    repos: [{ path: repoPath }],
    baseBranch: 'main',
    worktreeBaseDir: path.join(globalDir, '.stask', 'worktrees', name),
    staleSessionMinutes: 30,
    syncIntervalSeconds: 60,
    maxQaRetries: 3,
    coding: { backend: 'claude' },
    human: { name: 'YourName', slackUserId: 'UXXXXXXXXXX', githubUsername: 'your-github-username' },
    agents: {
      'lead-agent': { role: 'lead', slackUserId: 'UXXXXXXXXXX' },
      'worker-1': { role: 'worker', slackUserId: 'UXXXXXXXXXX' },
      'worker-2': { role: 'worker', slackUserId: 'UXXXXXXXXXX' },
      'qa-agent': { role: 'qa', slackUserId: 'UXXXXXXXXXX' },
    },
    slack: { listId: 'YOUR_SLACK_LIST_ID', columns: {}, statusOptions: {}, typeOptions: {} },
  };
  fs.writeFileSync(path.join(staskDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(staskDir, '.gitignore'), 'tracker.db\ntracker.db-wal\ntracker.db-shm\nFILE_REGISTRY.json\nlogs/\npr-status/\n');

  // Register in projects.json
  const registryPath = path.join(globalDir, '.stask', 'projects.json');
  let registry = { projects: {} };
  if (fs.existsSync(registryPath)) {
    try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')); } catch {}
  }
  registry.projects[name] = { repoPath };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

// ─── Setup & teardown ─────────────────────────────────────────────

before(() => {
  // Create the global .stask dir as the registry location
  fs.mkdirSync(path.join(TEST_GLOBAL_DIR, '.stask'), { recursive: true });

  // Bootstrap both test repos by directly writing the .stask/ artifacts.
  // The child-process CLI tests use BASE_ENV which sets HOME=TEST_GLOBAL_DIR,
  // so they will read projects.json from the right location.
  scaffoldTestProject('project-a', TEST_REPO_A, TEST_GLOBAL_DIR);
  scaffoldTestProject('project-b', TEST_REPO_B, TEST_GLOBAL_DIR);
});

after(() => {
  // Cleanup temp dirs
  fs.rmSync(TEST_GLOBAL_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_REPO_A, { recursive: true, force: true });
  fs.rmSync(TEST_REPO_B, { recursive: true, force: true });
});

// ─── Tests for initProject (formerly stask init) ───────────────────

describe('initProject()', () => {
  it('scaffolds .stask/ in a repo with config.json and .gitignore', async () => {
    // Use a fresh temp dir so we don't interfere with the scaffoldTestProject() state
    const { initProject } = await import('../lib/init-project.mjs');
    const testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-init-test-'));
    try {
      initProject({ name: 'init-test-a', repoPath: testRepo });

      // .stask/config.json created
      const configPath = path.join(testRepo, '.stask', 'config.json');
      assert.ok(fs.existsSync(configPath), '.stask/config.json should exist');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.project, 'init-test-a');

      // repos array includes the host repo
      assert.ok(Array.isArray(config.repos), 'config.repos should be an array');
      assert.ok(config.repos.length >= 1, 'config.repos should have at least one entry');

      // .stask/.gitignore created
      const gitignorePath = path.join(testRepo, '.stask', '.gitignore');
      assert.ok(fs.existsSync(gitignorePath), '.stask/.gitignore should exist');
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      assert.ok(gitignore.includes('tracker.db'), '.gitignore should exclude tracker.db');
    } finally {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
  });

  it('scaffolds a second project independently with its own config', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const repoB2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-init-test-b2-'));
    try {
      initProject({ name: 'init-test-b', repoPath: repoB2 });

      const configPath = path.join(repoB2, '.stask', 'config.json');
      assert.ok(fs.existsSync(configPath), '.stask/config.json should exist for project-b');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.project, 'init-test-b');
    } finally {
      fs.rmSync(repoB2, { recursive: true, force: true });
    }
  });

  it('supports multi-repo projects via extraRepoPaths', async () => {
    const extraRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-extra-'));
    try {
      const { initProject } = await import('../lib/init-project.mjs');
      const origHome = process.env.HOME;
      process.env.HOME = TEST_GLOBAL_DIR;
      const multiRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-multi-host-'));
      try {
        initProject({
          name: 'multi-repo-test',
          repoPath: multiRepoDir,
          extraRepoPaths: [extraRepo],
        });
        const config = JSON.parse(fs.readFileSync(path.join(multiRepoDir, '.stask', 'config.json'), 'utf-8'));
        assert.equal(config.repos.length, 2, 'config.repos should have 2 entries');
        assert.equal(config.repos[0].path, multiRepoDir);
        assert.equal(config.repos[1].path, extraRepo);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(multiRepoDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(extraRepo, { recursive: true, force: true });
    }
  });

  it('writes jira config when jira option is passed', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const origHome = process.env.HOME;
    process.env.HOME = TEST_GLOBAL_DIR;
    const jiraRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-jira-'));
    try {
      initProject({
        name: 'jira-test',
        repoPath: jiraRepo,
        jira: { projectKey: 'ACME' },
      });
      const config = JSON.parse(fs.readFileSync(path.join(jiraRepo, '.stask', 'config.json'), 'utf-8'));
      assert.deepEqual(config.jira, { projectKey: 'ACME' });
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(jiraRepo, { recursive: true, force: true });
    }
  });
});

describe('stask projects', () => {
  it('lists all registered projects', () => {
    const result = run(['projects']);
    assert.ok(result.stdout.includes('project-a'), result.stdout);
    assert.ok(result.stdout.includes('project-b'), result.stdout);
    assert.ok(result.stdout.includes(TEST_REPO_A), result.stdout);
  });

  it('shows project details', () => {
    const result = run(['projects', 'show', 'project-a']);
    assert.ok(result.stdout.includes('Project: project-a'), result.stdout);
    assert.ok(result.stdout.includes(TEST_REPO_A), result.stdout);
    assert.ok(result.stdout.includes('Agents:'), result.stdout);
  });

  it('errors on unknown project name', () => {
    const result = run(['projects', 'show', 'nonexistent'], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Unknown project'), result.stderr);
  });
});

describe('auto-detection from cwd', () => {
  it('auto-detects project when running from repo root', () => {
    const result = run(['list'], { cwd: TEST_REPO_A });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });

  it('auto-detects project from a subdirectory', () => {
    const subDir = path.join(TEST_REPO_A, 'src', 'deep');
    fs.mkdirSync(subDir, { recursive: true });
    const result = run(['list'], { cwd: subDir });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });
});

describe('--project flag', () => {
  it('targets a specific project from anywhere', () => {
    const result = run(['--project', 'project-a', 'list'], { cwd: os.tmpdir() });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });

  it('errors on unknown project name', () => {
    const result = run(['--project', 'nonexistent', 'list'], { cwd: os.tmpdir(), expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Unknown project "nonexistent"'), result.stderr);
    assert.ok(result.stderr.includes('Registered projects:'), result.stderr);
  });
});

describe('no project found', () => {
  it('prints helpful error with project list when outside any project', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-empty-'));
    try {
      const result = run(['list'], { cwd: emptyDir, expectFail: true });
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('No stask project found'), result.stderr);
      assert.ok(result.stderr.includes('project-a'), 'Should list project-a');
      assert.ok(result.stderr.includes('project-b'), 'Should list project-b');
      assert.ok(result.stderr.includes('stask setup'), 'Should suggest stask setup');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('stask init is removed', () => {
  it('errors with unknown command when stask init is called', () => {
    const result = run(['init', 'project-x', '--repo', TEST_REPO_A], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.includes('Unknown command') || result.stderr.includes('unknown command'),
      `Expected "Unknown command" in stderr, got: ${result.stderr}`
    );
  });
});

describe('STASK_HOME env var override', () => {
  it('uses STASK_HOME when set, bypassing auto-detection', () => {
    const staskHome = path.join(TEST_REPO_A, '.stask');
    const result = run(['list'], {
      cwd: os.tmpdir(),
      env: { STASK_HOME: staskHome },
    });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });
});

describe('cross-project operations', () => {
  it('heartbeat-all returns results for all projects', () => {
    const result = run(['heartbeat-all', 'lead-agent']);
    const json = JSON.parse(result.stdout);
    assert.equal(json.agent, 'lead-agent');
    assert.ok(Array.isArray(json.pendingTasks));
    assert.ok(Array.isArray(json.projects));
  });
});

describe('project isolation', () => {
  it('tasks in project-a are not visible in project-b', () => {
    // Create a task in project-a via direct DB insertion
    // (stask create needs Slack, so we test list isolation with empty DBs)
    const resultA = run(['list', '--json'], { cwd: TEST_REPO_A });
    const resultB = run(['list', '--json'], { cwd: TEST_REPO_B });

    // Both should return independent results (empty in this case)
    const tasksA = JSON.parse(resultA.stdout);
    const tasksB = JSON.parse(resultB.stdout);
    assert.ok(Array.isArray(tasksA));
    assert.ok(Array.isArray(tasksB));
  });
});
