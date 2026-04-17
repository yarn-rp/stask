#!/usr/bin/env node
/**
 * bootstrap-channel.mjs — idempotent Slack channel provisioning for the QA sandbox.
 *
 * Why not let `stask setup` create the channel itself? Because its fallback
 * on `name_taken` only looks at non-archived channels, and `conversations.rename`
 * / `conversations.unarchive` both require the caller to already be a channel
 * member — which the bot isn't after a prior archive. So the name is stuck.
 *
 * This helper runs BEFORE `stask setup` and:
 *   1. Looks for an active channel matching `{slug}-project` or `{slug}-project-N`.
 *      Reuse the first one found (idempotent across install runs).
 *   2. If nothing usable exists, creates `{slug}-project`. If that's name_taken
 *      (stuck archived), tries `{slug}-project-2`, `-3`, ... until one works.
 *   3. Invites the other three bots + the human to the channel.
 *
 * Emits the channel id to stdout. Caller injects it into STASK_SETUP_ANSWERS
 * as `{ "Project Slack channel": "existing", "Channel ID": "<id>" }` so the
 * wizard skips stepChannel entirely.
 *
 * Usage:
 *   node bootstrap-channel.mjs <credentials.json> <slug>
 */

import fs from 'node:fs';
import https from 'node:https';

const [, , credsPath, slug] = process.argv;
if (!credsPath || !slug) {
  console.error('usage: bootstrap-channel.mjs <credentials> <slug>');
  process.exit(2);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
const LEAD_TOKEN = creds.slack.apps.professor.botToken;
const HUMAN_ID = creds.slack.humanUserId;
const BASE_NAME = `${slug}-project`;
const MAX_SUFFIX = 20;

function slackApi(method, body, token = LEAD_TOKEN) {
  const payload = JSON.stringify(body || {});
  const opts = {
    method: 'POST',
    hostname: 'slack.com',
    path: `/api/${method}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`parse error: ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// GET variant — `conversations.list` ignores `exclude_archived` when sent
// via JSON body but respects it as a query param. Use this for read-only
// methods whose filters actually matter.
function slackApiGet(method, params, token = LEAD_TOKEN) {
  const qs = new URLSearchParams(params || {}).toString();
  const opts = {
    method: 'GET',
    hostname: 'slack.com',
    path: `/api/${method}?${qs}`,
    headers: { 'Authorization': `Bearer ${token}` },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`parse error: ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function log(msg) { console.error(`  ${msg}`); }

async function collectBotUserIds() {
  const ids = [];
  for (const [role, app] of Object.entries(creds.slack.apps)) {
    const r = await slackApi('auth.test', {}, app.botToken);
    if (r.ok) ids.push({ role, userId: r.user_id });
    else log(`auth.test failed for ${role}: ${r.error}`);
  }
  return ids;
}

async function findActiveChannel() {
  // Must use GET — Slack's JSON-body POST ignores exclude_archived.
  // Client-side belt-and-suspenders: drop is_archived=true rows too.
  const r = await slackApiGet('conversations.list', {
    types: 'public_channel',
    limit: 1000,
    exclude_archived: 'true',
  });
  if (!r.ok) { log(`conversations.list error: ${r.error}`); return null; }
  const re = new RegExp(`^${BASE_NAME}(-\\d+)?$`);
  const matches = (r.channels || []).filter((c) => !c.is_archived && re.test(c.name));
  if (matches.length === 0) return null;
  return matches.find((c) => c.name === BASE_NAME) || matches[0];
}

async function createWithCounter() {
  for (let suffix = 0; suffix <= MAX_SUFFIX; suffix++) {
    const name = suffix === 0 ? BASE_NAME : `${BASE_NAME}-${suffix}`;
    const r = await slackApi('conversations.create', { name, is_private: false });
    if (r.ok) {
      log(`created #${name} (${r.channel.id})`);
      return r.channel;
    }
    if (r.error === 'name_taken') {
      log(`#${name} taken, trying next suffix`);
      continue;
    }
    throw new Error(`conversations.create failed for #${name}: ${r.error}`);
  }
  throw new Error(`all channel names ${BASE_NAME}, ${BASE_NAME}-1..${MAX_SUFFIX} are taken`);
}

async function inviteMembers(channelId, botUserIds) {
  const toInvite = [...botUserIds.map((b) => b.userId), HUMAN_ID].filter(Boolean);
  for (const uid of toInvite) {
    const r = await slackApi('conversations.invite', { channel: channelId, users: uid });
    if (r.ok) { log(`invited ${uid}`); continue; }
    if (r.error === 'already_in_channel' || r.error === 'cant_invite_self') continue;
    log(`invite ${uid}: ${r.error}`);
  }
}

(async () => {
  const bots = await collectBotUserIds();
  log(`bot user ids: ${bots.map((b) => `${b.role}=${b.userId}`).join(', ')}`);

  let channel = await findActiveChannel();
  if (channel) {
    log(`reusing existing #${channel.name} (${channel.id})`);
  } else {
    channel = await createWithCounter();
  }

  await inviteMembers(channel.id, bots);
  process.stdout.write(channel.id);
})().catch((err) => {
  console.error(`bootstrap-channel failed: ${err.message}`);
  process.exit(1);
});
