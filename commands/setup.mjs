/**
 * stask setup — Interactive wizard to bootstrap a complete engineering team project.
 *
 * Usage: stask setup [path]
 *        stask setup [path] --only channel,list,canvas,bookmark,welcome,skills,cron,openclaw,verify,inbox
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  intro, outro, text, confirm, select, spinner, note, cancel, isCancel, log, pc, link, dimPath, fmtModel,
  clearScreen, showProgress, showCopyable,
} from '../lib/setup/prompt.mjs';
import { scaffoldWorkspace, seedWorkspaceState } from '../lib/setup/template.mjs';
import { loadSetupState, saveSetupState, clearSetupState, createState, completeStep, isStepDone } from '../lib/setup/state.mjs';
import { verifyToken } from '../lib/setup/slack-manifest.mjs';
import { getAgentDirPath } from '../lib/setup/agent-dir.mjs';
import { writeSlackIdsToConfig } from '../lib/setup/slack-list.mjs';
import { registerAgents } from '../lib/setup/openclaw-config.mjs';
import { setupCronJobs } from '../lib/setup/cron-setup.mjs';
import { getSkillCount } from '../lib/setup/skills.mjs';
import { initProject } from './init.mjs';
import { loadManifests, getRoles, getLeadRole, generateSlackManifest } from '../lib/setup/manifest.mjs';
import { configGet, readRawSecret } from '../lib/setup/openclaw-cli.mjs';
// NOTE: ./event-daemon.mjs imports lib/env.mjs at the top level, which calls
// resolveProjectRoot() and fails with "No stask project found" when run from a
// directory without .stask/. Setup is supposed to bypass that resolution
// entirely (it's in NO_PROJECT_COMMANDS in bin/stask.mjs). Load these lazily
// inside the function body so importing this module does not eagerly trigger
// project resolution.

// Shared step functions — used by both full wizard and --only partial mode
import {
  stepChannel, stepList, stepCanvas, stepBookmarks, stepWelcome, stepActivateListChannel,
  stepSkills, stepCron, stepOpenclaw, stepInstall, stepInbox, stepClaudeSubagents,
  stepBootstrapTask,
  buildContext, getWorkspaceInfo,
} from '../lib/setup/steps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../templates/team');
const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

const STEPS = ['Project', 'Team', 'Models', 'Build', 'Slack Apps', 'Slack Setup', 'Register', 'Install'];

// Load manifests from template directory — the source of truth for team config
const { team: TEAM_MANIFEST, agents: AGENT_MANIFESTS } = loadManifests(TEMPLATE_DIR);
const ROLES = getRoles(AGENT_MANIFESTS);
const LEAD_ROLE = getLeadRole(AGENT_MANIFESTS);

function bail(msg) { cancel(msg); process.exit(0); }
function guard(v, msg) { if (isCancel(v)) bail(msg || 'Setup cancelled.'); return v; }
function phase(i) { showProgress(STEPS, i, STEPS[i]); intro(pc.bold(STEPS[i])); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function validateAgentName(v) { if (!v) return 'Required'; if (!/^[a-z0-9-]+$/i.test(v)) return 'Letters, numbers, and hyphens only'; }

export async function run(args) {
  // ── Parse args ────────────────────────────────────────────────
  let argPath = null;
  let onlySteps = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) {
      onlySteps = new Set(args[i + 1].split(',').map((s) => s.trim()));
      i++;
    } else if (!args[i].startsWith('--')) {
      argPath = args[i];
    }
  }

  let detectedRepoPath = null;
  let detectedProjectName = null;

  if (argPath) {
    const resolved = path.resolve(argPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      detectedRepoPath = resolved;
      detectedProjectName = path.basename(resolved);
    }
  }

  // ── Partial mode ─────────────────────────────────────────────
  if (onlySteps) {
    return runPartial({ onlySteps, detectedRepoPath });
  }

  // ── Full setup wizard ────────────────────────────────────────
  clearScreen();
  intro(pc.bold('stask setup') + pc.dim(' — Engineering Team Wizard'));

  const s = spinner();

  // Prerequisites
  if (!fs.existsSync(OPENCLAW_HOME)) {
    log.error(`OpenClaw not found. Install first:\n  ${link('OpenClaw Docs', 'https://docs.openclaw.ai/start/getting-started')}`);
    process.exit(1);
  }

  let ghUser, ghName;
  try {
    const out = execFileSync('gh', ['api', 'user', '--jq', '.login + "\\n" + .name'], { encoding: 'utf-8', timeout: 10000 }).trim();
    [ghUser, ghName] = out.split('\n');
    ghName = ghName || '';
  } catch {
    log.error(`GitHub CLI required.\n  Install: ${link('GitHub CLI', 'https://cli.github.com')}\n  Then: ${pc.cyan('gh auth login')}`);
    process.exit(1);
  }

  log.success(`${pc.bold(ghName)} ${pc.dim(`(${ghUser})`)}`);
  log.info(pc.dim('Prerequisites OK\n'));
  await sleep(600);

  // ═══ PHASE 0 — Project Basics ═══
  phase(0);
  log.info(pc.dim('We\'ll create an OpenClaw workspace, 4 AI agents, connect them to Slack,'));
  log.info(pc.dim('and set up a stask project to track tasks.\n'));

  const projectName = guard(await text({ message: 'Project name', placeholder: 'my-saas', initialValue: detectedProjectName || '', validate: (v) => !v ? 'Required' : undefined }));
  const projectSlug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const absRepoPath = guard(await text({ message: 'Repo path', initialValue: detectedRepoPath || '', validate: (v) => { if (!v) return 'Required'; if (!fs.existsSync(path.resolve(v))) return 'Path does not exist'; } })).trim();
  const resolvedRepoPath = path.resolve(absRepoPath);

  const existingState = loadSetupState(projectSlug);
  let state;
  if (existingState) {
    const resume = guard(await confirm({ message: 'Found incomplete setup. Resume?' }));
    state = resume ? existingState : createState(projectSlug);
  } else {
    state = createState(projectSlug);
  }

  const humanName = guard(await text({ message: 'Your name', initialValue: ghName }));
  const humanGithub = guard(await text({ message: 'GitHub username', initialValue: ghUser }));
  Object.assign(state.data, { projectName, projectSlug, repoPath: resolvedRepoPath, humanName, humanGithub });
  completeStep(state, 'basics');

  process.on('SIGINT', () => {
    saveSetupState(state.projectSlug, state);
    console.log(`\n\n  ${pc.yellow('Interrupted.')} Run ${pc.cyan('stask setup')} to resume.\n`);
    process.exit(0);
  });

  // ═══ PHASE 1 — Team Naming ═══
  if (!isStepDone(state, 'team')) {
    phase(1);
    log.info(pc.dim(`Your team has ${ROLES.length} agents. Give them names \u2014 these become their`));
    log.info(pc.dim('Slack identities and workspace directories. Theme them!\n'));

    if (!state.data.agents) state.data.agents = {};
    for (const role of ROLES) {
      if (!state.data.agents[role.id]) state.data.agents[role.id] = {};
      if (!state.data.agents[role.id].name) {
        state.data.agents[role.id].name = guard(await text({
          message: `${role.title} \u2014 ${role.description}`,
          placeholder: `e.g. ${role.id}`,
          validate: validateAgentName,
        })).toLowerCase();
      }
    }

    // Backward compat: populate top-level name fields from agents map
    for (const role of ROLES) {
      state.data[`${role.id}Name`] = state.data.agents[role.id].name;
    }

    const names = ROLES.map(r => state.data.agents[r.id].name);
    if (new Set(names).size !== names.length) bail('Agent names must be unique.');
    completeStep(state, 'team');
  }

  // ═══ PHASE 2 — Model Assignment ═══
  if (!isStepDone(state, 'models')) {
    phase(2);
    log.info(pc.dim('Each agent runs on an Ollama model optimized for their role.\n'));

    const modelLines = ROLES.map(role => {
      const m = AGENT_MANIFESTS[role.id].model;
      return `${pc.bold(role.title.padEnd(12))} ${fmtModel(m.primary)}  ${pc.dim('fallbacks:')} ${(m.fallbacks || []).map(fmtModel).join(pc.dim(', '))}`;
    });
    note(modelLines.join('\n'), 'Recommended models');

    const useDefaults = guard(await confirm({ message: 'Use these models?' }));
    for (const role of ROLES) {
      const m = AGENT_MANIFESTS[role.id].model;
      if (useDefaults) {
        state.data.agents[role.id].model = m.primary;
      } else {
        state.data.agents[role.id].model = guard(await text({ message: `${role.title} model`, initialValue: m.primary }));
      }
      state.data.agents[role.id].fallbacks = m.fallbacks || [];
      // Backward compat
      state.data[`${role.id}Model`] = state.data.agents[role.id].model;
      state.data[`${role.id}Fallbacks`] = state.data.agents[role.id].fallbacks;
    }
    completeStep(state, 'models');
  }

  const d = state.data;

  // ═══ PHASE 3 — Build (Workspace + Agent Dirs + Skills) ═══
  if (!isStepDone(state, 'build')) {
    phase(3);
    log.info(pc.dim('Creating workspace files, agent directories, and installing skills.\n'));

    const targetDir = path.join(OPENCLAW_HOME, `workspace-${d.projectSlug}`);
    if (fs.existsSync(targetDir)) {
      const overwrite = guard(await confirm({ message: 'Workspace exists. Overwrite?', initialValue: false }));
      if (!overwrite) bail('Aborted.');
      fs.rmSync(targetDir, { recursive: true });
    }

    s.start('Scaffolding workspace...');
    const placeholders = buildPlaceholders(d);
    const dirRenames = {};
    for (const role of ROLES) dirRenames[role.id] = d.agents[role.id].name;
    const wsResult = scaffoldWorkspace({ templateDir: TEMPLATE_DIR, targetDir, placeholders, dirRenames });
    for (const role of ROLES) {
      seedWorkspaceState(path.join(targetDir, d.agents[role.id].name));
    }
    s.stop(`${pc.bold(wsResult.filesCreated)} workspace files created`);

    // Agent directories + models.json are created later by `openclaw agents add`
    // in stepOpenclaw; no pre-creation needed here.

    // Skills — pass manifests so skills.mjs reads from them
    const skillAgents = ROLES.map(role => ({ name: d.agents[role.id].name, role: role.id }));
    const tmpAgents = {};
    for (const { name, role } of skillAgents) tmpAgents[name] = { role };
    await stepSkills(s, { slug: d.projectSlug, agents: tmpAgents }, skillAgents, { teamManifest: TEAM_MANIFEST, agentManifests: AGENT_MANIFESTS });

    completeStep(state, 'build');
  }

  // ═══ PHASE 4 — Slack App Installation ═══
  if (!isStepDone(state, 'slack')) {
    if (!d.slackAccounts) d.slackAccounts = {};

    const slackRoles = ROLES.map(role => ({
      name: d.agents[role.id].name,
      roleId: role.id,
      displayName: role.id === LEAD_ROLE.id
        ? `${capitalize(d.agents[role.id].name)} (${role.title})`
        : capitalize(d.agents[role.id].name),
    }));

    for (const { name, roleId, displayName } of slackRoles) {
      if (d.slackAccounts[name]) continue;

      phase(4);
      const done = Object.keys(d.slackAccounts).length;
      log.info(pc.dim('Each agent needs its own Slack app for independent messaging.\n'));
      log.info(`Setting up app ${pc.bold(`${done + 1}`)} of ${pc.bold(String(ROLES.length))}: ${pc.bold(capitalize(name))} ${pc.dim(`(${roleId})`)}\n`);

      const manifest = generateSlackManifest(AGENT_MANIFESTS[roleId], capitalize(name));
      await showCopyable(manifest, `Manifest for ${pc.bold(capitalize(name))}`, `${name}-manifest.json`);

      log.info([
        '',
        `${pc.bold('1.')} Open ${link('Slack Apps', 'https://api.slack.com/apps')} ${pc.dim('\u2192')} ${pc.cyan('"Create New App" \u2192 "From an app manifest"')}`,
        `${pc.bold('2.')} Select your workspace and paste (it's on your clipboard)`,
        `${pc.bold('3.')} Create & install the app`,
        `${pc.bold('4.')} Copy ${pc.bold('Bot Token')} from ${pc.cyan('OAuth & Permissions \u2192 Bot User OAuth Token')}`,
        `${pc.bold('5.')} Create ${pc.bold('App Token')} at ${pc.cyan('Basic Information \u2192 App-Level Tokens')}`,
        `     ${pc.dim('Click "Generate Token", add')} ${pc.cyan('connections:write')} ${pc.dim('scope, copy it')}`,
        '',
      ].join('\n'));

      const botToken = guard(await text({ message: 'Bot Token', placeholder: 'xoxb-...', validate: (v) => !v?.startsWith('xoxb-') ? 'Must start with xoxb-' : undefined }));
      const appToken = guard(await text({ message: 'App Token', placeholder: 'xapp-...', validate: (v) => !v?.startsWith('xapp-') ? 'Must start with xapp-' : undefined }));

      s.start('Verifying token...');
      const result = await verifyToken(botToken);
      if (!result.ok) { s.stop(pc.red(`Failed: ${result.error}`)); bail('Fix the token and re-run to resume.'); }
      s.stop(`${pc.green('\u2713')} ${pc.bold(capitalize(name))} verified ${pc.dim(`(${result.userId})`)}`);

      d.slackAccounts[name] = { botToken, appToken, userId: result.userId, botName: result.botName };
      saveSetupState(state.projectSlug, state);
    }
    completeStep(state, 'slack');
  }

  // ═══ PHASE 5 — Slack Setup (channel + list + canvas + bookmarks + welcome) ═══
  if (!isStepDone(state, 'slackSetup')) {
    phase(5);
    log.info(pc.dim('Creating your project channel and task board automatically.\n'));

    const leadToken = d.slackAccounts[d.agents[LEAD_ROLE.id].name]?.botToken;

    // Human Slack user ID
    d.humanSlackUserId = guard(await text({
      message: 'Your Slack user ID (Profile \u2192 \u22ee \u2192 Copy member ID)',
      placeholder: 'U0XXXXXXXXX',
      validate: (v) => (!v || !v.startsWith('U')) ? 'Must start with U' : undefined,
    }));

    // Build context for shared step functions
    const staskAgents = {};
    for (const role of ROLES) {
      const name = d.agents[role.id].name;
      // Map manifest roles to stask roles: lead stays lead, qa stays qa, everything else is worker
      const staskRole = role.id === 'lead' ? 'lead' : role.id === 'qa' ? 'qa' : 'worker';
      staskAgents[name] = { role: staskRole, slackUserId: d.slackAccounts[name]?.userId };
    }

    const ctx = {
      slug: d.projectSlug,
      repoPath: d.repoPath,
      leadToken,
      channelId: '',
      listId: '',
      canvasId: '',
      humanUserId: d.humanSlackUserId,
      agents: staskAgents,
      allUserIds: [...Object.values(d.slackAccounts).map((a) => a.userId), d.humanSlackUserId].filter(Boolean),
      staskConfigPath: path.join(d.repoPath, '.stask', 'config.json'),
    };

    // Channel
    const channelChoice = guard(await select({
      message: 'Project Slack channel',
      options: [
        { value: 'create', label: `Create #${d.projectSlug}-project`, hint: 'New channel with all agents invited' },
        { value: 'existing', label: 'Use an existing channel', hint: 'I already have a channel' },
      ],
    }));

    if (channelChoice === 'existing') {
      ctx.channelId = guard(await text({ message: 'Channel ID', placeholder: 'C0XXXXXXXXX', validate: (v) => (!v || !v.startsWith('C')) ? 'Must start with C' : undefined }));
    } else {
      await stepChannel(s, ctx);
    }
    d.slackChannelId = ctx.channelId;

    // List
    const listChoice = guard(await select({
      message: 'Project task board (Slack List)',
      options: [
        { value: 'create', label: 'Create new List', hint: 'Auto-creates all 14 columns + status/type options' },
        { value: 'existing', label: 'Use an existing List', hint: 'I already have a Slack List' },
        { value: 'skip', label: 'Skip for now', hint: 'I\'ll set it up later' },
      ],
    }));

    if (listChoice === 'existing') {
      ctx.listId = guard(await text({ message: 'List ID', placeholder: 'F0XXXXXXXXX', validate: (v) => (!v || !v.startsWith('F')) ? 'List ID starts with F' : undefined }));
      d.slackListId = ctx.listId;
    } else if (listChoice === 'create') {
      await stepList(s, ctx);
      d.slackListId = ctx.listId;
      d.slackListColumns = ctx.listColumns;
      d.slackListStatusOptions = ctx.listStatusOptions;
      d.slackListTypeOptions = ctx.listTypeOptions;
      d.slackListSpecApprovedOptions = ctx.listSpecApprovedOptions;
      d.slackListAutoConfigured = true;
    } else {
      d.slackListId = '';
    }

    // Canvas → Bookmarks. Bootstrap task + welcome are deferred to the
    // Register phase — they need the project registered in ~/.stask/projects.json
    // first (otherwise `stask --project <slug> create` fails with "Unknown project").
    await stepCanvas(s, ctx);
    d.canvasId = ctx.canvasId;

    await stepBookmarks(s, ctx);

    saveSetupState(state.projectSlug, state);
    completeStep(state, 'slackSetup');
  }

  // ═══ PHASE 6 — Inbox Setup (GitHub/Linear polling) ═══
  if (!isStepDone(state, 'inbox')) {
    phase(6);
    log.info(pc.dim('Setting up inbox subscriptions for GitHub/Linear event polling.\n'));

    // Build staskAgents independently (may not be in scope if slackSetup was already done)
    const inboxAgents = {};
    for (const role of ROLES) {
      const name = d.agents[role.id].name;
      const staskRole = role.id === 'lead' ? 'lead' : role.id === 'qa' ? 'qa' : 'worker';
      inboxAgents[name] = { role: staskRole, slackUserId: d.slackAccounts[name]?.userId };
    }

    const inboxCtx = buildContext({
      staskConfig: { agents: inboxAgents, human: { slackUserId: d.humanSlackUserId }, slack: { listId: d.slackListId } },
      slug: d.projectSlug, repoPath: d.repoPath, leadToken: d.slackAccounts[d.agents[LEAD_ROLE.id].name]?.botToken,
    });

    await stepInbox(s, inboxCtx);

    saveSetupState(state.projectSlug, state);
    completeStep(state, 'inbox');
  }

  // ═══ PHASE 7 — Register Everything ═══
  if (!isStepDone(state, 'register')) {
    phase(7);
    log.info(pc.dim('Registering agents, setting up cron jobs, and initializing the project.\n'));

    const workspaceBase = path.join(OPENCLAW_HOME, `workspace-${d.projectSlug}`);

    // openclaw.json
    const agentModels = {};
    for (const role of ROLES) {
      const name = d.agents[role.id].name;
      agentModels[name] = { model: d.agents[role.id].model, fallbacks: d.agents[role.id].fallbacks || [] };
    }

    const staskAgents = {};
    for (const role of ROLES) {
      const name = d.agents[role.id].name;
      const staskRole = role.id === 'lead' ? 'lead' : role.id === 'qa' ? 'qa' : 'worker';
      staskAgents[name] = { role: staskRole, slackUserId: d.slackAccounts[name]?.userId || 'UXXXXXXXXXX' };
    }

    const regCtx = buildContext({
      staskConfig: { agents: staskAgents, human: { slackUserId: d.humanSlackUserId }, slack: { listId: d.slackListId } },
      slug: d.projectSlug, repoPath: d.repoPath, leadToken: d.slackAccounts[d.agents[LEAD_ROLE.id].name]?.botToken,
    });

    await stepOpenclaw(s, regCtx, agentModels, TEAM_MANIFEST, d.slackAccounts);
    await stepCron(s, regCtx, AGENT_MANIFESTS);

    // Pass manifest roleIds (lead/backend/frontend/qa) — the Claude skill
    // list is keyed by manifest role, not the stask role (worker collapses
    // backend+frontend).
    const claudeAgentRoles = ROLES.map((role) => ({
      name: d.agents[role.id].name,
      roleId: role.id,
    }));
    await stepClaudeSubagents(s, regCtx, {
      projectName: d.projectName,
      humanName: d.humanName,
      manifests: { teamManifest: TEAM_MANIFEST, agentManifests: AGENT_MANIFESTS },
      agentRoles: claudeAgentRoles,
    });

    // stask project init
    s.start('Initializing stask project...');
    const staskDir = path.join(d.repoPath, '.stask');
    if (!fs.existsSync(path.join(staskDir, 'config.json'))) {
      initProject({
        name: d.projectSlug, repoPath: d.repoPath,
        configOverrides: {
          human: { name: d.humanName, githubUsername: d.humanGithub, slackUserId: d.humanSlackUserId || 'UXXXXXXXXXX' },
          agents: staskAgents,
        },
        staskDefaults: TEAM_MANIFEST.stask,
      });
    }

    // Patch listId + (when available) real column/option IDs into the fresh config.
    // writeSlackIdsToConfig only rewrites keys the template declared, so passing {}
    // for columns on the 'existing' path is a safe no-op on those fields.
    if (d.slackListId || d.slackChannelId) {
      writeSlackIdsToConfig(path.join(staskDir, 'config.json'), {
        listId: d.slackListId,
        channelId: d.slackChannelId,
        columns: d.slackListColumns || {},
        statusOptions: d.slackListStatusOptions || {},
        typeOptions: d.slackListTypeOptions || {},
        specApprovedOptions: d.slackListSpecApprovedOptions || {},
      });
    }

    // Slack token in central config
    const centralConfig = path.join(process.env.HOME || '', '.stask', 'config.json');
    let central = {};
    if (fs.existsSync(centralConfig)) { try { central = JSON.parse(fs.readFileSync(centralConfig, 'utf-8')); } catch {} }
    if (!central.projects) central.projects = {};
    if (!central.projects[d.projectSlug]) central.projects[d.projectSlug] = {};
    const leadAgentName = d.agents[LEAD_ROLE.id].name;
    central.projects[d.projectSlug].slackToken = d.slackAccounts[leadAgentName]?.botToken || '';
    fs.mkdirSync(path.dirname(centralConfig), { recursive: true });
    fs.writeFileSync(centralConfig, JSON.stringify(central, null, 2) + '\n');
    s.stop(`stask project initialized`);

    // DB init
    s.start('Initializing database...');
    try {
      execFileSync(process.execPath, [
        path.resolve(__dirname, '../bin/stask.mjs'), '--project', d.projectSlug, 'list', '--json',
      ], { encoding: 'utf-8', timeout: 10000, env: { ...process.env, STASK_NO_DAEMON: '1' } });
      s.stop('Database ready');
    } catch { s.stop(pc.dim('Database will initialize on first command')); }

    // Bootstrap task + welcome message. Deferred here so the project is
    // registered before `stask create` runs, and so the welcome CTA can
    // link to the freshly-created task (see slack-canvas.mjs CTA branch).
    const postRegisterCtx = buildContext({
      staskConfig: { agents: staskAgents, human: { slackUserId: d.humanSlackUserId }, slack: { listId: d.slackListId, channelId: d.slackChannelId } },
      slug: d.projectSlug, repoPath: d.repoPath, leadToken: d.slackAccounts[d.agents[LEAD_ROLE.id].name]?.botToken,
    });
    postRegisterCtx.canvasId = d.canvasId;
    await stepActivateListChannel(s, postRegisterCtx);
    await stepBootstrapTask(s, postRegisterCtx);
    await stepWelcome(s, postRegisterCtx);

    completeStep(state, 'register');
  }

  // ═══ PHASE 7 — Install ═══
  phase(7);
  log.info(pc.dim('Running install verification checks...\n'));

  const installCtx = buildContext({
    staskConfig: { agents: {}, human: {}, slack: { listId: d.slackListId, channelId: d.slackChannelId } },
    slug: d.projectSlug, repoPath: d.repoPath, leadToken: '',
  });
  installCtx.canvasId = d.canvasId;
  // Reload agents for install checks
  const leadName = d.leadName;
  installCtx.agents[d.leadName] = { role: 'lead' };
  stepInstall(installCtx);

  // ─── Start event daemon ───────────────────────────────────────────
  // Requires: lead's xapp- token stored in openclaw.json (Phase 4).
  // Verifies the socket connection emits 'connected' before continuing.
  if (!process.env.STASK_SKIP_EVENT_DAEMON) {
    s.start('Starting Slack Socket Mode event daemon...');
    try {
      // Lazy import — see comment near the top of this file.
      const { startDaemon: startEventDaemon } = await import('./event-daemon.mjs');
      const { installPersistence: installEventDaemonPersistence } = await import('../lib/setup/event-daemon-persist.mjs');
      const eventDaemonPid = startEventDaemon();
      // Give the daemon up to 8 seconds to connect and write a 'connected' log line
      const staskDir = path.join(d.repoPath || process.cwd(), '.stask');
      const logFile = path.join(staskDir, 'logs', 'event-daemon.log');
      const WAIT_MS = 8000;
      const POLL_MS = 300;
      const deadline = Date.now() + WAIT_MS;
      let connected = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_MS));
        try {
          const content = fs.readFileSync(logFile, 'utf-8');
          if (content.includes('Socket Mode connected') || content.includes('daemon is live')) {
            connected = true;
            break;
          }
        } catch (_) {}
        if (connected) break;
      }
      if (connected) {
        s.stop(pc.green(`Event daemon connected (PID ${eventDaemonPid})`));
      } else {
        s.stop(pc.yellow(`Event daemon started (PID ${eventDaemonPid}) — connection not confirmed within ${WAIT_MS / 1000}s. Check: stask event-daemon logs`));
      }

      // Install OS-level persistence (launchd on macOS, systemd on Linux)
      s.start('Installing event daemon persistence...');
      try {
        const staskHome = path.join(d.repoPath || process.cwd(), '.stask');
        const daemonScript = path.resolve(__dirname, '../bin/stask-event-daemon.mjs');
        const persist = installEventDaemonPersistence({
          nodeExecPath: process.execPath,
          daemonScript,
          staskHome,
          slug: d.projectSlug,
        });
        s.stop(persist.ok ? pc.green(persist.message) : pc.yellow(persist.message));
      } catch (err) {
        s.stop(pc.yellow(`Persistence install failed: ${err.message}. Daemon will not auto-start on reboot.`));
      }
    } catch (err) {
      s.stop(pc.yellow(`Event daemon failed to start: ${err.message}. Run manually: stask event-daemon start`));
    }
  } else {
    log.info(pc.dim('Skipping event daemon start (STASK_SKIP_EVENT_DAEMON).'));
  }

  // OpenClaw restart
  console.log('');
  if (process.env.STASK_SKIP_GATEWAY_RESTART) {
    log.info(pc.dim('Skipping gateway restart (STASK_SKIP_GATEWAY_RESTART).'));
  } else {
    const shouldRestart = guard(await confirm({ message: 'Restart OpenClaw gateway to load your new agents?' }));
    if (shouldRestart) {
      s.start('Restarting OpenClaw gateway...');
      try {
        execFileSync('openclaw', ['gateway', 'restart'], { encoding: 'utf-8', timeout: 15000 });
        s.stop(pc.green('Gateway restarted \u2014 agents are live!'));
      } catch { s.stop(pc.yellow('Restart failed \u2014 run manually: openclaw gateway restart')); }
    } else {
      log.info(pc.dim('Run manually when ready: openclaw gateway restart'));
    }
  }

  // Done
  showProgress(STEPS, STEPS.length, 'Done');
  const wsPath = path.join(OPENCLAW_HOME, `workspace-${d.projectSlug}`);
  const ROLE_COLORS_PC = { lead: pc.cyan, backend: pc.green, frontend: pc.magenta, qa: pc.yellow };
  const teamLines = ROLES.map(role => {
    const name = d.agents[role.id].name;
    const model = d.agents[role.id].model;
    const colorFn = ROLE_COLORS_PC[role.id] || pc.dim;
    return `  ${colorFn('\u25cf')} ${pc.bold(name)} ${pc.dim(`(${role.id})`)}  ${fmtModel(model)}`;
  });
  note([
    `${pc.bold('Project')}    ${d.projectName} ${pc.dim(`(${d.projectSlug})`)}`,
    `${pc.bold('Workspace')}  ${dimPath(wsPath)}`,
    `${pc.bold('Repo')}       ${dimPath(d.repoPath)}`,
    `${pc.bold('Channel')}    ${pc.cyan('#' + d.projectSlug + '-project')} ${pc.dim(d.slackChannelId || '')}`,
    '',
    `${pc.bold('Team:')}`,
    ...teamLines,
  ].join('\n'), 'Setup Complete');

  log.info([
    pc.bold('Your team is ready:'),
    '',
    `  ${pc.bold('1.')} Review the bootstrap task spec and approve it to start onboarding`,
    `  ${pc.bold('2.')} Then DM each team member to bootstrap them too`,
    `  ${pc.bold('3.')} Describe a feature to the Lead and watch the team handle it`,
  ].join('\n'));

  clearSetupState(d.projectSlug);
  outro(pc.green('Happy building! \u{1f680}'));
}

// ─── Partial Mode ────────────────────────────────────────────────

/**
 * Find the bootstrap task (first task in the project) and return its Slack
 * thread URL, or '' if none is available. Used by partial welcome mode so
 * the welcome CTA can reference the task created in an earlier run.
 */
async function resolveBootstrapTaskThread({ repoPath, slug, leadToken }) {
  // Invoke the stask CLI that's actually running, not one sitting next to
  // the user's repo. `import.meta.url` points to this file inside whichever
  // stask install the user launched (global npm install or local checkout),
  // so bin/stask.mjs next to it is always the right binary.
  const staskBin = path.resolve(__dirname, '..', 'bin', 'stask.mjs');
  const run = (...args) => execFileSync(process.execPath, [staskBin, '--project', slug, ...args], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Find the most likely bootstrap task. Try T-001 first, then fall back to
  // the earliest task listed in the project.
  let taskId = 'T-001';
  let showOut;
  try {
    showOut = run('show', taskId);
  } catch (err) {
    const detail = ((err.stderr || err.stdout || err.message || '') + '').trim();
    log.warn(`  ${pc.yellow('Welcome lookup')} ${taskId} show failed: ${pc.dim(detail.split('\n').pop() || 'unknown')}`);
    try {
      const list = run('list', '--json');
      const rows = JSON.parse(list);
      const first = Array.isArray(rows) ? rows[0] : null;
      const firstId = first?.['Task ID'] || first?.id;
      if (!firstId) {
        log.warn(`  ${pc.yellow('Welcome lookup')} no tasks found in project ${pc.dim(slug)}`);
        return '';
      }
      taskId = firstId;
      showOut = run('show', taskId);
    } catch (listErr) {
      const detail = ((listErr.stderr || listErr.stdout || listErr.message || '') + '').trim();
      log.warn(`  ${pc.yellow('Welcome lookup')} list fallback failed: ${pc.dim(detail.split('\n').pop() || 'unknown')}`);
      return '';
    }
  }

  const rowMatch = showOut.match(/Row:\s+(\S+)/);
  if (!rowMatch) {
    log.warn(`  ${pc.yellow('Welcome lookup')} ${taskId} has no Slack row id yet. Create it first with: ${pc.cyan(`stask --project ${slug} create`)}`);
    return '';
  }

  try {
    const { getWorkspaceInfo } = await import('../lib/setup/steps.mjs');
    const wsInfo = await getWorkspaceInfo(leadToken);
    const [, rowId] = rowMatch;
    const staskConfig = JSON.parse(fs.readFileSync(path.join(repoPath, '.stask', 'config.json'), 'utf-8'));
    const listId = staskConfig.slack?.listId;
    if (!listId) {
      log.warn(`  ${pc.yellow('Welcome lookup')} slack.listId missing from .stask/config.json`);
      return '';
    }
    return `${wsInfo.url}/lists/${wsInfo.teamId}/${listId}?record_id=${rowId}`;
  } catch (err) {
    log.warn(`  ${pc.yellow('Welcome lookup')} workspace info failed: ${pc.dim(err.message || 'unknown')}`);
    return '';
  }
}

async function runPartial({ onlySteps, detectedRepoPath }) {
  clearScreen();
  intro(pc.bold('stask setup') + pc.dim(' \u2014 Partial Mode'));

  const s = spinner();
  const repoPath = detectedRepoPath || process.cwd();
  const staskConfigPath = path.join(repoPath, '.stask', 'config.json');

  if (!fs.existsSync(staskConfigPath)) {
    log.error(`No .stask/config.json found at ${repoPath}. Run full setup first.`);
    process.exit(1);
  }

  const staskConfig = JSON.parse(fs.readFileSync(staskConfigPath, 'utf-8'));
  const slug = staskConfig.project;

  // Find lead token by reading openclaw.json directly. readRawSecret bypasses
  // the CLI's automatic redaction (`openclaw config get` returns
  // "__OPENCLAW_REDACTED__" for bot tokens). Read-only, no gateway race.
  const leadName = Object.entries(staskConfig.agents || {}).find(([, v]) => v.role === 'lead')?.[0];
  const leadToken = leadName
    ? readRawSecret(`channels.slack.accounts.${leadName}.botToken`)
    : undefined;

  if (!leadToken) {
    log.error('Could not find lead agent token. Ensure Slack apps are configured.');
    process.exit(1);
  }

  // Build shared context
  const ctx = buildContext({ staskConfig, slug, repoPath, leadToken });

  log.info(`Project: ${pc.bold(slug)}  Lead: ${pc.bold(leadName)}`);
  log.info(`Steps: ${pc.cyan([...onlySteps].join(', '))}\n`);

  const validSteps = ['channel', 'list', 'canvas', 'bookmark', 'welcome', 'skills', 'cron', 'openclaw', 'install', 'inbox', 'claude', 'bootstrap'];
  const invalidSteps = [...onlySteps].filter(s => !validSteps.includes(s));
  if (invalidSteps.length > 0) {
    log.error(`Invalid step(s): ${invalidSteps.join(', ')}`);
    log.info(`Valid steps: ${validSteps.join(', ')}`);
    process.exit(1);
  }

  // Run requested steps — same functions as full wizard
  if (onlySteps.has('channel'))  await stepChannel(s, ctx);
  if (onlySteps.has('list'))     await stepList(s, ctx);
  if (onlySteps.has('canvas'))   await stepCanvas(s, ctx);
  if (onlySteps.has('bookmark')) await stepBookmarks(s, ctx);

  // Bootstrap must run BEFORE welcome — stepWelcome reads ctx.taskThreadUrl
  // which stepBootstrapTask populates. The previous order (welcome first,
  // bootstrap later) meant `--only bootstrap,welcome` always tripped the
  // taskThreadUrl-missing guard and never reached bootstrap.
  if (onlySteps.has('bootstrap')) {
    await stepActivateListChannel(s, ctx);
    await stepBootstrapTask(s, ctx);
  }

  if (onlySteps.has('welcome')) {
    // If bootstrap wasn't also requested, look up the thread from an
    // existing task so the welcome CTA can still reference it.
    if (!ctx.taskThreadUrl && !onlySteps.has('bootstrap')) {
      ctx.taskThreadUrl = await resolveBootstrapTaskThread({ repoPath, slug, leadToken });
    }
    await stepWelcome(s, ctx);
  }

  if (onlySteps.has('skills')) {
    const agentRoles = Object.entries(staskConfig.agents || {}).map(([name, cfg]) => ({ name, role: cfg.role === 'worker' ? 'backend' : cfg.role }));
    await stepSkills(s, ctx, agentRoles, { teamManifest: TEAM_MANIFEST, agentManifests: AGENT_MANIFESTS });
  }

  if (onlySteps.has('cron'))     await stepCron(s, ctx, AGENT_MANIFESTS);
  if (onlySteps.has('openclaw')) await stepOpenclaw(s, ctx, null, TEAM_MANIFEST);
  if (onlySteps.has('install'))  stepInstall(ctx);
  if (onlySteps.has('inbox'))      await stepInbox(s, ctx);
  if (onlySteps.has('claude')) {
    // Partial mode: .stask/config.json stores the stask role (lead/worker/qa),
    // which loses the backend vs frontend distinction. Infer manifest roleId
    // by matching agent name to the full-setup naming, or fall back to a
    // worker → backend mapping. If the user has a more specific preference,
    // they can rerun full setup.
    const agentRoles = Object.entries(staskConfig.agents || {}).map(([name, cfg]) => {
      if (cfg.role === 'lead') return { name, roleId: 'lead' };
      if (cfg.role === 'qa') return { name, roleId: 'qa' };
      // stask 'worker' collapses backend/frontend — try to detect by name, else default to backend.
      const lc = name.toLowerCase();
      if (lc.includes('front') || lc.includes('ui') || lc.includes('design')) return { name, roleId: 'frontend' };
      return { name, roleId: 'backend' };
    });
    await stepClaudeSubagents(s, ctx, {
      projectName: slug,
      humanName: staskConfig.human?.name,
      manifests: { teamManifest: TEAM_MANIFEST, agentManifests: AGENT_MANIFESTS },
      agentRoles,
    });
  }

  outro(pc.green('Done'));
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildPlaceholders(d) {
  const workspaceRoot = path.join(OPENCLAW_HOME, `workspace-${d.projectSlug}`);
  const p = {
    '{{PROJECT_NAME}}': d.projectName, '{{PROJECT_SLUG}}': d.projectSlug,
    '{{PROJECT_ROOT}}': d.repoPath, '{{OPENCLAW_HOME}}': OPENCLAW_HOME,
    '{{WORKSPACE_ROOT}}': workspaceRoot,
    '{{HUMAN_NAME}}': d.humanName, '{{HUMAN_GITHUB_USERNAME}}': d.humanGithub,
    '{{HUMAN_SLACK_USER_ID}}': d.humanSlackUserId || 'UXXXXXXXXXX',
    '{{SLACK_CHANNEL_ID}}': d.slackChannelId || 'C0XXXXXXXXX',
    '{{SLACK_LIST_ID}}': d.slackListId || 'YOUR_SLACK_LIST_ID',
  };
  // Dynamic: generate placeholders for each role from manifest
  for (const role of ROLES) {
    const upper = role.id.toUpperCase();
    const agent = d.agents[role.id];
    p[`{{${upper}_NAME}}`] = capitalize(agent.name);
    p[`{{${upper}_NAME_LOWER}}`] = agent.name;
    p[`{{${upper}_MODEL}}`] = agent.model;
  }
  return p;
}
