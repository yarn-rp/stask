/**
 * stask teardown — Remove a team setup created by `stask setup`.
 *
 * Reverses everything setup created via OpenClaw's own CLI commands:
 *   1. Removes agents via `openclaw agents delete <id> --force`
 *      (which also drops their bindings + state dir)
 *   2. Removes Slack accounts via `openclaw channels remove`
 *   3. Removes heartbeat cron jobs via `openclaw cron list|rm`
 *   4. Removes workspace (~/.openclaw/workspace-<slug>/)
 *   5. Removes .stask/ from the repo
 *   6. Unregisters from ~/.stask/projects.json
 *   7. Removes Slack token from ~/.stask/config.json
 *   8. Removes setup state file
 *
 * Does NOT delete Slack apps or channels (those must be removed manually from api.slack.com).
 *
 * Usage: stask teardown <project-slug> [--force]
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadProjectsRegistry, saveProjectsRegistry, GLOBAL_STASK_DIR } from '../lib/resolve-home.mjs';
import { listAgents, deleteAgent, removeSlackAccount, listCronJobs, removeCronJob } from '../lib/setup/openclaw-cli.mjs';

const OPENCLAW_HOME = path.join(process.env.HOME || '', '.openclaw');

export async function run(args) {
  const slug = args[0];
  const force = args.includes('--force');

  if (!slug) {
    console.error('Usage: stask teardown <project-slug> [--force]');
    console.error('');
    console.error('This removes all local artifacts created by `stask setup`:');
    console.error('  - OpenClaw workspace + agent directories');
    console.error('  - Agent entries in openclaw.json');
    console.error('  - Heartbeat cron jobs');
    console.error('  - .stask/ project directory');
    console.error('  - Project registry entry');
    console.error('');
    console.error('Slack apps and channels must be removed manually at https://api.slack.com/apps');
    process.exit(1);
  }

  // ── Find what to remove ──────────────────────────────────────

  const workspaceDir = path.join(OPENCLAW_HOME, `workspace-${slug}`);
  const stateFile = path.join(GLOBAL_STASK_DIR, `setup-state-${slug}.json`);

  // Discover agent names via the openclaw CLI (agents whose workspace sits
  // under this project's workspace dir).
  let agentIds = [];
  try {
    const allAgents = listAgents();
    agentIds = allAgents
      .filter((a) => a.workspace && a.workspace.includes(`workspace-${slug}/`))
      .map((a) => a.id);
  } catch {}

  // Fallback: list directories in the workspace (works even if openclaw CLI
  // or gateway is unavailable).
  if (agentIds.length === 0 && fs.existsSync(workspaceDir)) {
    try {
      agentIds = fs.readdirSync(workspaceDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'shared' && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {}
  }

  // Find repo path from projects.json
  const registry = loadProjectsRegistry();
  const repoPath = registry.projects?.[slug]?.repoPath;

  // ── Confirm ──────────────────────────────────────────────────

  console.log(`\nTeardown: ${slug}`);
  console.log('─'.repeat(40));
  if (agentIds.length) console.log(`  Agents:    ${agentIds.join(', ')}`);
  if (fs.existsSync(workspaceDir)) console.log(`  Workspace: ${workspaceDir}`);
  if (repoPath) console.log(`  .stask/:   ${path.join(repoPath, '.stask')}`);
  console.log('');

  if (!force) {
    console.log('This will permanently delete all the above. Run with --force to confirm.');
    console.log('');
    console.log('Note: Slack apps and channels must be removed manually at:');
    console.log('  https://api.slack.com/apps');
    process.exit(0);
  }

  // ── 1. Delete agents via openclaw CLI (drops bindings + state dir) ─

  let agentsRemoved = 0;
  for (const id of agentIds) {
    try {
      deleteAgent(id);
      agentsRemoved++;
    } catch (err) {
      console.error(`  ! openclaw agents delete ${id} failed: ${err.message.split('\n')[0]}`);
    }
  }
  if (agentsRemoved) console.log(`  ✓ Removed ${agentsRemoved} agents via openclaw agents delete`);

  // ── 2. Remove Slack accounts ───────────────────────────────────

  let slackRemoved = 0;
  for (const id of agentIds) {
    const res = removeSlackAccount(id);
    if (res.ok) slackRemoved++;
  }
  if (slackRemoved) console.log(`  ✓ Removed ${slackRemoved} Slack accounts`);

  // ── 3. Remove heartbeat cron jobs (gateway-dependent) ────────

  try {
    const list = listCronJobs({ allowGatewayDown: true });
    if (list.gatewayDown) {
      console.warn('  ! OpenClaw gateway unreachable — cron jobs left in place. Re-run teardown once gateway is back.');
    } else {
      let cronRemoved = 0;
      for (const id of agentIds) {
        const job = (list.jobs || []).find(j => j.name === `${id}-heartbeat`);
        if (!job) continue;
        try {
          removeCronJob(job.id);
          cronRemoved++;
        } catch (err) {
          console.error(`  ! openclaw cron rm ${job.id} failed: ${err.message.split('\n')[0]}`);
        }
      }
      if (cronRemoved) console.log(`  ✓ Removed ${cronRemoved} heartbeat cron jobs`);
    }
  } catch (err) {
    console.error(`  ! cron cleanup skipped: ${err.message.split('\n')[0]}`);
  }

  // ── 3b. Ensure agent state dirs are gone (openclaw agents delete
  //       usually handles this, but double-check for safety) ─────

  for (const id of agentIds) {
    const agentDir = path.join(OPENCLAW_HOME, 'agents', id);
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true });
    }
  }

  // ── 4. Remove workspace ──────────────────────────────────────

  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true });
    console.log(`  ✓ Removed workspace: ${workspaceDir}`);
  }

  // ── 5. Remove .stask/ from repo ──────────────────────────────

  if (repoPath) {
    const staskDir = path.join(repoPath, '.stask');
    if (fs.existsSync(staskDir)) {
      fs.rmSync(staskDir, { recursive: true });
      console.log(`  ✓ Removed .stask/ from ${repoPath}`);
    }
  }

  // ── 6. Unregister from projects.json ─────────────────────────

  if (registry.projects?.[slug]) {
    delete registry.projects[slug];
    saveProjectsRegistry(registry);
    console.log(`  ✓ Unregistered from projects.json`);
  }

  // ── 7. Remove Slack token from central config ────────────────

  const centralConfig = path.join(GLOBAL_STASK_DIR, 'config.json');
  if (fs.existsSync(centralConfig)) {
    try {
      const central = JSON.parse(fs.readFileSync(centralConfig, 'utf-8'));
      if (central.projects?.[slug]) {
        delete central.projects[slug];
        fs.writeFileSync(centralConfig, JSON.stringify(central, null, 2) + '\n');
        console.log(`  ✓ Removed Slack token from ~/.stask/config.json`);
      }
    } catch {}
  }

  // ── 8. Remove setup state ────────────────────────────────────

  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log(`  ✓ Removed setup state file`);
  }

  // ── Done ─────────────────────────────────────────────────────

  console.log('');
  console.log(`Teardown complete for "${slug}".`);
  console.log('');
  console.log('Manual cleanup still needed:');
  console.log(`  • Delete Slack apps at https://api.slack.com/apps`);
  console.log(`  • Delete Slack channel #${slug}-project`);
  console.log(`  • Run: openclaw gateway restart`);
}
