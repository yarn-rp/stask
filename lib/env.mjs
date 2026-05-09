/**
 * env.mjs — Loads project config.json, resolves secrets via layered
 * token resolution, and imports bundled libs.
 *
 * Project root resolution:
 *   1. --project <name> → ~/.stask/projects.json registry lookup
 *   2. Walk up from cwd looking for .stask/config.json
 *   3. Helpful error if no project found
 *
 * Token resolution (SLACK_TOKEN):
 *   1. SLACK_TOKEN env var
 *   2. ~/.stask/config.json → projects.<name>.slackToken
 *   3. ~/.stask/config.json → slackToken (global default)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProjectRoot, resolveProjectName, resolveSlackToken } from './resolve-home.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── STASK_HOME — resolved project .stask/ directory ──────────────

export const STASK_HOME = resolveProjectRoot();

// ─── Load config.json from project .stask/ ────────────────────────

let _config = null;

export function loadConfig() {
  if (_config) return _config;

  const configPath = path.join(STASK_HOME, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Config not found at ${configPath}`);
    console.error(`Run: stask setup <path>`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // staskRoot = package install dir (for finding lib/ scripts)
  const staskRoot = path.resolve(__dirname, '..');

  // ── Repos: list of work repos this project spans ──
  // New shape: `repos: [{ path }]`. Legacy shape: a single
  // `projectRepoPath` string. Both are normalized to a list of
  // `{ key, path }` entries with absolute paths. The host repo
  // (where .stask/ lives) is conventionally the first entry, and
  // `projectRepoPath` is exposed as an alias for that for callers
  // that haven't migrated to multi-repo yet.
  const hostRepoDir = path.dirname(STASK_HOME);
  let reposList;
  if (Array.isArray(raw.repos) && raw.repos.length > 0) {
    reposList = raw.repos;
  } else if (raw.projectRepoPath) {
    reposList = [{ path: raw.projectRepoPath }];
  } else {
    reposList = [{ path: '.' }];
  }
  const normalizedRepos = reposList.map((r) => {
    const rawPath = typeof r === 'string' ? r : r.path;
    const absPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(hostRepoDir, rawPath);
    return {
      ...(typeof r === 'object' ? r : {}),
      path: absPath,
      key: path.basename(absPath),
    };
  });
  const baseBranch = raw.baseBranch || null;

  _config = {
    ...raw,
    repos: normalizedRepos,
    // Back-compat alias — first repo is the host where .stask/ lives.
    projectRepoPath: normalizedRepos[0].path,
    baseBranch,
    // Resolved absolute paths — runtime data lives in .stask/
    staskRoot,
    staskHome: STASK_HOME,
    dbPath: path.join(STASK_HOME, 'tracker.db'),
    registryPath: path.join(STASK_HOME, 'FILE_REGISTRY.json'),
    // Backward compat: expose specsDir as workspace too
    workspace: raw.specsDir,
  };
  return _config;
}

// ─── Repo lookup helpers ──────────────────────────────────────────

/**
 * Look up a repo entry by its key (basename of path).
 */
export function findRepo(key) {
  const config = loadConfig();
  return config.repos.find((r) => r.key === key) || null;
}

// ─── Load secrets (Slack token) via layered resolution ─────────────

let _envLoaded = false;

export function loadEnv() {
  if (_envLoaded) return;
  const config = loadConfig();
  const projectName = resolveProjectName();

  // Resolve Slack token via layered precedence
  const slackToken = resolveSlackToken(projectName);
  if (slackToken && !process.env.SLACK_TOKEN) {
    process.env.SLACK_TOKEN = slackToken;
  }

  _envLoaded = true;
}

// ─── Local lib imports (all bundled in stask/lib/) ─────────────────

import * as _slackApi from './slack-api.mjs';
import * as _fileUploader from './file-uploader.mjs';
import * as _trackerDb from './tracker-db.mjs';
import * as _validate from './validate.mjs';

const _workspaceLibs = {
  slackApi: _slackApi,
  fileUploader: _fileUploader,
  trackerDb: _trackerDb,
  validate: _validate,
};

export async function getWorkspaceLibs() {
  return _workspaceLibs;
}

// ─── Pipeline config (stale thresholds, etc.) ─────────────────────

let _pipelineConfig = null;

export function getPipelineConfig() {
  if (_pipelineConfig) return _pipelineConfig;
  const config = loadConfig();
  _pipelineConfig = {
    staleSessionMinutes: config.staleSessionMinutes || 30,
    maxRetries: config.maxQaRetries || 3,
  };
  return _pipelineConfig;
}

// ─── Convenience exports ───────────────────────────────────────────

export const CONFIG = loadConfig();

// Absolute path to stask/lib/ — used by execFileSync callers
export const LIB_DIR = __dirname;
