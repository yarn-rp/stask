/**
 * sync-daemon.mjs — Manage the background sync daemon.
 *
 * Usage:
 *   stask sync-daemon start   — Start the daemon (fork detached)
 *   stask sync-daemon stop    — Stop the daemon (SIGTERM via PID file)
 *   stask sync-daemon status  — Check if daemon is running
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { CONFIG } from '../lib/env.mjs';

const STASK_HOME = CONFIG.staskHome;
const PID_FILE = path.resolve(STASK_HOME, 'sync-daemon.pid');
const DAEMON_SCRIPT = path.resolve(CONFIG.staskRoot, 'lib', 'sync-daemon.mjs');
const LOG_FILE = path.resolve(STASK_HOME, 'logs', 'sync-daemon.log');

export async function run(argv) {
  const subCmd = argv[0];
  switch (subCmd) {
    case 'start':  return start();
    case 'stop':   return stop();
    case 'status': return status();
    default:
      console.error('Usage: stask sync-daemon <start|stop|status>');
      process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function readPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch (_) {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Start the daemon as a detached child process.
 */
export function startDaemon() {
  const pid = readPid();
  if (isAlive(pid)) return pid; // Already running

  // Clean up stale PID file
  if (pid) {
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
  }

  // Ensure log dir
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // Open log file for stdout/stderr
  const logFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });
  child.unref();

  return child.pid;
}

// ─── Subcommands ──────────────────────────────────────────────────

function start() {
  const pid = readPid();
  if (isAlive(pid)) {
    console.log(`Sync daemon already running (PID ${pid})`);
    return;
  }

  const newPid = startDaemon();
  console.log(`Sync daemon started (PID ${newPid})`);
}

function stop() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log('Sync daemon is not running');
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
    return;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to sync daemon (PID ${pid})`);

  // Wait briefly for cleanup
  let tries = 10;
  const check = () => {
    if (!isAlive(pid) || --tries <= 0) {
      if (isAlive(pid)) {
        console.error('Daemon did not stop in time');
      } else {
        console.log('Sync daemon stopped');
      }
      return;
    }
    setTimeout(check, 200);
  };
  check();
}

function status() {
  const pid = readPid();
  if (pid && isAlive(pid)) {
    const interval = CONFIG.syncIntervalSeconds || 60;
    console.log(`Sync daemon is running (PID ${pid}, interval ${interval}s)`);
    console.log(`Log: ${LOG_FILE}`);
  } else {
    console.log('Sync daemon is not running');
    if (pid) {
      // Stale PID file
      try { fs.unlinkSync(PID_FILE); } catch (_) {}
    }
  }
}
