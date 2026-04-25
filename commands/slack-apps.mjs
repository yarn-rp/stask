/**
 * stask slack-apps — Manage Slack app credentials so `stask setup` can
 * pick them up without re-prompting.
 *
 * Backed by OpenClaw's `channels.slack.accounts.<agent>` config (same
 * place `stask setup` Phase 4 stores tokens), so this command is a
 * stask-friendly wrapper around `openclaw channels add` plus a verify.
 *
 * Usage:
 *   stask slack-apps set <agent> --bot-token xoxb-... --app-token xapp-...
 *   stask slack-apps list
 *   stask slack-apps verify <agent>
 *
 * Tokens registered here are reused by `stask setup` for the same agent
 * name across any project.
 */

import { configGet, channelsAdd, readRawSecret } from '../lib/setup/openclaw-cli.mjs';
import { verifyToken } from '../lib/setup/slack-manifest.mjs';

function maskToken(t) {
  if (!t || typeof t !== 'string') return '';
  if (t.length <= 12) return t.slice(0, 4) + '…';
  return t.slice(0, 12) + '…' + t.slice(-4);
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bot-token' && argv[i + 1]) out.botToken = argv[++i];
    else if (argv[i] === '--app-token' && argv[i + 1]) out.appToken = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) out.displayName = argv[++i];
    else if (!argv[i].startsWith('--') && !out.agent) out.agent = argv[i];
  }
  return out;
}

function printUsage() {
  console.error('Usage:');
  console.error('  stask slack-apps set <agent> --bot-token xoxb-... --app-token xapp-... [--name "Display Name"]');
  console.error('  stask slack-apps list');
  console.error('  stask slack-apps verify <agent>');
}

async function runSet(rest) {
  const { agent, botToken, appToken, displayName } = parseFlags(rest);
  if (!agent || !botToken || !appToken) {
    console.error('Missing required argument.');
    printUsage();
    process.exit(1);
  }
  if (!botToken.startsWith('xoxb-')) {
    console.error('Bot token must start with xoxb-');
    process.exit(1);
  }
  if (!appToken.startsWith('xapp-')) {
    console.error('App token must start with xapp-');
    process.exit(1);
  }

  process.stdout.write(`Verifying bot token for "${agent}"... `);
  const v = await verifyToken(botToken);
  if (!v.ok) {
    console.log('FAIL');
    console.error(`Slack auth.test failed: ${v.error}`);
    process.exit(1);
  }
  console.log(`OK (user ${v.userId}${v.botName ? `, ${v.botName}` : ''})`);

  channelsAdd({
    channel: 'slack',
    account: agent,
    name: displayName || (agent.charAt(0).toUpperCase() + agent.slice(1)),
    botToken,
    appToken,
  });

  console.log(`Stored credentials for slack:${agent}.`);
  console.log('  Next stask setup will reuse these tokens for this agent and skip the prompt.');
}

async function runList() {
  let raw;
  try { raw = configGet('channels.slack.accounts'); }
  catch { raw = null; }
  if (!raw || typeof raw !== 'object') {
    console.log('No Slack accounts registered.');
    return;
  }
  const names = Object.keys(raw).sort();
  if (names.length === 0) {
    console.log('No Slack accounts registered.');
    return;
  }
  console.log(`Slack accounts (${names.length}):`);
  for (const name of names) {
    const acct = raw[name] || {};
    let bot = ''; let app = '';
    try { bot = readRawSecret(`channels.slack.accounts.${name}.botToken`) || ''; } catch {}
    try { app = readRawSecret(`channels.slack.accounts.${name}.appToken`) || ''; } catch {}
    const userId = acct.userId || '';
    console.log(`  ${name.padEnd(12)}  ${maskToken(bot).padEnd(20)} ${maskToken(app).padEnd(20)} ${userId}`);
  }
}

async function runVerify(rest) {
  const { agent } = parseFlags(rest);
  if (!agent) { printUsage(); process.exit(1); }
  let bot = '';
  try { bot = readRawSecret(`channels.slack.accounts.${agent}.botToken`) || ''; } catch {}
  if (!bot) {
    console.error(`No bot token stored for "${agent}". Run: stask slack-apps set ${agent} --bot-token ... --app-token ...`);
    process.exit(1);
  }
  process.stdout.write(`Verifying ${agent}... `);
  const v = await verifyToken(bot);
  if (!v.ok) {
    console.log('FAIL');
    console.error(`auth.test: ${v.error}`);
    process.exit(1);
  }
  console.log(`OK (user ${v.userId}${v.botName ? `, ${v.botName}` : ''})`);
}

export async function run(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === '--help' || sub === '-h') { printUsage(); return; }
  switch (sub) {
    case 'set':    return runSet(rest);
    case 'list':   return runList();
    case 'verify': return runVerify(rest);
    default:
      console.error(`Unknown subcommand: ${sub}`);
      printUsage();
      process.exit(1);
  }
}
