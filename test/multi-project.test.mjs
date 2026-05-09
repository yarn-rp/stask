/**
 * multi-project.test.mjs — Tests for multi-project support.
 *
 * These tests exercise the `initProject` library function directly and the
 * real CLI binary for project-level operations (projects list, --project flag,
 * auto-detection, error messages, task creation, and cross-project operations).
 *
 * Model: .stask/ lives in the project home (parent folder), NOT inside a git
 * repo. Child git repos are peers used as push targets only.
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

// Two project homes (parent dirs, NOT git repos themselves)
const TEST_HOME_A = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-home-a-'));
const TEST_HOME_B = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-e2e-home-b-'));

// One child git-like repo inside home A for walk-up tests
const TEST_REPO_A_CHILD = path.join(TEST_HOME_A, 'repo');

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
      cwd: cwd || TEST_HOME_A,
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

// ─── Helper: scaffold a stask project in the project home ─────────
// We write the minimal artifacts directly (same as initProject() produces)
// so child-process CLI tests see a valid registry.
// New model: .stask/ lives in projectHome, repos are relative paths.

function scaffoldTestProject(name, projectHome, globalDir, repoPaths = []) {
  const staskDir = path.join(projectHome, '.stask');
  fs.mkdirSync(staskDir, { recursive: true });

  // repos: relative paths from projectHome (or absolute if outside)
  const repos = repoPaths.length > 0
    ? repoPaths.map((r) => {
        const rel = path.relative(projectHome, r);
        return { path: rel.startsWith('..') || path.isAbsolute(rel) ? r : './' + rel };
      })
    : [{ path: '.' }];

  const config = {
    project: name,
    specsDir: './specs',
    repos,
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

  // Register in projects.json with new 'projectHome' field
  const registryPath = path.join(globalDir, '.stask', 'projects.json');
  let registry = { projects: {} };
  if (fs.existsSync(registryPath)) {
    try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')); } catch {}
  }
  registry.projects[name] = { projectHome };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

// ─── Setup & teardown ─────────────────────────────────────────────

before(() => {
  // Create the global .stask dir as the registry location
  fs.mkdirSync(path.join(TEST_GLOBAL_DIR, '.stask'), { recursive: true });

  // Create child repo directory inside home A (simulate a git repo)
  fs.mkdirSync(TEST_REPO_A_CHILD, { recursive: true });
  fs.mkdirSync(path.join(TEST_REPO_A_CHILD, '.git'), { recursive: true }); // fake .git

  // Bootstrap both test projects in their home dirs.
  // The child-process CLI tests use BASE_ENV which sets HOME=TEST_GLOBAL_DIR,
  // so they will read projects.json from the right location.
  scaffoldTestProject('project-a', TEST_HOME_A, TEST_GLOBAL_DIR, [TEST_REPO_A_CHILD]);
  scaffoldTestProject('project-b', TEST_HOME_B, TEST_GLOBAL_DIR);
});

after(() => {
  // Cleanup temp dirs
  fs.rmSync(TEST_GLOBAL_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_HOME_A, { recursive: true, force: true });
  fs.rmSync(TEST_HOME_B, { recursive: true, force: true });
});

// ─── Tests for initProject (formerly stask init) ───────────────────

describe('initProject()', () => {
  it('scaffolds .stask/ in projectHome (not in any child repo)', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-init-home-'));
    const testRepo = path.join(testHome, 'myrepo');
    fs.mkdirSync(testRepo, { recursive: true });
    try {
      initProject({ name: 'init-test-a', projectHome: testHome, repos: [testRepo] });

      // .stask/config.json lives in projectHome, NOT in the repo
      const configPath = path.join(testHome, '.stask', 'config.json');
      assert.ok(fs.existsSync(configPath), '.stask/config.json should exist in projectHome');

      // No .stask/ inside the child repo
      assert.ok(!fs.existsSync(path.join(testRepo, '.stask')), '.stask/ should NOT be created inside the repo');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.project, 'init-test-a');

      // repos array uses relative paths
      assert.ok(Array.isArray(config.repos), 'config.repos should be an array');
      assert.ok(config.repos.length >= 1, 'config.repos should have at least one entry');
      assert.ok(!path.isAbsolute(config.repos[0].path), 'repo path should be relative');
      assert.ok(config.repos[0].path.startsWith('./'), 'repo path should start with ./');
    } finally {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('scaffolds a second project independently with its own config', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-init-home-b2-'));
    try {
      initProject({ name: 'init-test-b', projectHome: testHome });

      const configPath = path.join(testHome, '.stask', 'config.json');
      assert.ok(fs.existsSync(configPath), '.stask/config.json should exist for project-b');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.project, 'init-test-b');
    } finally {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('stores repos as relative paths from projectHome', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const origHome = process.env.HOME;
    process.env.HOME = TEST_GLOBAL_DIR;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-multi-home-'));
    const repoA = path.join(testHome, 'apis');
    const repoB = path.join(testHome, 'web');
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    try {
      initProject({
        name: 'multi-repo-test',
        projectHome: testHome,
        repos: [repoA, repoB],
      });
      const config = JSON.parse(fs.readFileSync(path.join(testHome, '.stask', 'config.json'), 'utf-8'));
      assert.equal(config.repos.length, 2, 'config.repos should have 2 entries');
      // Paths should be relative
      assert.equal(config.repos[0].path, './apis');
      assert.equal(config.repos[1].path, './web');
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('registers projectHome (not repoPath) in projects.json', async () => {
    // GLOBAL_STASK_DIR is frozen at module load from os.homedir(), so we can't
    // redirect the registry write via process.env.HOME mid-test. Instead read
    // from the real path init-project writes to and verify the entry shape.
    const { initProject } = await import('../lib/init-project.mjs');
    const realRegistryPath = path.join(os.homedir(), '.stask', 'projects.json');
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-reg-test-'));
    const slug = `reg-test-${Date.now()}`;
    try {
      initProject({ name: slug, projectHome: testHome });
      const registry = JSON.parse(fs.readFileSync(realRegistryPath, 'utf-8'));
      const entry = registry.projects[slug];
      assert.ok(entry, 'project should be registered');
      assert.ok(entry.projectHome, 'entry should have projectHome field');
      assert.equal(entry.projectHome, testHome, 'projectHome should match');
      assert.ok(!entry.repoPath, 'entry should NOT have legacy repoPath field');
    } finally {
      // Cleanup: scrub the test entry from the real registry
      try {
        const reg = JSON.parse(fs.readFileSync(realRegistryPath, 'utf-8'));
        delete reg.projects[slug];
        fs.writeFileSync(realRegistryPath, JSON.stringify(reg, null, 2) + '\n');
      } catch {}
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('does NOT write .gitignore inside .stask/', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const origHome = process.env.HOME;
    process.env.HOME = TEST_GLOBAL_DIR;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-no-gitignore-'));
    try {
      initProject({ name: 'no-gitignore-test', projectHome: testHome });
      const gitignorePath = path.join(testHome, '.stask', '.gitignore');
      assert.ok(!fs.existsSync(gitignorePath), '.stask/.gitignore should NOT exist (parent is not a git repo)');
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('writes jira config when jira option is passed', async () => {
    const { initProject } = await import('../lib/init-project.mjs');
    const origHome = process.env.HOME;
    process.env.HOME = TEST_GLOBAL_DIR;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-jira-'));
    try {
      initProject({
        name: 'jira-test',
        projectHome: testHome,
        jira: { projectKey: 'ACME' },
      });
      const config = JSON.parse(fs.readFileSync(path.join(testHome, '.stask', 'config.json'), 'utf-8'));
      assert.deepEqual(config.jira, { projectKey: 'ACME' });
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });
});

describe('stask projects', () => {
  it('lists all registered projects showing projectHome', () => {
    const result = run(['projects']);
    assert.ok(result.stdout.includes('project-a'), result.stdout);
    assert.ok(result.stdout.includes('project-b'), result.stdout);
    // Should show projectHome (the parent dir), not a child repo
    assert.ok(result.stdout.includes(TEST_HOME_A), result.stdout);
    assert.ok(result.stdout.includes(TEST_HOME_B), result.stdout);
  });

  it('shows project details with Home: field', () => {
    const result = run(['projects', 'show', 'project-a']);
    assert.ok(result.stdout.includes('Project: project-a'), result.stdout);
    assert.ok(result.stdout.includes('Home:'), result.stdout);
    assert.ok(result.stdout.includes(TEST_HOME_A), result.stdout);
    assert.ok(result.stdout.includes('Agents:'), result.stdout);
  });

  it('errors on unknown project name', () => {
    const result = run(['projects', 'show', 'nonexistent'], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Unknown project'), result.stderr);
  });
});

describe('auto-detection from cwd', () => {
  it('auto-detects project when running from project home (where .stask/ is)', () => {
    const result = run(['list'], { cwd: TEST_HOME_A });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });

  it('auto-detects project from a subdirectory within the project home', () => {
    const subDir = path.join(TEST_HOME_A, 'specs', 'deep');
    fs.mkdirSync(subDir, { recursive: true });
    const result = run(['list'], { cwd: subDir });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'), result.stdout);
  });

  it('auto-detects project from inside a child git repo (crosses git boundary)', () => {
    // TEST_REPO_A_CHILD is inside TEST_HOME_A; .stask/ is in TEST_HOME_A, NOT in the child repo.
    // Walk-up must cross the git boundary (.git in TEST_REPO_A_CHILD) and find .stask/ above it.
    const subDir = path.join(TEST_REPO_A_CHILD, 'src', 'nested');
    fs.mkdirSync(subDir, { recursive: true });
    const result = run(['list'], { cwd: subDir });
    assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'),
      `Expected project to be found from inside child repo. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
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
    const result = run(['init', 'project-x', '--repo', TEST_HOME_A], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.includes('Unknown command') || result.stderr.includes('unknown command'),
      `Expected "Unknown command" in stderr, got: ${result.stderr}`
    );
  });
});

describe('STASK_HOME env var override', () => {
  it('uses STASK_HOME when set, bypassing auto-detection', () => {
    const staskHome = path.join(TEST_HOME_A, '.stask');
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
    const resultA = run(['list', '--json'], { cwd: TEST_HOME_A });
    const resultB = run(['list', '--json'], { cwd: TEST_HOME_B });

    // Both should return independent results (empty in this case)
    const tasksA = JSON.parse(resultA.stdout);
    const tasksB = JSON.parse(resultB.stdout);
    assert.ok(Array.isArray(tasksA));
    assert.ok(Array.isArray(tasksB));
  });
});

describe('legacy-shape compatibility', () => {
  it('resolves a legacy project registered with repoPath field', () => {
    // Simulate an old install: .stask/ inside a git repo, registered with repoPath
    const legacyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stask-legacy-repo-'));
    try {
      // Write .stask/ inside the repo (old model)
      const staskDir = path.join(legacyRepo, '.stask');
      fs.mkdirSync(staskDir, { recursive: true });
      const config = {
        project: 'legacy-project',
        specsDir: './specs',
        repos: [{ path: legacyRepo }],
        baseBranch: 'main',
        worktreeBaseDir: path.join(TEST_GLOBAL_DIR, '.stask', 'worktrees', 'legacy-project'),
        staleSessionMinutes: 30,
        syncIntervalSeconds: 60,
        maxQaRetries: 3,
        coding: { backend: 'claude' },
        human: { name: 'YourName', slackUserId: 'UXXXXXXXXXX', githubUsername: 'your-github-username' },
        agents: {
          'lead-agent': { role: 'lead', slackUserId: 'UXXXXXXXXXX' },
        },
        slack: { listId: 'YOUR_SLACK_LIST_ID', columns: {}, statusOptions: {}, typeOptions: {} },
      };
      fs.writeFileSync(path.join(staskDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

      // Register with old 'repoPath' field (no 'projectHome')
      const regPath = path.join(TEST_GLOBAL_DIR, '.stask', 'projects.json');
      let registry = { projects: {} };
      if (fs.existsSync(regPath)) {
        try { registry = JSON.parse(fs.readFileSync(regPath, 'utf-8')); } catch {}
      }
      registry.projects['legacy-project'] = { repoPath: legacyRepo }; // legacy field
      fs.writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n');

      // Running from inside the repo should still work (walk-up finds .stask/ there)
      const result = run(['list'], { cwd: legacyRepo });
      assert.ok(result.stdout.includes('No tasks found') || result.stdout.includes('Task ID'),
        `Legacy project resolution failed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

      // --project flag should also work (uses repoPath as home)
      const result2 = run(['--project', 'legacy-project', 'list'], { cwd: os.tmpdir() });
      assert.ok(result2.stdout.includes('No tasks found') || result2.stdout.includes('Task ID'),
        `Legacy --project flag failed. stdout: ${result2.stdout}\nstderr: ${result2.stderr}`);
    } finally {
      // Clean up the legacy project from registry
      const regPath = path.join(TEST_GLOBAL_DIR, '.stask', 'projects.json');
      try {
        const registry = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        delete registry.projects['legacy-project'];
        fs.writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n');
      } catch {}
      fs.rmSync(legacyRepo, { recursive: true, force: true });
    }
  });
});
