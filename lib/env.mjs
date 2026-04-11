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
    console.error(`Run: stask init <project-name> --repo <path>`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // staskRoot = package install dir (for finding lib/ scripts)
  const staskRoot = path.resolve(__dirname, '..');

  _config = {
    ...raw,
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
