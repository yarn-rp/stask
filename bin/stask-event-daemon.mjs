#!/usr/bin/env node
/**
 * stask-event-daemon.mjs — Long-running Slack Socket Mode event daemon.
 *
 * Connects to Slack via Socket Mode using the lead agent's xapp- token.
 * Dispatches events to registered handlers (lib/event-daemon/registry.mjs).
 *
 * Designed to be forked as a detached child process by:
 *   stask event-daemon start
 *
 * Environment:
 *   STASK_HOME         — .stask/ directory (resolved by env.mjs)
 *   STASK_EVENT_LEAD   — lead agent name (override; normally from config)
 *   STASK_EVENT_APP_TOKEN — xapp- token (override; normally from openclaw.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Env + config ─────────────────────────────────────────────────
import { loadEnv, CONFIG, STASK_HOME } from '../lib/env.mjs';
loadEnv();

import { readRawSecret } from '../lib/setup/openclaw-cli.mjs';
import * as trackerDb from '../lib/tracker-db.mjs';
import * as slackApi from '../lib/slack-api.mjs';
import { getWorkspaceLibs } from '../lib/env.mjs';

const PID_FILE = path.join(STASK_HOME, 'event-daemon.pid');
const LOG_DIR = path.join(STASK_HOME, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'event-daemon.log');

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

const logger = {
  info:  (msg) => log('INFO',  msg),
  warn:  (msg) => log('WARN',  msg),
  error: (msg) => log('ERROR', msg),
  debug: (msg) => log('DEBUG', msg),
};

// ─── PID management ───────────────────────────────────────────────

function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

function cleanupPid() {
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

// ─── Resolve lead credentials ─────────────────────────────────────

function resolveLeadName() {
  if (process.env.STASK_EVENT_LEAD) return process.env.STASK_EVENT_LEAD;
  // CONFIG.agents is { <name>: { role, ... } }
  for (const [name, agent] of Object.entries(CONFIG.agents || {})) {
    if (agent.role === 'lead') return name;
  }
  return null;
}

function resolveAppToken(leadName) {
  if (process.env.STASK_EVENT_APP_TOKEN) return process.env.STASK_EVENT_APP_TOKEN;
  if (!leadName) return null;
  return readRawSecret(`channels.slack.accounts.${leadName}.appToken`);
}

function resolveBotToken(leadName) {
  if (!leadName) return null;
  const fromEnv = process.env.SLACK_TOKEN;
  if (fromEnv) return fromEnv;
  return readRawSecret(`channels.slack.accounts.${leadName}.botToken`);
}

// ─── Openclaw shim (v1 stub — not used by list-reconcile) ─────────

const openclaw = {
  invoke(prompt) {
    logger.warn(`[openclaw] invoke called (stub): ${JSON.stringify(prompt).slice(0, 80)}`);
    return Promise.resolve(null);
  },
};

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  ensureLogDir();
  writePid();
  logger.info(`Event daemon started (PID ${process.pid})`);

  // Resolve lead agent credentials
  const leadName = resolveLeadName();
  if (!leadName) {
    logger.error('No lead agent found in config. Set STASK_EVENT_LEAD env var or configure agents in config.json.');
    cleanupPid();
    process.exit(1);
  }
  logger.info(`Lead agent: ${leadName}`);

  const appToken = resolveAppToken(leadName);
  if (!appToken || !appToken.startsWith('xapp-')) {
    logger.error(`No valid xapp- token found for lead "${leadName}". Run stask setup to configure tokens.`);
    cleanupPid();
    process.exit(1);
  }

  const botToken = resolveBotToken(leadName);
  if (botToken && !process.env.SLACK_TOKEN) {
    process.env.SLACK_TOKEN = botToken;
  }

  // Build shared context
  const db = trackerDb.getDb();
  trackerDb.ensureSyncStateTable();

  const libs = await getWorkspaceLibs();

  // Freeze the slack subtree so a stray `slackApi.getListItems` retry
  // path can't transiently mutate ctx.config.slack.listId out from under
  // a sibling handler's match() check. Surfaced when investigating
  // file_change events that received the same payload but matched on
  // some deliveries and not others.
  if (CONFIG?.slack) Object.freeze(CONFIG.slack);
  Object.freeze(CONFIG);

  const ctx = {
    db,
    libs,
    slackApi,
    logger,
    openclaw,
    config: CONFIG,
    leadName,
  };

  // Start socket client
  const { createSocketClient } = await import('../lib/event-daemon/socket-client.mjs');

  let client;
  try {
    logger.info('[main] Connecting to Slack Socket Mode...');
    client = await createSocketClient({ appToken, ctx });
    logger.info('[main] Socket Mode connected — daemon is live');
  } catch (err) {
    logger.error(`[main] Failed to connect: ${err.message}`);
    cleanupPid();
    process.exit(1);
  }

  // Keep alive — the client maintains the WebSocket internally.
  // Shutdown on signals.
  function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down`);
    if (client) {
      client.disconnect().catch(() => {});
    }
    cleanupPid();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    cleanupPid();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

main().catch((err) => {
  log('ERROR', `Fatal: ${err.message}`);
  cleanupPid();
  process.exit(1);
});
