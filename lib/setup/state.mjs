/**
 * lib/setup/state.mjs — Wizard state persistence.
 *
 * Saves progress after each step so the user can Ctrl+C and resume.
 * State file: ~/.stask/setup-state-<slug>.json
 */

import fs from 'node:fs';
import path from 'node:path';

const GLOBAL_STASK_DIR = path.join(process.env.HOME || '', '.stask');

function stateFile(slug) {
  return path.join(GLOBAL_STASK_DIR, `setup-state-${slug}.json`);
}

/**
 * Load saved wizard state for a project slug.
 * Returns null if no state exists.
 */
export function loadSetupState(slug) {
  const file = stateFile(slug);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save wizard state after a step completes.
 */
export function saveSetupState(slug, state) {
  fs.mkdirSync(GLOBAL_STASK_DIR, { recursive: true });
  fs.writeFileSync(stateFile(slug), JSON.stringify(state, null, 2) + '\n');
}

/**
 * Remove the state file on successful completion.
 */
export function clearSetupState(slug) {
  const file = stateFile(slug);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Create a fresh state object.
 */
export function createState(slug) {
  return {
    projectSlug: slug,
    startedAt: new Date().toISOString(),
    completedSteps: [],
    data: {},
  };
}

/**
 * Mark a step as completed and persist.
 */
export function completeStep(state, stepName) {
  if (!state.completedSteps.includes(stepName)) {
    state.completedSteps.push(stepName);
  }
  saveSetupState(state.projectSlug, state);
}

/**
 * Check if a step was already completed (for resume).
 */
export function isStepDone(state, stepName) {
  return state.completedSteps.includes(stepName);
}
