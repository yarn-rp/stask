/**
 * roles.mjs — Role-based auto-assign resolution from config.
 *
 * Auto-assign rules are derived from roles, not hardcoded names:
 * - To-Do → human
 * - In-Progress → lead (parent task ownership; subtasks keep builder assignments via cascade logic)
 * - Testing → qa agent
 * - Ready for Human Review → human
 * - Blocked → human
 * - Done → keep current
 */

import { CONFIG } from './env.mjs';

/**
 * Find the agent name for a given role.
 * Returns the display name (capitalized) or null if not found.
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
 * Get the auto-assign target for a status transition.
 * Returns agent display name or null (keep current).
 */
export function getAutoAssign(status) {
  switch (status) {
    case 'To-Do':
    case 'Blocked':
      return CONFIG.human.name;
    case 'Ready for Human Review':
      return null; // keep current assignee — preserves builder ownership
    case 'Testing':
      return getAgentByRole('qa');
    case 'In-Progress':
      return getAgentByRole('lead');
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
 * Get the lead agent name (for delegation after approval).
 */
export function getLeadAgent() {
  return getAgentByRole('lead');
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
