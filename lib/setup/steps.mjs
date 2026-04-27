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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { log, pc, dimPath, select, text, confirm, isCancel, cancel } from './prompt.mjs';
import { scaffoldWorkspace, seedWorkspaceState } from './template.mjs';
import { getAgentDirPath } from './agent-dir.mjs';
import { installSkillsForAgent, getSkillCount } from './skills.mjs';
import { scaffoldClaudeSubagents } from './claude-subagents.mjs';
import { createProjectChannel } from './slack-channel.mjs';
import { createProjectList, writeSlackIdsToConfig, shareListInChannel } from './slack-list.mjs';
import { createProjectCanvas, sendWelcomeMessage } from './slack-canvas.mjs';
import { registerAgents } from './openclaw-config.mjs';
import { setupCronJobs } from './cron-setup.mjs';
import { initProject } from '../../commands/init.mjs';
import { configGet, cronUpsert, readRawSecret } from './openclaw-cli.mjs';
// NOTE: ../env.mjs is intentionally NOT imported at the top — it eagerly
// runs resolveProjectRoot() at module load and breaks `stask setup .` from
// outside a project (see PR #46). stepActivateListChannel imports it
// dynamically since by the time that step runs, .stask/ exists.

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
    ctx.listSpecApprovedOptions = res.specApprovedOptions || {};
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
        specApprovedOptions: res.specApprovedOptions || {},
      });
      log.success('Column IDs written to .stask/config.json');
    }

    // Share + grant access
    if (ctx.channelId) {
      const shareRes = await shareListInChannel({
        botToken: ctx.leadToken, listId: res.listId, channelId: ctx.channelId,
        userIds: ctx.allUserIds, humanUserId: ctx.humanUserId,
      });
      if (shareRes.accessErrors?.length) {
        log.warn(pc.yellow(`List access issues for ${shareRes.accessErrors.length} user(s):`));
        for (const e of shareRes.accessErrors) {
          log.info(pc.dim(`  ${e.userId} (${e.accessLevel}): ${e.error}`));
        }
      } else {
        log.success('Access granted + shared in channel');
      }
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

  if (!ctx.taskThreadUrl) {
    const err = new Error('taskThreadUrl missing — stepBootstrapTask must run before stepWelcome.');
    s.stop(pc.red(`Welcome message aborted: ${err.message}`));
    throw err;
  }

  if (!ctx.wsInfo) ctx.wsInfo = await getWorkspaceInfo(ctx.leadToken);
  if (!ctx.listUrl && ctx.listId) {
    ctx.listUrl = `${ctx.wsInfo.url}/lists/${ctx.wsInfo.teamId}/${ctx.listId}`;
  }
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
    taskThreadUrl: ctx.taskThreadUrl,
  });

  if (!res.ok) {
    s.stop(pc.red(`Welcome message failed: ${res.error || 'unknown error'}`));
    throw new Error(`sendWelcomeMessage failed: ${res.error || 'unknown error'}`);
  }
  s.stop(`${pc.green('\u2713')} Welcome message sent`);
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
 * Scaffold Claude Code subagent + skill files into <repoPath>/.claude/.
 * One agent file per configured agent (keyed by agent name, not role) with
 * `skills:` frontmatter that preloads the role playbook at session startup.
 */
export async function stepClaudeSubagents(s, ctx, { projectName, humanName, manifests, agentRoles }) {
  s.start('Scaffolding Claude subagents at repo root...');
  // Prefer explicit roleId from caller (setup wizard knows the manifest role —
  // 'backend' vs 'frontend'); fall back to the stask role (lead/worker/qa) for
  // partial mode where only .stask/config.json is available.
  const agents = (agentRoles && agentRoles.length)
    ? agentRoles
    : Object.entries(ctx.agents).map(([name, cfg]) => ({ name, roleId: cfg.role }));

  const res = scaffoldClaudeSubagents({
    repoPath: ctx.repoPath,
    projectName: projectName || ctx.slug,
    projectSlug: ctx.slug,
    humanName,
    openclawHome: OPENCLAW_HOME,
    agents,
    manifests,
  });
  s.stop(`${pc.green('\u2713')} ${pc.bold(res.agentsWritten)} agents + ${pc.bold(res.skillsCopied)} skills at ${dimPath(res.claudeDir)}`);
  if (res.skillsMissing.length) {
    log.warn(`  ${pc.yellow('!')} ${res.skillsMissing.length} skill(s) not found in agent workspaces — install them first then re-run \`stask setup --only claude\`:`);
    for (const s of res.skillsMissing) log.info(`    ${pc.dim('\u00b7')} ${s}`);
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
  // Priority 2: fall back to openclaw.json (partial mode — re-running
  // register step). Uses readRawSecret so bot/app tokens aren't redacted
  // to "__OPENCLAW_REDACTED__" (as `openclaw config get` does). Read-only
  // access, no race — only writes need gateway coordination.
  for (const name of Object.keys(ctx.agents)) {
    if (slackAccounts[name]) continue; // already have from caller
    const botToken = readRawSecret(`channels.slack.accounts.${name}.botToken`);
    const appToken = readRawSecret(`channels.slack.accounts.${name}.appToken`);
    if (botToken) slackAccounts[name] = { botToken, appToken };
  }

  const leadId = Object.entries(ctx.agents).find(([, v]) => v.role === 'lead')?.[0];
  const res = registerAgents({
    projectSlug: ctx.slug,
    agents: agentList,
    leadId,
    slackAccounts,
    humanSlackUserId: ctx.humanUserId,
    openclawDefaults: teamManifest?.openclaw,
  });
  s.stop(`${pc.bold(res.added.length)} agents registered`);
}

/**
 * Run post-install verification checks (renamed from stepVerify).
 */
export function stepInstall(ctx) {
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

/**
 * Setup inbox subscriptions (GitHub/Linear polling).
 */
export async function stepInbox(s, ctx) {
  s.start('Setting up inbox subscriptions...');

  const inboxPath = path.resolve(ctx.repoPath, 'commands', 'inbox.mjs');
  if (!fs.existsSync(inboxPath)) {
    s.stop(pc.yellow('Inbox module not found - skipping inbox setup'));
    return false;
  }

  // Check if gh CLI is available
  let ghAvailable = false;
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    ghAvailable = true;
  } catch {
    // gh not available - we'll warn but continue
  }

  // Check if linear CLI is available
  let linearAvailable = false;
  try {
    execFileSync('linear', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    linearAvailable = true;
  } catch {
    // linear not available - we'll warn but continue
  }

  const choices = [];
  if (ghAvailable) choices.push({ value: 'github', label: 'GitHub repositories', hint: 'Monitor GitHub events (PRs, issues, etc.)' });
  if (linearAvailable) choices.push({ value: 'linear', label: 'Linear projects', hint: 'Monitor Linear tickets' });
  choices.push({ value: 'none', label: 'Skip inbox setup', hint: 'Configure later with: stask setup --only inbox' });

  if (choices.length === 1 && choices[0].value === 'none') {
    s.stop(pc.yellow('Inbox setup skipped - no polling tools available'));
    log.info(pc.dim('  You can add inbox subscriptions later with: stask setup --only inbox'));
    return true;
  }

  // If only one real source + skip, still show the select so user can choose
  let inboxChoice;
  if (choices.length > 1) {
    inboxChoice = await select({ message: 'What would you like to monitor?', options: choices });
    if (isCancel(inboxChoice)) {
      cancel('Inbox setup cancelled.');
      return false;
    }
  } else {
    inboxChoice = choices[0].value;
  }

  if (inboxChoice === 'none') {
    s.stop(pc.yellow('Inbox setup skipped'));
    log.info(pc.dim('  Configure later with: stask setup --only inbox'));
    return true;
  }

  const sourceType = inboxChoice;

  // For GitHub, detect the project's own repo from `git remote get-url origin`
  // and use it as the default so the user can just hit Enter.
  let defaultTarget = '';
  if (sourceType === 'github') {
    try {
      const url = execFileSync('git', ['-C', ctx.repoPath, 'remote', 'get-url', 'origin'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
      }).trim();
      // Matches https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
      const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
      if (m) defaultTarget = `${m[1]}/${m[2]}`;
    } catch {
      // not a git repo / no origin — fall through with empty default
    }
  }

  const targetInput = await text({
    message: sourceType === 'github' ? 'GitHub repositories (comma-separated owner/repo)' : 'Linear project keys (comma-separated)',
    placeholder: sourceType === 'github' ? (defaultTarget || 'owner/repo1,owner/repo2') : 'PROJ1,PROJ2',
    defaultValue: sourceType === 'github' ? defaultTarget : '',
  });
  if (isCancel(targetInput)) {
    cancel('Inbox setup cancelled.');
    return false;
  }

  // Normalize: strip whitespace and stray slashes so `owner/repo/` → `owner/repo`.
  const targets = targetInput
    .split(',')
    .map(t => t.trim().replace(/^\/+|\/+$/g, ''))
    .filter(t => t);
  if (targets.length === 0) {
    s.stop(pc.yellow('No targets provided - skipping inbox setup'));
    return false;
  }

  // Validate and subscribe to each target
  let subscribedCount = 0;
  for (const target of targets) {
    let valid = true;

    // Validate connectivity before subscribing
    if (sourceType === 'github' && ghAvailable) {
      try {
        execFileSync('gh', ['api', 'repos/' + target, '--jq', '.full_name'], {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
        });
      } catch (err) {
        const detail = (err.stderr || err.stdout || err.message || '').toString().trim().split('\n').pop();
        log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - ${detail || 'cannot access'} (check gh auth and repo name)`);
        valid = false;
      }
    } else if (sourceType === 'linear' && linearAvailable) {
      try {
        execFileSync('linear', ['project', 'list', '--json'], {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
        });
      } catch (err) {
        const detail = (err.stderr || err.stdout || err.message || '').toString().trim().split('\n').pop();
        log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - ${detail || 'cannot access Linear'}`);
        valid = false;
      }
    } else if (!ghAvailable && sourceType === 'github') {
      log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - GitHub CLI not installed`);
      valid = false;
    } else if (!linearAvailable && sourceType === 'linear') {
      log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - Linear CLI not installed`);
      valid = false;
    }

    if (valid) {
      try {
        // Call stask inbox subscribe for this target
        execFileSync(process.execPath, [
          path.resolve(ctx.repoPath, 'bin', 'stask.mjs'),
          '--project',
          ctx.slug,
          'inbox',
          'subscribe',
          sourceType,
          target,
        ], {
          encoding: 'utf-8', stdio: ['ignore', 'ignore', 'pipe'],
        });
        log.success(`  Subscribed to ${pc.bold(sourceType)}: ${pc.bold(target)}`);
        subscribedCount++;
      } catch (err) {
        const errStr = ((err.stderr || err.stdout || err.message || '') + '').trim();
        if (errStr.includes('already exists') || errStr.includes('Active subscription')) {
          log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - already subscribed`);
        } else {
          log.warn(`  ${pc.yellow('Skip')} ${pc.dim(target)} - ${errStr.split('\n').pop() || `subscribe failed (exit ${err.status ?? '?'})`}`);
        }
      }
    }
  }

  // Configure cron job for pollerd if we subscribed to anything. Register via
  // the openclaw CLI rather than writing jobs.json directly — same race/
  // clobber hazard as the other cron entry points.
  if (subscribedCount > 0) {
    try {
      const cronExpr = sourceType === 'linear' ? '*/15 * * * *' : '*/5 * * * *';
      cronUpsert({
        agentId: ctx.slug,
        name: 'inbox-pollerd',
        cronExpr,
        description: 'Inbox polling daemon for GitHub/Linear events',
        message: `Run: stask --project ${ctx.slug} inbox poll`,
        timeoutSeconds: 300,
      });
      s.stop(`${pc.green('\u2713')} Inbox configured: ${subscribedCount} subscription(s), cron job registered`);
    } catch (err) {
      s.stop(`${pc.green('\u2713')} Inbox configured: ${subscribedCount} subscription(s), ${pc.yellow('cron config failed')}`);
      log.warn(`  ${pc.dim('Cron setup error: ' + err.message)}`);
    }
  } else {
    s.stop(pc.yellow('No valid subscriptions created'));
  }

  return subscribedCount > 0;
}

/**
 * Ensure the list's hidden comment-thread channel (C-prefix mirror of the
 * F-prefix list ID) is "activated".
 *
 * Slack only materializes the comment-thread channel for a list once a
 * human has opened a row's comment thread in the Slack UI. Until that
 * happens, attempts to create thread anchors via the API time out with
 * either `channel_not_found` (channel doesn't exist) or "thread not
 * visible in history" (channel exists but Slack doesn't auto-create the
 * per-row anchor). Once any thread is opened by a human, the channel
 * flips to a state where subsequent rows with the bot as assignee get
 * Slackbot-fired anchors automatically — that's the regime stask
 * normally needs.
 *
 * This step is the one-time-per-list manual handshake. It:
 *   1. Skips itself if the C-channel already has at least one anchor
 *      (idempotent — safe to re-run partial setup).
 *   2. Otherwise creates a "warmup" row owned by the lead, prompts the
 *      user to open it and post any message, polls for the anchor, and
 *      deletes the warmup row.
 */
export async function stepActivateListChannel(s, ctx) {
  const listId = ctx.listId;
  if (!listId) {
    log.warn(pc.yellow('No listId on ctx — skipping list channel activation.'));
    return;
  }
  if (!ctx.leadToken) {
    log.warn(pc.yellow('No leadToken on ctx — skipping list channel activation.'));
    return;
  }
  const channelId = listId.replace(/^F/, 'C');

  // Direct Slack API helpers using ctx.leadToken — bypasses lib/env.mjs's
  // global config.slackToken which isn't reliably populated mid-wizard.
  // Match shape and error handling of lib/slack-api.mjs.
  const headers = { 'Authorization': `Bearer ${ctx.leadToken}`, 'Content-Type': 'application/json; charset=utf-8' };
  const slackPostJson = async (method, body) => {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    return r.json();
  };
  const slackGetHistory = async (ch) => {
    const qs = new URLSearchParams({ channel: ch, limit: '1' });
    const r = await fetch(`https://slack.com/api/conversations.history?${qs}`, {
      method: 'GET', headers: { 'Authorization': `Bearer ${ctx.leadToken}` },
    });
    return r.json();
  };

  // Idempotency: if any message already exists in the C-channel, the
  // channel is already activated — skip the manual prompt.
  s.start('Checking list channel activation...');
  try {
    const hist = await slackGetHistory(channelId);
    if (hist.ok && (hist.messages || []).length > 0) {
      s.stop(`${pc.green('\u2713')} List comment thread channel already activated`);
      return;
    }
    // hist.ok=false with channel_not_found is expected on a fresh list.
  } catch (err) {
    log.warn(`  ${pc.yellow('Activation check')} ${pc.dim(err.message || String(err))}`);
  }
  s.stop('List channel needs one-time activation');

  // Resolve column IDs + lead user ID for the warmup row.
  const staskConfig = JSON.parse(fs.readFileSync(ctx.staskConfigPath, 'utf-8'));
  const COLS = staskConfig.slack?.columns || {};
  const leadName = Object.entries(staskConfig.agents || {}).find(([, v]) => v.role === 'lead')?.[0];
  const leadUserId = leadName ? staskConfig.agents[leadName]?.slackUserId : null;
  if (!COLS.name || !COLS.assignee || !leadUserId) {
    log.warn(pc.yellow('Missing column or lead user ID — skipping activation. Bootstrap may fail.'));
    return;
  }

  s.start('Creating warmup row to activate list channel...');
  let warmupRowId = null;
  try {
    const initialFields = [
      {
        column_id: COLS.name,
        rich_text: [{
          type: 'rich_text',
          elements: [{
            type: 'rich_text_section',
            elements: [{ type: 'text', text: '🔧 Activate threads (delete me after)' }],
          }],
        }],
      },
      { column_id: COLS.assignee, user: [leadUserId] },
    ];
    const created = await slackPostJson('slackLists.items.create', {
      list_id: listId, initial_fields: initialFields,
    });
    if (!created.ok) throw new Error(created.error || 'unknown error');
    warmupRowId = created.item?.id;
    if (!warmupRowId) throw new Error('items.create returned no row id');
    s.stop(`${pc.green('\u2713')} Warmup row created`);
  } catch (err) {
    s.stop(pc.yellow(`Warmup row creation failed: ${err.message}. Skipping activation.`));
    return;
  }

  // Build the list URL so the user can click straight to it.
  let listUrl = '';
  try {
    const wsInfo = await getWorkspaceInfo(ctx.leadToken);
    listUrl = `${wsInfo.url}/lists/${wsInfo.teamId}/${listId}`;
  } catch {}

  log.info('');
  log.info(pc.bold('  One-time list activation needed:'));
  log.info('');
  log.info(`    ${pc.bold('1.')} Open the list in Slack${listUrl ? `: ${pc.cyan(listUrl)}` : ''}`);
  log.info(`    ${pc.bold('2.')} Click the comment icon on the row ${pc.cyan('"🔧 Activate threads"')}`);
  log.info(`    ${pc.bold('3.')} Type any message (e.g. ${pc.cyan('"ok"')}) and send`);
  log.info('');
  log.info(pc.dim('  This is a Slack platform requirement — done once per list.'));
  log.info('');

  // Wait for the user.
  const ready = await confirm({ message: 'Done? Press Enter to continue', initialValue: true });
  if (isCancel(ready)) cancel('Setup cancelled.');

  // Verify activation by polling the C-channel for a message.
  s.start('Verifying activation...');
  const ACTIVATION_BUDGET_MS = 30_000;
  const POLL_MS = 1_500;
  const deadline = Date.now() + ACTIVATION_BUDGET_MS;
  let activated = false;
  while (Date.now() < deadline) {
    try {
      const hist = await slackGetHistory(channelId);
      if (hist.ok && (hist.messages || []).length > 0) { activated = true; break; }
    } catch {}
    await sleep(POLL_MS);
  }

  // Best-effort cleanup of the warmup row regardless of activation outcome.
  if (warmupRowId) {
    try {
      const del = await slackPostJson('slackLists.items.delete', { list_id: listId, id: warmupRowId });
      if (!del.ok) {
        log.warn(`  ${pc.yellow('Warmup cleanup')} ${pc.dim(del.error || 'unknown')} ${pc.dim('— delete the row manually if it lingers.')}`);
      }
    } catch (err) {
      log.warn(`  ${pc.yellow('Warmup cleanup')} ${pc.dim(err.message || String(err))} ${pc.dim('— delete the row manually if it lingers.')}`);
    }
  }

  if (activated) {
    s.stop(`${pc.green('\u2713')} List channel activated`);
  } else {
    s.stop(pc.yellow('Activation not detected within 30s — proceeding anyway. If bootstrap fails, run again after sending a message in the list.'));
  }
}

/**
 * Create the bootstrap task, subtasks, and transition to To-Do.
 */
export async function stepBootstrapTask(s, ctx) {
  s.start('Creating bootstrap task...');

  // Invoke the stask CLI that's actually running (this file's package),
  // not one sitting at `<projectRepo>/bin/stask.mjs`. Otherwise a setup
  // triggered from a dev worktree / fresh install would exec an older
  // `stask create` at the project root that lacks recent fixes.
  const staskBin = path.resolve(__dirname, '../../bin/stask.mjs');
  const run = (...args) => execFileSync(process.execPath, [
    staskBin, '--project', ctx.slug, ...args,
  ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

  let taskId;

  // 1. Create the bootstrap task
  try {
    const out = run('create', '--name', 'Bootstrap: Team Explore Codebase & Set Up Agents', '--overview',
      'Bootstrap onboarding task — each agent explores the codebase, documents findings, and sets up their working environment.');
    const match = out.match(/T-\d+/);
    taskId = match?.[0];
    if (!taskId) throw new Error('Could not parse task ID from output: ' + out.trim());
  } catch (err) {
    s.stop(pc.red(`Bootstrap task creation failed: ${err.message}`));
    throw err;
  }

  // 2. Attach the bundled bootstrap spec. `shared/...` paths are resolved
  // against the stask package's templates when not present in the project
  // specsDir (see commands/spec-update.mjs).
  try {
    run('spec-update', taskId, '--spec', 'shared/specs/bootstrap-team.md');
  } catch (err) {
    s.stop(pc.red(`Bootstrap spec attach failed: ${err.message}`));
    throw err;
  }

  // 3. Transition to To-Do FIRST (subtask create requires parent in To-Do)
  try {
    run('transition', taskId, 'To-Do');
  } catch (err) {
    s.stop(pc.red(`Bootstrap transition to To-Do failed: ${err.message}`));
    throw err;
  }

  // 4. Create subtasks for each agent role (parent must be in To-Do).
  //    The lead orchestrates the parent itself — no separate "Lead:
  //    Orchestrate Bootstrap" subtask, that's redundant noise.
  const entries = Object.entries(ctx.agents);
  const workers = entries.filter(([, v]) => v.role === 'worker');
  const qaName = entries.find(([, v]) => v.role === 'qa')?.[0];

  const subtasks = [];
  if (workers[0]) subtasks.push([workers[0][0], 'Backend Exploration']);
  if (workers[1]) subtasks.push([workers[1][0], 'Frontend Exploration']);
  if (qaName) subtasks.push([qaName, 'QA Audit']);

  for (const [agent, title] of subtasks) {
    try {
      run('subtask', 'create', '--parent', taskId, '--name', title, '--assign', agent);
    } catch (err) {
      s.stop(pc.red(`Bootstrap subtask "${title}" failed: ${err.message}`));
      throw err;
    }
  }

  // 5. Build the task's native Slack URL. We use the list-record URL
  // (https://<ws>/lists/<team>/<list>?record_id=<rec>) instead of the
  // app.slack.com thread URL because the record URL opens inside the
  // Slack desktop/mobile client; the thread URL bounces through the
  // browser. Slack needs a moment to index the row id; retry briefly if
  // `stask show` hasn't reported it yet.
  let rowMatch = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const showOut = run('show', taskId);
    rowMatch = showOut.match(/Row:\s+(\S+)/);
    if (rowMatch) break;
    await sleep(2000);
  }
  if (!rowMatch) {
    const err = new Error(`Could not find Slack row id for ${taskId} after retries; stask show did not report a Row line.`);
    s.stop(pc.red(`Bootstrap task created but row lookup failed: ${err.message}`));
    throw err;
  }
  if (!ctx.wsInfo) ctx.wsInfo = await getWorkspaceInfo(ctx.leadToken);
  const [, rowId] = rowMatch;
  const listId = (() => {
    try {
      const cfgPath = path.join(ctx.repoPath, '.stask', 'config.json');
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).slack?.listId || '';
    } catch { return ''; }
  })();
  if (!listId) {
    throw new Error(`Could not read slack.listId from ${ctx.repoPath}/.stask/config.json`);
  }
  const taskThreadUrl = `${ctx.wsInfo.url}/lists/${ctx.wsInfo.teamId}/${listId}?record_id=${rowId}`;

  // 6. Store on ctx for caller
  ctx.taskThreadUrl = taskThreadUrl;

  s.stop(`${pc.green('\u2713')} Bootstrap task created: ${pc.bold(taskId)} ${pc.dim(taskThreadUrl)}`);
}
