/**
 * canvas-sync.test.mjs — Tests for YAML frontmatter, canvas-format, and canvas-sync modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFrontmatter,
  injectFrontmatter,
  isTrackable,
  updateFrontmatter,
  getFrontmatterField,
  parseYaml,
  dumpYaml,
} from '../lib/yaml-frontmatter.mjs';

import {
  markdownToCanvas,
  canvasToMarkdown,
  sanitizeForCanvas,
} from '../lib/canvas-format.mjs';

import {
  scanForTrackableFiles,
} from '../lib/canvas-sync.mjs';

// ─── YAML Frontmatter Tests ────────────────────────────────────────

describe('yaml-frontmatter', () => {
  describe('parseYaml', () => {
    it('parses flat key-value pairs', () => {
      const result = parseYaml('slack_synced: true\nslack_canvas_id: F0ABC');
      assert.deepEqual(result, { slack_synced: true, slack_canvas_id: 'F0ABC' });
    });

    it('parses booleans', () => {
      assert.equal(parseYaml('a: true').a, true);
      assert.equal(parseYaml('a: false').a, false);
    });

    it('parses numbers', () => {
      assert.equal(parseYaml('a: 42').a, 42);
      assert.equal(parseYaml('a: 3.14').a, 3.14);
      assert.equal(parseYaml('a: -7').a, -7);
    });

    it('parses quoted strings', () => {
      assert.equal(parseYaml('a: "hello world"').a, 'hello world');
      assert.equal(parseYaml("a: 'hello world'").a, 'hello world');
    });

    it('parses null values', () => {
      assert.equal(parseYaml('a: null').a, null);
      assert.equal(parseYaml('a: ~').a, null);
      assert.equal(parseYaml('a: ').a, null);
    });

    it('ignores comments', () => {
      const result = parseYaml('a: true # this is a comment');
      assert.equal(result.a, true);
    });

    it('skips blank lines', () => {
      const result = parseYaml('\na: 1\n\nb: 2\n');
      assert.deepEqual(result, { a: 1, b: 2 });
    });
  });

  describe('dumpYaml', () => {
    it('serializes flat key-value pairs', () => {
      const result = dumpYaml({ a: true, b: 'hello' });
      assert.ok(result.includes('a: true'));
      assert.ok(result.includes('b: hello'));
    });

    it('quotes strings with special chars', () => {
      const result = dumpYaml({ url: 'https://example.com' });
      assert.ok(result.includes('url: "https://example.com"'));
    });

    it('serializes null values', () => {
      const result = dumpYaml({ a: null });
      assert.equal(result, 'a: null');
    });
  });

  describe('extractFrontmatter', () => {
    it('extracts frontmatter from content with --- delimiters', () => {
      const content = '---\nslack_synced: true\n---\n\n# Hello\n';
      const { frontmatter, body } = extractFrontmatter(content);
      assert.equal(frontmatter.slack_synced, true);
      assert.ok(body.includes('# Hello'));
    });

    it('returns empty frontmatter when no delimiters', () => {
      const content = '# Hello\n';
      const { frontmatter, body } = extractFrontmatter(content);
      assert.deepEqual(frontmatter, {});
      assert.equal(body, content);
    });

    it('extracts all sync fields', () => {
      const content = '---\nslack_synced: true\nslack_canvas_name: "Test"\nslack_canvas_id: F0ABC\nslack_canvas_url: https://app.slack.com/canvas/F0ABC\nlast_synced: 2026-04-13T23:15:00Z\n---\n\nBody\n';
      const { frontmatter } = extractFrontmatter(content);
      assert.equal(frontmatter.slack_synced, true);
      assert.equal(frontmatter.slack_canvas_name, 'Test');
      assert.equal(frontmatter.slack_canvas_id, 'F0ABC');
      assert.equal(frontmatter.slack_canvas_url, 'https://app.slack.com/canvas/F0ABC');
      assert.equal(frontmatter.last_synced, '2026-04-13T23:15:00Z');
    });
  });

  describe('injectFrontmatter', () => {
    it('injects frontmatter into body', () => {
      const result = injectFrontmatter('# Hello\n', { slack_synced: true });
      assert.ok(result.startsWith('---\n'));
      assert.ok(result.includes('slack_synced: true'));
      assert.ok(result.includes('# Hello'));
    });

    it('round-trips with extractFrontmatter', () => {
      const original = { slack_synced: true, slack_canvas_id: 'F0ABC' };
      const body = '# Hello\n';
      const content = injectFrontmatter(body, original);
      const { frontmatter, body: extractedBody } = extractFrontmatter(content);
      assert.equal(frontmatter.slack_synced, original.slack_synced);
      assert.equal(frontmatter.slack_canvas_id, original.slack_canvas_id);
      assert.ok(extractedBody.includes('# Hello'));
    });
  });

  describe('isTrackable', () => {
    it('returns true when slack_synced is true', () => {
      assert.equal(isTrackable('---\nslack_synced: true\n---\n\n# Hello\n'), true);
    });

    it('returns false when slack_synced is false', () => {
      assert.equal(isTrackable('---\nslack_synced: false\n---\n\n# Hello\n'), false);
    });

    it('returns false when no frontmatter', () => {
      assert.equal(isTrackable('# Hello\n'), false);
    });

    it('returns false when slack_synced is missing', () => {
      assert.equal(isTrackable('---\nother: true\n---\n\n# Hello\n'), false);
    });
  });

  describe('updateFrontmatter', () => {
    it('adds new fields', () => {
      const content = '---\nslack_synced: true\n---\n\n# Hello\n';
      const updated = updateFrontmatter(content, { slack_canvas_id: 'F0NEW' });
      const { frontmatter } = extractFrontmatter(updated);
      assert.equal(frontmatter.slack_synced, true);
      assert.equal(frontmatter.slack_canvas_id, 'F0NEW');
    });

    it('updates existing fields', () => {
      const content = '---\nslack_synced: true\nslack_canvas_id: F0OLD\n---\n\n# Hello\n';
      const updated = updateFrontmatter(content, { slack_canvas_id: 'F0NEW' });
      const { frontmatter } = extractFrontmatter(updated);
      assert.equal(frontmatter.slack_canvas_id, 'F0NEW');
    });

    it('preserves body content', () => {
      const content = '---\nslack_synced: true\n---\n\n# Hello\n\nSome body text\n';
      const updated = updateFrontmatter(content, { last_synced: '2026-04-14T00:00:00Z' });
      assert.ok(updated.includes('# Hello'));
      assert.ok(updated.includes('Some body text'));
    });
  });

  describe('getFrontmatterField', () => {
    it('gets a field value', () => {
      const content = '---\nslack_canvas_id: F0ABC\n---\n\nBody\n';
      assert.equal(getFrontmatterField(content, 'slack_canvas_id'), 'F0ABC');
    });

    it('returns undefined for missing field', () => {
      const content = '---\nother: true\n---\n\nBody\n';
      assert.equal(getFrontmatterField(content, 'slack_canvas_id'), undefined);
    });
  });
});

// ─── Canvas Format Tests ───────────────────────────────────────────

describe('canvas-format', () => {
  describe('markdownToCanvas', () => {
    it('returns { type: markdown } object', () => {
      const result = markdownToCanvas('# Hello\n');
      assert.equal(result.type, 'markdown');
      assert.equal(result.markdown, '# Hello\n');
    });

    it('strips YAML frontmatter', () => {
      const result = markdownToCanvas('---\nslack_synced: true\n---\n\n# Hello\n');
      assert.ok(!result.markdown.includes('slack_synced'));
      assert.ok(result.markdown.includes('# Hello'));
    });

    it('downgrades h4+ to h3', () => {
      const result = markdownToCanvas('#### Heading\n');
      assert.ok(result.markdown.startsWith('### '));
      assert.ok(!result.markdown.includes('####'));
    });

    it('preserves h1-h3', () => {
      assert.ok(markdownToCanvas('# H1\n').markdown.includes('# H1'));
      assert.ok(markdownToCanvas('## H2\n').markdown.includes('## H2'));
      assert.ok(markdownToCanvas('### H3\n').markdown.includes('### H3'));
    });
  });

  describe('canvasToMarkdown', () => {
    it('converts basic HTML to markdown', () => {
      const html = '<h1>Hello</h1><p>World</p>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('Hello'));
      assert.ok(md.includes('World'));
    });

    it('converts bold and italic', () => {
      const html = '<p><strong>bold</strong> and <em>italic</em></p>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('**bold**'));
      assert.ok(md.includes('*italic*'));
    });

    it('converts code blocks', () => {
      const html = '<pre><code>const x = 1;</code></pre>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('```'));
      assert.ok(md.includes('const x = 1;'));
    });

    it('converts lists', () => {
      const html = '<ul><li>one</li><li>two</li></ul>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('one'));
      assert.ok(md.includes('two'));
      assert.ok(md.match(/[-*] .+one/), 'Should use list marker');
    });

    it('converts Slack user mentions', () => {
      const html = '<p><a data-uid="U0ABC123">@John</a> said hello</p>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('<@U0ABC123>'));
    });

    it('converts Slack channel mentions', () => {
      const html = '<p><a data-cid="C0ABC123">#general</a></p>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('<#C0ABC123>'));
    });

    it('converts Slack usergroup mentions', () => {
      const html = '<p><span data-ugid="S0ABC123">@engineering</span></p>';
      const md = canvasToMarkdown(html);
      assert.ok(md.includes('<!subteam^S0ABC123>'));
    });

    it('handles empty HTML', () => {
      const md = canvasToMarkdown('');
      assert.equal(md, '\n');
    });
  });

  describe('sanitizeForCanvas', () => {
    it('strips frontmatter', () => {
      const result = sanitizeForCanvas('---\nkey: val\n---\n\n# Body\n');
      assert.ok(!result.includes('---'));
      assert.ok(result.includes('# Body'));
    });

    it('trims trailing whitespace per line', () => {
      const result = sanitizeForCanvas('hello   \nworld   \n');
      assert.ok(!result.includes('hello   '));
      assert.ok(result.includes('hello\n'));
    });
  });
});

// ─── Canvas Sync File Discovery Tests ──────────────────────────────

describe('canvas-sync (file discovery)', () => {
  it('scanForTrackableFiles returns empty for nonexistent directory', () => {
    const result = scanForTrackableFiles(['/nonexistent/path'], '/base');
    assert.equal(result.length, 0);
  });

  it('scanForTrackableFiles finds trackable files in a directory', () => {
    // Use the templates directory we created — it has files with slack_synced: true
    const templatesPath = new URL('../lib/templates', import.meta.url).pathname;
    const basePath = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
    const result = scanForTrackableFiles(['lib/templates'], basePath);
    assert.ok(result.length >= 1, 'Should find at least one trackable template');
    for (const file of result) {
      assert.ok(file.content.includes('slack_synced'), `File ${file.relPath} should have slack_synced`);
    }
  });
});