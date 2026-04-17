/**
 * lib/setup/steps.mjs — Shared step functions used by both full setup and --only partial mode.
 *
 * Each step takes a context object (ctx) with:
 *   - s: spinner instance
 *   - d: data object (project slug, agent names, tokens, IDs, etc.)
 *   - staskConfigPath: path to .stask/config.json (for writing IDs)
 *   - leadToken: lead agent's bot token
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { log, pc, dimPath } from './prompt.mjs';
import { scaffoldWorkspace, seedWorkspaceState } from './template.mjs';
import { createAgentDir, getAgentDirPath } from './agent-dir.mjs';
import { installSkillsForAgent, getSkillCount } from './skills.mjs';
import { createProjectChannel } from './slack-channel.mjs';
import { createProjectList, writeSlackIdsToConfig, shareListInChannel } from './slack-list.mjs';
import { createProjectCanvas, sendWelcomeMessage } from './slack-canvas.mjs';
import { registerAgents } from './openclaw-config.mjs';
import { setupCronJobs } from './cron-setup.mjs';
import { configGet } from './openclaw-cli.mjs';
import { initProject } from '../../commands/init.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates/team');
const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

// ─── Utilities ───────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

async function slackBookmark(token, channelId, title, link, emoji) {
  const https = await import('node:https');
  return new Promise((resolve) => {
    const body = JSON.stringify({ channel_id: channelId, title, type: 'link', link, emoji });
    const req = https.default.request({
      hostname: 'slack.com', path: '/api/bookmarks.add', method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ ok: false }); } }); });
    req.on('error', () => resolve({ ok: false }));
    req.write(body); req.end();
  });
}

export async function getWorkspaceInfo(botToken) {
  const https = await import('node:https');
  return new Promise((resolve) => {
    const req = https.default.request({
      hostname: 'slack.com', path: '/api/auth.test', method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0 },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          resolve({ url: (r.url || 'https://slack.com').replace(/\/$/, ''), teamId: r.team_id || '', userId: r.user_id || '' });
        } catch { resolve({ url: 'https://slack.com', teamId: '', userId: '' }); }
      });
    });
    req.on('error', () => resolve({ url: 'https://slack.com', teamId: '', userId: '' }));
    req.end();
  });
}

/**
 * Build the context object needed by all step functions.
 * Works for both full setup (from wizard data) and partial mode (from .stask/config.json).
 */
export function buildContext({ staskConfig, slug, repoPath, leadToken }) {
  const agents = staskConfig.agents || {};
  const allUserIds = [
    ...Object.values(agents).map((a) => a.slackUserId),
    staskConfig.human?.slackUserId,
  ].filter(Boolean);

  return {
    slug,
    repoPath,
    leadToken,
    channelId: staskConfig.slack?.channelId || '',
    listId: staskConfig.slack?.listId || '',
    canvasId: staskConfig.canvasId || '',
    canvasUrl: '', // Built lazily when wsInfo is available
    listUrl: '', // Built lazily when wsInfo is available
    wsInfo: null,
    humanUserId: staskConfig.human?.slackUserId || '',
    agents,
    allUserIds,
    staskConfigPath: path.join(repoPath, '.stask', 'config.json'),
  };
}

// ─── Step Functions ──────────────────────────────────────────────

/**
 * Create Slack channel and invite all agents + human.
 */
export async function stepChannel(s, ctx) {
  const channelName = `${ctx.slug}-project`;
  s.start(`Creating #${channelName}...`);
  const res = await createProjectChannel({ botToken: ctx.leadToken, channelName, userIds: ctx.allUserIds });
  if (res.ok) {
    ctx.channelId = res.channelId;
    s.stop(`${pc.green('\u2713')} Channel ${pc.bold('#' + channelName)} ${res.existing ? '(exists)' : 'created'} ${pc.dim(res.channelId)}`);
    // Persist to config
    if (fs.existsSync(ctx.staskConfigPath)) {
      const cfg = JSON.parse(fs.readFileSync(ctx.staskConfigPath, 'utf-8'));
      cfg.slack = cfg.slack || {};
      cfg.slack.channelId = res.channelId;
      fs.writeFileSync(ctx.staskConfigPath, JSON.stringify(cfg, null, 2) + '\n');
    }
    return true;
  }
  s.stop(pc.yellow(`Channel: ${res.error}`));
  return false;
}

/**
 * Create Slack List with 14 columns and extract IDs into config.
 */
export async function stepList(s, ctx) {
  s.start('Creating project task board...');
  const res = await createProjectList({ botToken: ctx.leadToken, listName: ctx.slug });
  if (res.ok) {
    ctx.listId = res.listId;
    // Expose column/option IDs on ctx so the caller can persist them to setup
    // state and write them to .stask/config.json once that file is created in
    // the Register phase (during full setup, the config doesn't exist yet).
    ctx.listColumns = res.columns || {};
    ctx.listStatusOptions = res.statusOptions || {};
    ctx.listTypeOptions = res.typeOptions || {};
    s.stop(`${pc.green('\u2713')} List created: ${pc.bold(Object.keys(res.columns || {}).length)} columns ${pc.dim(res.listId)}`);

    // Write column/option IDs to config now if it already exists (partial
    // `--only list` mode). During full setup the config is created later by
    // initProject, at which point setup.mjs will call writeSlackIdsToConfig
    // using the ctx values we just set.
    if (fs.existsSync(ctx.staskConfigPath)) {
      writeSlackIdsToConfig(ctx.staskConfigPath, {
        listId: res.listId,
        columns: res.columns || {},
        statusOptions: res.statusOptions || {},
        typeOptions: res.typeOptions || {},
      });
      log.success('Column IDs written to .stask/config.json');
    }

    // Share + grant access
    if (ctx.channelId) {
      await shareListInChannel({
        botToken: ctx.leadToken, listId: res.listId, channelId: ctx.channelId,
        userIds: ctx.allUserIds, humanUserId: ctx.humanUserId,
      });
      log.success('Access granted + shared in channel');
    }

    await sleep(1500); // Let Slack propagate
    return true;
  }
  s.stop(pc.yellow(`List: ${res.error}`));
  if (res.debugPath) log.info(pc.dim(`Debug: cat ${res.debugPath}`));
  return false;
}

/**
 * Create project overview canvas (auto-tabs via channel_id).
 */
export async function stepCanvas(s, ctx) {
  s.start('Creating project overview canvas...');
  await sleep(2000); // Let Slack propagate channel + list

  const wsInfo = await getWorkspaceInfo(ctx.leadToken);
  ctx.wsInfo = wsInfo;
  const listUrl = ctx.listId ? `${wsInfo.url}/lists/${wsInfo.teamId}/${ctx.listId}` : '';
  ctx.listUrl = listUrl;

  const res = await createProjectCanvas({
    botToken: ctx.leadToken,
    projectSlug: ctx.slug,
    listUrl,
    agents: ctx.agents,
    humanUserId: ctx.humanUserId,
    channelId: ctx.channelId,
  });

  if (res.ok) {
    ctx.canvasId = res.canvasId;
    ctx.canvasUrl = `${wsInfo.url}/docs/${wsInfo.teamId}/${res.canvasId}`;

    // Persist canvasId to .stask/config.json
    if (fs.existsSync(ctx.staskConfigPath)) {
      const cfg = JSON.parse(fs.readFileSync(ctx.staskConfigPath, 'utf-8'));
      cfg.canvasId = res.canvasId;
      fs.writeFileSync(ctx.staskConfigPath, JSON.stringify(cfg, null, 2) + '\n');
    }

    s.stop(`${pc.green('\u2713')} Project overview canvas created (auto-tabbed)`);
    await sleep(2000); // Let Slack propagate
    return true;
  }
  s.stop(pc.yellow(`Canvas: ${res.error}`));
  return false;
}

/**
 * Add bookmarks to the channel (list + CLI + docs).
 */
export async function stepBookmarks(s, ctx) {
  s.start('Adding bookmarks...');

  if (!ctx.wsInfo) ctx.wsInfo = await getWorkspaceInfo(ctx.leadToken);

  if (ctx.listId && ctx.channelId) {
    const listBookmarkUrl = `${ctx.wsInfo.url}/lists/${ctx.wsInfo.teamId}/${ctx.listId}`;
    await slackBookmark(ctx.leadToken, ctx.channelId, 'Project Tracker - stask', listBookmarkUrl, ':clipboard:');
  }
  await slackBookmark(ctx.leadToken, ctx.channelId, 'stask CLI', 'https://github.com/yarn-rp/stask', ':computer:');
  await slackBookmark(ctx.leadToken, ctx.channelId, 'OpenClaw Docs', 'https://docs.openclaw.ai', ':books:');

  s.stop(`${pc.green('\u2713')} Bookmarks added`);

  log.info([
    pc.dim('  Pin the Task Tracker as a channel tab:'),
    pc.dim(`    1. Click ${pc.cyan('+')} next to the tabs at the top of the channel`),
    pc.dim(`    2. Select ${pc.cyan('List')}`),
    pc.dim(`    3. Choose ${pc.cyan('Project Tracker - stask')} \u2192 ${pc.cyan('Insert')}`),
    pc.dim(`    4. Click ${pc.cyan('Group by: Status')} for the board view`),
  ].join('\n'));
}

/**
 * Send the welcome message + team introduction.
 */
export async function stepWelcome(s, ctx) {
  s.start('Sending welcome message...');
  await sleep(500);

  if (!ctx.wsInfo) ctx.wsInfo = await getWorkspaceInfo(ctx.leadToken);
  if (!ctx.listUrl && ctx.listId) {
    ctx.listUrl = `${ctx.wsInfo.url}/lists/${ctx.wsInfo.teamId}/${ctx.listId}`;
  }

  // Build canvasUrl if not already set (same pattern as listUrl)
  if (!ctx.canvasUrl && ctx.canvasId) {
    ctx.canvasUrl = `${ctx.wsInfo.url}/docs/${ctx.wsInfo.teamId}/${ctx.canvasId}`;
  }

  const res = await sendWelcomeMessage({
    botToken: ctx.leadToken,
    channelId: ctx.channelId,
    humanUserId: ctx.humanUserId,
    projectSlug: ctx.slug,
    agents: ctx.agents,
    canvasUrl: ctx.canvasUrl || '',
    listUrl: ctx.listUrl || '',
  });

  if (res.ok) {
    s.stop(`${pc.green('\u2713')} Welcome message sent`);
  } else {
    s.stop(pc.dim('Welcome message failed'));
  }
}

/**
 * Install skills for all agents.
 */
export async function stepSkills(s, ctx, agentRoles, manifests) {
  const workspaceBase = path.join(OPENCLAW_HOME, `workspace-${ctx.slug}`);
  const leadName = Object.entries(ctx.agents).find(([, v]) => v.role === 'lead')?.[0];
  const leadWorkspace = path.join(workspaceBase, leadName || '');

  const totalSkills = agentRoles.reduce((sum, a) => sum + getSkillCount(a.role, manifests), 0);
  s.start(`Installing skills (${totalSkills} total across ${agentRoles.length} agents)...`);

  const results = [];
  for (const { name, role } of agentRoles) {
    const res = await installSkillsForAgent({
      agentName: name, role,
      workspacePath: path.join(workspaceBase, name),
      leadWorkspace,
      onProgress: (msg) => s.message(msg),
      manifests,
    });
    results.push({ name, ...res });
  }

  const totalInstalled = results.reduce((sum, r) => sum + r.installed.length + r.symlinked.length, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);
  s.stop(`${pc.bold(totalInstalled)} skills installed` + (totalFailed ? pc.yellow(` (${totalFailed} not found)`) : ''));

  for (const r of results) {
    const ok = r.installed.length + r.symlinked.length;
    const failMsg = r.failed.length ? pc.yellow(` \u00b7 ${r.failed.length} missing`) : '';
    log.info(`  ${pc.dim('\u25cf')} ${pc.bold(r.name)}: ${ok} skills${failMsg}`);
  }
}

/**
 * Setup heartbeat cron jobs.
 */
export async function stepCron(s, ctx, agentManifests) {
  s.start('Setting up heartbeat cron jobs...');
  const agents = Object.entries(ctx.agents);

  const res = setupCronJobs(agents, agentManifests, ctx.slug);
  s.stop(`${pc.bold(res.created.length)} created, ${pc.bold(res.updated.length || 0)} updated heartbeats configured`);
}

/**
 * Register agents in openclaw.json.
 */
export async function stepOpenclaw(s, ctx, agentModels, teamManifest, providedSlackAccounts) {
  s.start('Registering agents in openclaw.json...');
  const workspaceBase = path.join(OPENCLAW_HOME, `workspace-${ctx.slug}`);

  const agentList = Object.entries(ctx.agents).map(([name, cfg]) => ({
    id: name, name: capitalize(name),
    model: agentModels?.[name]?.model || '',
    fallbacks: agentModels?.[name]?.fallbacks || [],
    workspace: path.join(workspaceBase, name),
    agentDir: getAgentDirPath(name),
  }));

  const slackAccounts = {};
  // Priority 1: accounts passed in from caller (setup state — fresh tokens from wizard)
  if (providedSlackAccounts) {
    for (const [name, acct] of Object.entries(providedSlackAccounts)) {
      if (acct?.botToken) slackAccounts[name] = { botToken: acct.botToken, appToken: acct.appToken };
    }
  }
  // Priority 2: fall back to the live gateway config (partial mode —
  // re-running register step). Uses `openclaw config get` rather than
  // fs.readFileSync to avoid the clobber race against the running gateway.
  for (const name of Object.keys(ctx.agents)) {
    if (slackAccounts[name]) continue; // already have from caller
    const acct = configGet(`channels.slack.accounts.${name}`);
    if (acct?.botToken) {
      slackAccounts[name] = { botToken: acct.botToken, appToken: acct.appToken };
    }
  }

  const leadId = Object.entries(ctx.agents).find(([, v]) => v.role === 'lead')?.[0];
  const res = registerAgents({ projectSlug: ctx.slug, agents: agentList, leadId, slackAccounts, openclawDefaults: teamManifest?.openclaw });
  s.stop(`${pc.bold(res.added.length)} agents registered`);
}

/**
 * Run verification checks.
 */
export function stepVerify(ctx) {
  const wsPath = path.join(OPENCLAW_HOME, `workspace-${ctx.slug}`);
  const leadName = Object.entries(ctx.agents).find(([, v]) => v.role === 'lead')?.[0];
  const checks = [
    ['Workspace', fs.existsSync(wsPath)],
    ['Database', fs.existsSync(path.join(ctx.repoPath, '.stask', 'tracker.db'))],
    ['Config', fs.existsSync(ctx.staskConfigPath)],
    ['Cron', fs.existsSync(path.join(OPENCLAW_HOME, 'cron', 'jobs.json'))],
    ['Slack List', !!ctx.listId],
    ['Slack channel', !!ctx.channelId],
    ['Canvas', !!ctx.canvasId],
  ];
  for (const [label, ok] of checks) {
    if (ok) log.success(label);
    else log.warn(`${label} ${pc.yellow('\u2014 needs attention')}`);
  }
}
