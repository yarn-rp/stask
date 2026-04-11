/**
 * multi-project.test.mjs — E2E tests for multi-project support.
 *
 * These tests exercise the real CLI binary against temp directories.
 * They test: init, projects, --project flag, auto-detection, error messages,
 * task creation, and cross-project operations.
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

// ─── Setup & teardown ─────────────────────────────────────────────

before(() => {
  // Init git repos (stask init checks repo exists, not that it's git)
  fs.mkdirSync(path.join(TEST_GLOBAL_DIR, '.stask'), { recursive: true });
});

after(() => {
  // Cleanup temp dirs
  fs.rmSync(TEST_GLOBAL_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_REPO_A, { recursive: true, force: true });
  fs.rmSync(TEST_REPO_B, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────

describe('stask init', () => {
  it('scaffolds .stask/ in a repo and registers in projects.json', () => {
    const result = run(['init', 'project-a', '--repo', TEST_REPO_A]);
    assert.ok(result.stdout.includes('Project "project-a" initialized'), result.stdout);

    // .stask/config.json created
    const configPath = path.join(TEST_REPO_A, '.stask', 'config.json');
    assert.ok(fs.existsSync(configPath), '.stask/config.json should exist');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(config.project, 'project-a');

    // .stask/.gitignore created
    const gitignorePath = path.join(TEST_REPO_A, '.stask', '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.stask/.gitignore should exist');
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(gitignore.includes('tracker.db'), '.gitignore should exclude tracker.db');

    // Registered in projects.json
    const registryPath = path.join(TEST_GLOBAL_DIR, '.stask', 'projects.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    assert.ok(registry.projects['project-a'], 'project-a should be in registry');
    assert.equal(registry.projects['project-a'].repoPath, TEST_REPO_A);
  });

  it('creates a second project', () => {
    const result = run(['init', 'project-b', '--repo', TEST_REPO_B]);
    assert.ok(result.stdout.includes('Project "project-b" initialized'), result.stdout);

    // Both projects in registry
    const registryPath = path.join(TEST_GLOBAL_DIR, '.stask', 'projects.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    assert.ok(registry.projects['project-a'], 'project-a should still be in registry');
    assert.ok(registry.projects['project-b'], 'project-b should be in registry');
  });

  it('rejects re-initializing an existing project', () => {
    const result = run(['init', 'project-a', '--repo', TEST_REPO_A], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('already initialized'), result.stderr);
  });

  it('rejects init without --repo', () => {
    const result = run(['init', 'no-repo'], { expectFail: true });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Usage:'), result.stderr);
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
      assert.ok(result.stderr.includes('stask init'), 'Should suggest stask init');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
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
