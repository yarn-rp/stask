/**
 * env.mjs — Loads config.json from ~/.stask/, auto-loads .env,
 * resolves global paths, and imports bundled libs.
 *
 * Global data dir: ~/.stask/ (override with STASK_HOME env var)
 * Contains: config.json, .env, tracker.db, FILE_REGISTRY.json, logs/, pr-status/
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── STASK_HOME — global data directory ───────────────────────────

export const STASK_HOME = process.env.STASK_HOME || path.join(os.homedir(), '.stask');

// ─── Load config.json from STASK_HOME ─────────────────────────────

let _config = null;

export function loadConfig() {
  if (_config) return _config;

  const configPath = path.join(STASK_HOME, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Config not found at ${configPath}`);
    console.error(`Run: mkdir -p ~/.stask && cp config.example.json ~/.stask/config.json`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // staskRoot = package install dir (for finding lib/ scripts)
  const staskRoot = path.resolve(__dirname, '..');

  _config = {
    ...raw,
    // Resolved absolute paths — all runtime data lives in STASK_HOME
    staskRoot,
    staskHome: STASK_HOME,
    dbPath: path.join(STASK_HOME, 'tracker.db'),
    envFile: path.join(STASK_HOME, '.env'),
    registryPath: path.join(STASK_HOME, 'FILE_REGISTRY.json'),
    // Backward compat: expose specsDir as workspace too
    workspace: raw.specsDir,
  };
  return _config;
}

// ─── Auto-load .env into process.env ───────────────────────────────

let _envLoaded = false;

export function loadEnv() {
  if (_envLoaded) return;
  const config = loadConfig();
  try {
    const lines = fs.readFileSync(config.envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (err) {
    console.error(`WARNING: Could not load env file ${config.envFile}: ${err.message}`);
  }
  _envLoaded = true;

  // Override listId from env if config says FROM_ENV
  if (config.slack?.listId === 'FROM_ENV' && process.env.LIST_ID) {
    config.slack.listId = process.env.LIST_ID;
  }

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
