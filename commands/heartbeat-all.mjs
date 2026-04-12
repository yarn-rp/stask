/**
 * stask heartbeat-all — Get pending work for an agent across ALL projects.
 *
 * Usage: stask heartbeat-all <agent-name>
 *
 * Iterates over all registered projects, checks if the agent is configured
 * in each project, and runs heartbeat per project. Returns combined JSON.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadProjectsRegistry } from '../lib/resolve-home.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STASK_BIN = path.resolve(__dirname, '../bin/stask.mjs');

export async function run(args) {
  const agentName = args[0];

  if (!agentName) {
    console.error('Usage: stask heartbeat-all <agent-name>');
    process.exit(1);
  }

  const registry = loadProjectsRegistry();
  const projects = Object.entries(registry.projects || {});

  if (projects.length === 0) {
    console.log(JSON.stringify({ agent: agentName, pendingTasks: [], projects: [] }, null, 2));
    return;
  }

  const allPendingTasks = [];
  const projectResults = [];

  for (const [projectName, projectInfo] of projects) {
    const configPath = path.join(projectInfo.repoPath, '.stask', 'config.json');

    // Skip projects without config
    if (!fs.existsSync(configPath)) continue;

    // Check if agent is in this project's config
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const agentConfig = config.agents?.[agentName.toLowerCase()];
      if (!agentConfig) continue;

      // Run heartbeat for this project via subprocess
      const result = execFileSync(
        process.execPath,
        [STASK_BIN, 'heartbeat', agentName, '--project', projectName],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, STASK_NO_DAEMON: '1' } }
      );

      const heartbeat = JSON.parse(result);

      // Tag each pending task with the project name
      for (const task of heartbeat.pendingTasks || []) {
        task.project = projectName;
        // Inject --project into prompt so agent uses it in subsequent commands
        if (task.prompt) {
          task.prompt = task.prompt.replace(
            /\bstask\b(?!\s+--project)/g,
            `stask --project ${projectName}`
          );
        }
        allPendingTasks.push(task);
      }

      projectResults.push({ project: projectName, role: agentConfig.role, taskCount: (heartbeat.pendingTasks || []).length });
    } catch (err) {
      // Log to stderr but don't fail — other projects may still work
      console.error(`WARNING: heartbeat failed for project "${projectName}": ${err.message}`);
      projectResults.push({ project: projectName, error: err.message });
    }
  }

  const result = {
    agent: agentName,
    pendingTasks: allPendingTasks,
    projects: projectResults,
  };

  console.log(JSON.stringify(result, null, 2));
}
