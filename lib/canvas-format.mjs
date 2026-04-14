/**
 * canvas-format.mjs — Single source of truth for Markdown ↔ Canvas HTML conversion.
 *
 * Two pure functions:
 *   markdownToCanvas(md) → { type, markdown }  (for canvases.edit API)
 *   canvasToMarkdown(html) → string             (from url_private HTML download)
 *
 * Design rules:
 *   - Pure functions only — no API calls, no file I/O, no side effects
 *   - Deterministic — same input always produces same output
 *   - Round-trip safe — canvasToMarkdown(markdownToCanvas(md).markdown) ≈ md
 *   - Single module — if conversion has a bug, fix it here
 */

import TurndownService from 'turndown';

// ─── Markdown → Canvas ────────────────────────────────────────────

/**
 * Sanitize markdown for Slack Canvas compatibility.
 * Slack's canvases.edit API accepts markdown natively, but with a
 * supported subset. This function strips/adjusts unsupported constructs.
 *
 * @param {string} markdownBody - Markdown content (WITHOUT YAML frontmatter)
 * @returns {{ type: 'markdown', markdown: string }}
 */
export function markdownToCanvas(markdownBody) {
  const sanitized = sanitizeForCanvas(markdownBody);
  return {
    type: 'markdown',
    markdown: sanitized,
  };
}

/**
 * Sanitize markdown content for Slack Canvas compatibility.
 * - Strips YAML frontmatter (Canvas has its own metadata)
 * - Normalizes headings to h1-h3 (Canvas only supports up to h3)
 * - Preserves: paragraphs, bold, italic, strikethrough, code spans/blocks,
 *   lists, checklists, tables, links, mentions, horizontal rules, block quotes
 */
function sanitizeForCanvas(md) {
  let text = md;

  // Strip YAML frontmatter if present
  const fmRe = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
  text = text.replace(fmRe, '');

  // Downgrade h4+ to h3 (Canvas only supports h1-h3)
  text = text.replace(/^(#{4,})\s/gm, (match, hashes) => {
    return '### ';
  });

  // Normalize Windows line endings
  text = text.replace(/\r\n/g, '\n');

  // Trim trailing whitespace per line (Canvas normalizes this)
  text = text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n');

  // Ensure file doesn't start with newlines
  text = text.replace(/^\n+/, '');

  return text;
}

// ─── Canvas HTML → Markdown ───────────────────────────────────────

/**
 * Convert Canvas HTML download back to local markdown.
 * Uses turndown with custom rules for Slack-specific HTML patterns.
 *
 * @param {string} canvasHtml - HTML content from url_private download
 * @returns {string} Markdown string
 */
export function canvasToMarkdown(canvasHtml) {
  const td = createTurndownService();
  let md = td.turndown(canvasHtml);

  // Post-processing cleanup
  md = postProcessMarkdown(md);

  return md;
}

/**
 * Create a TurndownService instance with custom Slack-specific rules.
 */
function createTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    strikethroughDelimiter: '~~',
  });

  // ── Slack user mentions: <a data-uid="U0AXXX">@Username</a> → <@U0AXXX> ──
  td.addRule('slackUserMention', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      return !!node.getAttribute('data-uid');
    },
    replacement: (content, node) => {
      const uid = node.getAttribute('data-uid');
      return uid ? `<@${uid}>` : content;
    },
  });

  // ── Slack user mentions: <span data-uid="U0AXXX">@Username</span> → <@U0AXXX> ──
  td.addRule('slackUserMentionSpan', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      return !!node.getAttribute('data-uid');
    },
    replacement: (content, node) => {
      const uid = node.getAttribute('data-uid');
      return uid ? `<@${uid}>` : content;
    },
  });

  // ── Slack channel mentions: <a data-cid="C0AXXX">#channel</a> → <#C0AXXX> ──
  td.addRule('slackChannelMention', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      return !!node.getAttribute('data-cid');
    },
    replacement: (content, node) => {
      const cid = node.getAttribute('data-cid');
      return cid ? `<#${cid}>` : content;
    },
  });

  // ── Slack channel mentions: <span data-cid="C0AXXX">#channel</span> → <#C0AXXX> ──
  td.addRule('slackChannelMentionSpan', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      return !!node.getAttribute('data-cid');
    },
    replacement: (content, node) => {
      const cid = node.getAttribute('data-cid');
      return cid ? `<#${cid}>` : content;
    },
  });

  // ── Canvas section IDs: strip temp:C:xxx IDs from heading anchors ──
  td.addRule('canvasSectionId', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      const href = node.getAttribute('href') || '';
      return href.startsWith('#temp:C:') || href.startsWith('#canvas:');
    },
    replacement: (content, node) => {
      // Convert section anchors to heading text (strip the link)
      return content;
    },
  });

  // ── Checklist items: <input type="checkbox"> → - [ ] / - [x] ──
  td.addRule('checklistItem', {
    filter: (node) => {
      return node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox';
    },
    replacement: (content, node) => {
      return node.hasAttribute('checked') ? '[x]' : '[ ]';
    },
  });

  // ── Slack-specific usergroup mentions: <span data-ugid="S0AXXX">@group</span> ──
  td.addRule('slackUsergroupMention', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      return !!node.getAttribute('data-ugid');
    },
    replacement: (content, node) => {
      const ugid = node.getAttribute('data-ugid');
      return ugid ? `<!subteam^${ugid}>` : content;
    },
  });

  // ── Slack date/time linking ──
  td.addRule('slackDateTime', {
    filter: (node) => {
      if (node.nodeName !== 'TIME') return false;
      return !!node.getAttribute('data-ts');
    },
    replacement: (content, node) => {
      const ts = node.getAttribute('data-ts');
      return ts ? `<!date^${ts}^${content}>` : content;
    },
  });

  return td;
}

/**
 * Post-process markdown after turndown conversion.
 * Cleans up artifacts from HTML→MD conversion.
 */
function postProcessMarkdown(md) {
  // Normalize multiple blank lines to double
  md = md.replace(/\n{3,}/g, '\n\n');

  // Ensure file ends with a single newline
  md = md.replace(/\n*$/, '\n');

  return md;
}

// Export helpers for testing
export { sanitizeForCanvas, createTurndownService, postProcessMarkdown };