/**
 * yaml-frontmatter.mjs — Parse, inject, and update YAML frontmatter in .md files.
 *
 * Frontmatter format (flat, no nesting):
 *   ---
 *   slack_synced: true
 *   slack_canvas_name: "Project Overview"
 *   slack_canvas_id: F0ASLNX990W
 *   slack_canvas_url: https://app.slack.com/canvas/F0ASLNX990W
 *   last_synced: 2026-04-13T23:15:00Z
 *   ---
 *
 * Pure functions — no file I/O, no API calls, no side effects.
 */

/**
 * Simple YAML parser for flat key-value frontmatter.
 * Supports: strings (quoted/unquoted), booleans, numbers, null.
 * Does NOT support nested objects, arrays, or multiline values.
 */
function parseYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Remove inline comments (only after a space, not inside strings)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }

    // Parse value
    if (value === '' || value === '~' || value === 'null') {
      result[key] = null;
    } else if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      result[key] = parseFloat(value);
    } else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Simple YAML serializer for flat key-value frontmatter.
 * Outputs clean YAML with consistent formatting.
 */
function dumpYaml(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      // Quote strings that could be misinterpreted (contain colons, start with digits, etc.)
      if (/[:{}\[\],&*?|<>=!%@`#\\]|^\d|^true$|^false$|^null$|^~$/.test(value) ||
          value.includes('\n')) {
        lines.push(`${key}: "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Extract YAML frontmatter from markdown content.
 * @param {string} content - Full file content (may include frontmatter)
 * @returns {{ frontmatter: object, body: string }}
 */
export function extractFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };
  return {
    frontmatter: parseYaml(match[1]),
    body: content.slice(match[0].length),
  };
}

/**
 * Inject YAML frontmatter into a markdown body.
 * @param {string} body - Markdown content (without frontmatter)
 * @param {object} frontmatter - Key-value pairs for frontmatter
 * @returns {string} Content with frontmatter prepended
 */
export function injectFrontmatter(body, frontmatter) {
  const yaml = dumpYaml(frontmatter);
  const trimmedBody = body.startsWith('\n') ? body : '\n' + body;
  return `---\n${yaml}\n---${trimmedBody}`;
}

/**
 * Check if a file is trackable (has `slack_synced: true` in frontmatter).
 * @param {string} content - Full file content
 * @returns {boolean}
 */
export function isTrackable(content) {
  const { frontmatter } = extractFrontmatter(content);
  return frontmatter.slack_synced === true;
}

/**
 * Update frontmatter fields, preserving all existing fields.
 * @param {string} content - Full file content (with or without frontmatter)
 * @param {object} updates - Key-value pairs to merge into frontmatter
 * @returns {string} Updated content
 */
export function updateFrontmatter(content, updates) {
  const { frontmatter, body } = extractFrontmatter(content);
  return injectFrontmatter(body, { ...frontmatter, ...updates });
}

/**
 * Get a specific frontmatter field value.
 * @param {string} content - Full file content
 * @param {string} key - Frontmatter key
 * @returns {*} The value, or undefined if not present
 */
export function getFrontmatterField(content, key) {
  const { frontmatter } = extractFrontmatter(content);
  return frontmatter[key];
}

// Export internal parsers for testing
export { parseYaml, dumpYaml };