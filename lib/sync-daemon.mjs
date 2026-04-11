#!/usr/bin/env node
/**
 * sync-daemon.mjs — Long-running bidirectional sync process.
 *
 * Runs `runSyncCycle()` at a configurable interval.
 * Designed to be forked as a detached child process by `stask sync-daemon start`.
 *
 * Writes PID file for single-instance management.
 * Logs to cli/stask/logs/sync-daemon.log.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import env (uses resolve-home.mjs for project root resolution)
import { loadEnv, CONFIG, STASK_HOME } from './env.mjs';
loadEnv();

import { runSyncCycle } from './slack-sync.mjs';

const PID_FILE = path.join(STASK_HOME, 'sync-daemon.pid');
const LOG_DIR = path.join(STASK_HOME, 'logs');
const LOG_FILE = path.resolve(LOG_DIR, 'sync-daemon.log');
const INTERVAL_MS = (CONFIG.syncIntervalSeconds || 60) * 1000;

// ─── Logging ──────────────────────────────────────────────────────

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
  if (level === 'ERROR') process.stderr.write(line);
}

// ─── PID management ───────────────────────────────────────────────

function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

function cleanupPid() {
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

// ─── Main loop ────────────────────────────────────────────────────

let running = true;
let timer = null;

async function tick() {
  if (!running) return;
  try {
    const summary = await runSyncCycle();
    const pulled = summary.pulled.length;
    const pushed = summary.pushed.length;
    const errors = summary.errors.length;
    if (pulled > 0 || pushed > 0 || errors > 0) {
      log('INFO', `Sync cycle: pulled=${pulled} pushed=${pushed} errors=${errors} skipped=${summary.skipped}`);
      if (pulled > 0) log('INFO', `  Pulled: ${summary.pulled.join(', ')}`);
      if (pushed > 0) log('INFO', `  Pushed: ${summary.pushed.join(', ')}`);
      for (const err of summary.errors) log('ERROR', `  ${err}`);
    }
  } catch (err) {
    log('ERROR', `Sync cycle failed: ${err.message}`);
  }
  if (running) {
    timer = setTimeout(tick, INTERVAL_MS);
  }
}

function shutdown(signal) {
  log('INFO', `Received ${signal}, shutting down`);
  running = false;
  if (timer) clearTimeout(timer);
  cleanupPid();
  process.exit(0);
}

// ─── Start ────────────────────────────────────────────────────────

ensureLogDir();
writePid();
log('INFO', `Sync daemon started (PID ${process.pid}, interval ${INTERVAL_MS / 1000}s)`);

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught: ${err.message}`);
  cleanupPid();
  process.exit(1);
});

// Run first cycle immediately, then on interval
tick();
