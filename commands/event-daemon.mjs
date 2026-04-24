/**
 * event-daemon.mjs — Manage the background Slack Socket Mode event daemon.
 *
 * Usage:
 *   stask event-daemon start   — Start the daemon (fork detached)
 *   stask event-daemon stop    — Stop the daemon (SIGTERM via PID file)
 *   stask event-daemon status  — Check if daemon is running + last log lines
 *   stask event-daemon logs    — Tail the daemon log
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { CONFIG } from '../lib/env.mjs';

const STASK_HOME = CONFIG.staskHome;
const PID_FILE = path.resolve(STASK_HOME, 'event-daemon.pid');
const DAEMON_SCRIPT = path.resolve(CONFIG.staskRoot, 'bin', 'stask-event-daemon.mjs');
const LOG_FILE = path.resolve(STASK_HOME, 'logs', 'event-daemon.log');
const LOG_TAIL_LINES = 40;

export async function run(argv) {
  const subCmd = argv[0];
  switch (subCmd) {
    case 'start':  return start();
    case 'stop':   return stop();
    case 'status': return status();
    case 'logs':   return logs();
    default:
      console.error('Usage: stask event-daemon <start|stop|status|logs>');
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
 * Returns the PID of the new process, or the existing PID if already running.
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
    env: { ...process.env, STASK_HOME },
  });
  child.unref();

  return child.pid;
}

// ─── Subcommands ──────────────────────────────────────────────────

function start() {
  const pid = readPid();
  if (isAlive(pid)) {
    console.log(`Event daemon already running (PID ${pid})`);
    return;
  }

  const newPid = startDaemon();
  console.log(`Event daemon started (PID ${newPid})`);
  console.log(`Log: ${LOG_FILE}`);
}

function stop() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log('Event daemon is not running');
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
    return;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to event daemon (PID ${pid})`);

  // Wait briefly for cleanup
  let tries = 10;
  const check = () => {
    if (!isAlive(pid) || --tries <= 0) {
      if (isAlive(pid)) {
        console.error('Daemon did not stop in time');
      } else {
        console.log('Event daemon stopped');
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
    console.log(`Event daemon is running (PID ${pid})`);
    console.log(`Log: ${LOG_FILE}`);
  } else {
    console.log('Event daemon is not running');
    if (pid) {
      try { fs.unlinkSync(PID_FILE); } catch (_) {}
    }
  }
}

function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`No log file found at ${LOG_FILE}`);
    return;
  }

  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const tail = lines.slice(-LOG_TAIL_LINES);
  console.log(tail.join('\n'));
}
