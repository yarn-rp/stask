/**
 * stask teardown — Remove a team setup created by `stask setup`.
 *
 * Reverses everything setup created:
 *   1. Removes agents from openclaw.json (agents.list, Slack accounts, bindings)
 *   2. Removes heartbeat cron jobs from ~/.openclaw/cron/jobs.json
 *   3. Removes agent directories (~/.openclaw/agents/<id>/)
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

  // Discover agent names from the workspace directory or openclaw.json
  let agentIds = [];

  // Try from openclaw.json
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  let ocConfig = null;
  if (fs.existsSync(configPath)) {
    try {
      ocConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Find agents whose workspace is under this project's workspace
      agentIds = (ocConfig.agents?.list || [])
        .filter((a) => a.workspace && a.workspace.includes(`workspace-${slug}/`))
        .map((a) => a.id);
    } catch {}
  }

  // Fallback: list directories in the workspace
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

  // ── 1. Remove agents from openclaw.json ──────────────────────

  if (ocConfig) {
    const idSet = new Set(agentIds);
    let changed = false;

    // Remove from agents.list
    if (ocConfig.agents?.list) {
      const before = ocConfig.agents.list.length;
      ocConfig.agents.list = ocConfig.agents.list.filter((a) => !idSet.has(a.id));
      if (ocConfig.agents.list.length < before) changed = true;
    }

    // Remove Slack accounts
    if (ocConfig.channels?.slack?.accounts) {
      for (const id of agentIds) {
        if (ocConfig.channels.slack.accounts[id]) {
          delete ocConfig.channels.slack.accounts[id];
          changed = true;
        }
      }
    }

    // Remove bindings
    if (ocConfig.bindings) {
      const before = ocConfig.bindings.length;
      ocConfig.bindings = ocConfig.bindings.filter((b) => !idSet.has(b.agentId));
      if (ocConfig.bindings.length < before) changed = true;
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(ocConfig, null, 2) + '\n');
      console.log(`  ✓ Removed ${agentIds.length} agents from openclaw.json`);
    }
  }

  // ── 2. Remove heartbeat cron jobs ────────────────────────────

  const cronPath = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
  if (fs.existsSync(cronPath)) {
    try {
      const cron = JSON.parse(fs.readFileSync(cronPath, 'utf-8'));
      let removed = 0;
      if (cron.jobs) {
        for (const id of agentIds) {
          const key = `${id}-heartbeat`;
          if (cron.jobs[key]) {
            delete cron.jobs[key];
            removed++;
          }
        }
      }
      if (removed) {
        fs.writeFileSync(cronPath, JSON.stringify(cron, null, 2) + '\n');
        console.log(`  ✓ Removed ${removed} heartbeat cron jobs`);
      }
    } catch {}
  }

  // ── 3. Remove agent directories ──────────────────────────────

  for (const id of agentIds) {
    const agentDir = path.join(OPENCLAW_HOME, 'agents', id);
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true });
    }
  }
  if (agentIds.length) console.log(`  ✓ Removed ${agentIds.length} agent directories`);

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
