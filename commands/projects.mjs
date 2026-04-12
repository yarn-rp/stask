/**
 * stask projects — List and show registered stask projects.
 *
 * Usage:
 *   stask projects              List all registered projects
 *   stask projects --json       List all projects as JSON
 *   stask projects show <name>  Show project details + task count
 *   stask projects remove <name> Remove a project from the registry
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { loadProjectsRegistry, registryPath } from '../lib/resolve-home.mjs';

export async function run(args) {
  const subCmd = args[0];

  if (subCmd === 'show') {
    return showProject(args[1]);
  }

  if (subCmd === 'remove') {
    return removeProject(args[1]);
  }

  return listProjects(args);
}

function listProjects(args) {
  const jsonMode = args?.includes('--json');
  const registry = loadProjectsRegistry();
  const entries = Object.entries(registry.projects || {});

  if (entries.length === 0) {
    if (jsonMode) {
      console.log('[]');
    } else {
      console.log('No projects registered.');
      console.log('');
      console.log('Create one with: stask init <name> --repo <path>');
    }
    return;
  }

  if (jsonMode) {
    const result = entries.map(([name, info]) => {
      const staskDir = path.join(info.repoPath, '.stask');
      const configPath = path.join(staskDir, 'config.json');
      const hasConfig = fs.existsSync(configPath);
      let agents = [];
      let slackListId = null;
      if (hasConfig) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          agents = Object.entries(config.agents || {}).map(([n, a]) => ({ name: n, role: a.role }));
          slackListId = config.slack?.listId || null;
        } catch {}
      }

      let taskCount = null;
      const dbPath = path.join(staskDir, 'tracker.db');
      if (fs.existsSync(dbPath)) {
        try {
          const db = new Database(dbPath, { readonly: true });
          const total = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE parent_id IS NULL').get().c;
          const active = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE parent_id IS NULL AND status != 'Done'").get().c;
          db.close();
          taskCount = { active, total };
        } catch {}
      }

      return { name, repoPath: info.repoPath, configured: hasConfig, agents, slackListId, taskCount };
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const maxName = Math.max(...entries.map(([n]) => n.length));
  console.log('Registered projects:');
  console.log('');
  for (const [name, info] of entries) {
    const staskDir = path.join(info.repoPath, '.stask');
    const hasConfig = fs.existsSync(path.join(staskDir, 'config.json'));
    const status = hasConfig ? '' : ' (missing .stask/config.json)';
    console.log(`  ${name.padEnd(maxName + 2)}${info.repoPath}${status}`);
  }
}

function showProject(name) {
  if (!name) {
    console.error('Usage: stask projects show <name>');
    process.exit(1);
  }

  const registry = loadProjectsRegistry();
  const project = registry.projects?.[name];
  if (!project) {
    console.error(`ERROR: Unknown project "${name}".`);
    console.error('');
    console.error('Run `stask projects` to see all registered projects.');
    process.exit(1);
  }

  const staskDir = path.join(project.repoPath, '.stask');
  const configPath = path.join(staskDir, 'config.json');

  console.log(`Project: ${name}`);
  console.log(`Repo:    ${project.repoPath}`);
  console.log(`Data:    ${staskDir}`);

  if (!fs.existsSync(configPath)) {
    console.log('Status:  NOT CONFIGURED (missing .stask/config.json)');
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Show agents
    const agents = Object.entries(config.agents || {});
    if (agents.length > 0) {
      console.log('');
      console.log('Agents:');
      for (const [agentName, info] of agents) {
        console.log(`  ${agentName.padEnd(16)}${info.role}`);
      }
    }

    // Show task count if DB exists
    const dbPath = path.join(staskDir, 'tracker.db');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true });
        const total = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE parent_id IS NULL').get().c;
        const active = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE parent_id IS NULL AND status != 'Done'").get().c;
        db.close();
        console.log('');
        console.log(`Tasks:   ${active} active, ${total} total`);
      } catch {
        // DB might not have tables yet
      }
    }
  } catch {
    console.log('Status:  CONFIG ERROR (could not parse config.json)');
  }
}

function removeProject(name) {
  if (!name) {
    console.error('Usage: stask projects remove <name>');
    process.exit(1);
  }

  const registry = loadProjectsRegistry();
  if (!registry.projects?.[name]) {
    console.error(`ERROR: Unknown project "${name}".`);
    console.error('');
    console.error('Run `stask projects` to see all registered projects.');
    process.exit(1);
  }

  delete registry.projects[name];
  const regPath = registryPath();
  fs.writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  console.log(`Removed project "${name}" from registry.`);
}
