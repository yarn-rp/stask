/**
 * roles.mjs — Role-based auto-assign resolution from config.
 *
 * Solo-agent projects have two roles: `human` and `lead`. Every auto-assign
 * rule resolves to `getHuman()` or `getLeadAgent()`.
 *
 *   Backlog                → human
 *   To-Do                  → human
 *   In-Progress            → lead
 *   Testing                → lead   (solo agent runs QA itself via acpx T:qa)
 *   Ready for Human Review → human
 *   Blocked                → human
 *   Done                   → keep current
 */

import { CONFIG } from './env.mjs';

/**
 * Find the agent name for a given role. Generic lookup — auto-assign logic
 * only ever uses role 'lead', but other callers (setup, canvas) may need
 * role-based lookups in the future.
 */
export function getAgentByRole(role) {
  for (const [name, agent] of Object.entries(CONFIG.agents)) {
    if (agent.role === role) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

/**
 * The human project owner's display name.
 */
export function getHuman() {
  return CONFIG.human.name;
}

/**
 * The solo project agent's display name.
 */
export function getLeadAgent() {
  return getAgentByRole('lead');
}

/**
 * Get the auto-assign target for a status transition.
 * Returns agent display name or null (keep current).
 */
export function getAutoAssign(status) {
  switch (status) {
    case 'Backlog':
    case 'To-Do':
    case 'Blocked':
    case 'Ready for Human Review':
      return getHuman();
    case 'In-Progress':
    case 'Testing':
      return getLeadAgent();
    case 'Done':
      return null; // keep current
    default:
      return null;
  }
}

/**
 * Get the Slack user ID for an agent or human name.
 */
export function getSlackUserId(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower === CONFIG.human.name.toLowerCase()) return CONFIG.human.slackUserId;
  const agent = CONFIG.agents[lower];
  return agent?.slackUserId || null;
}

/**
 * Reverse lookup: Slack user ID → display name.
 */
export function getNameBySlackUserId(userId) {
  if (!userId) return null;
  if (userId === CONFIG.human.slackUserId) return CONFIG.human.name;
  for (const [name, agent] of Object.entries(CONFIG.agents)) {
    if (agent.slackUserId === userId) return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return null;
}

/**
 * Check if a status requires human assignment override.
 */
export function isHumanReviewStatus(status) {
  return status === 'Ready for Human Review' || status === 'Blocked';
}
