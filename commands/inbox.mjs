/**
 * stask inbox — Inbox management CLI.
 *
 * Subcommands:
 *   stask inbox list [--status X] [--source github|linear] [--priority high|medium|low]
 *   stask inbox show <item-id>
 *   stask inbox subscribe <source> <target> [--interval seconds]
 *   stask inbox unsubscribe <sub-id>
 *   stask inbox subs list
 *   stask inbox poll
 */

import { withDb } from '../lib/tx.mjs';
import { execFileSync } from 'child_process';
import { run as runPollerd } from '../lib/inbox/pollerd.mjs';

// ─── Argument parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = { subcommand: argv[0] || 'list', raw: argv.slice(1) };
  const raw = args.raw;

  // inbox list [--status X] [--source github|linear] [--priority high|medium|low] [--json]
  // inbox show <item-id>
  // inbox subscribe <source> <target> [--interval seconds] [--filter JSON]
  // inbox unsubscribe <sub-id>
  // inbox subs list [--json]

  if (args.subcommand === 'subscribe') {
    // Args: <source> <target> [--interval N] [--filter JSON]
    args.source = raw[0]; // 'github' or 'linear'
    args.target = raw[1]; // repo slug or project key
    args.interval = null; // null = use source-specific default
    for (let i = 2; i < raw.length; i++) {
      if (raw[i] === '--interval' && raw[i + 1]) args.interval = parseInt(raw[++i], 10);
      if (raw[i] === '--filter' && raw[i + 1]) args.filter = raw[++i];
    }
  } else if (args.subcommand === 'list') {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '--status' && raw[i + 1]) args.status = raw[++i];
      else if (raw[i] === '--source' && raw[i + 1]) args.source = raw[++i];
      else if (raw[i] === '--priority' && raw[i + 1]) args.priority = raw[++i];
      else if (raw[i] === '--json') args.json = true;
    }
  } else if (args.subcommand === 'show') {
    args.itemId = raw[0];
  } else if (args.subcommand === 'unsubscribe') {
    args.subId = raw[0];
  }
  // 'subs' and 'list' with no args → default to list all

  return args;
}

// ─── Subcommand: list ──────────────────────────────────────────────

async function cmdList(args) {
  await withDb(async (db, libs) => {
    // Build query — check if inbox_items table exists first
    let rows;
    try {
      const sql = `
        SELECT item_id, sub_id, source_type, event_type, title, author,
               status, related_task_id, action_taken, occurred_at, ingested_at
        FROM inbox_items
        WHERE 1=1
        ${args.status ? ` AND status = ?` : ''}
        ${args.source ? ` AND source_type = ?` : ''}
        ORDER BY occurred_at DESC
        LIMIT 100
      `;
      const params = [];
      if (args.status) params.push(args.status);
      if (args.source) params.push(args.source);

      rows = db.prepare(sql).all(...params);
    } catch (err) {
      // inbox_items table doesn't exist yet
      rows = [];
    }

    if (args.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log('No inbox items. Run the inbox poller to start ingesting events.');
      return;
    }

    // Table output
    const header = ['Item ID', 'Source', 'Event', 'Title', 'Status', 'Related Task'];
    const widths = [10, 10, 15, 40, 12, 15];
    const pad = (s, w) => String(s).substring(0, w).padEnd(w);

    console.log(header.map((h, i) => pad(h, widths[i])).join('  '));
    console.log(widths.map(w => '─'.repeat(w)).join('──'));
    for (const r of rows) {
      console.log([
        pad(r.item_id, widths[0]),
        pad(r.source_type, widths[1]),
        pad(r.event_type, widths[2]),
        pad(r.title.substring(0, 38), widths[3]),
        pad(r.status, widths[4]),
        pad(r.related_task_id || '—', widths[5]),
      ].join('  '));
    }
    console.log(`\n${rows.length} item(s)`);
  });
}

// ─── Subcommand: show ──────────────────────────────────────────────

async function cmdShow(args) {
  if (!args.itemId) {
    console.error('Usage: stask inbox show <item-id>');
    process.exit(1);
  }

  await withDb(async (db, libs) => {
    // Try inbox_items first
    let item;
    try {
      item = db.prepare('SELECT * FROM inbox_items WHERE item_id = ?').get(args.itemId);
    } catch (err) {
      item = null;
    }

    if (!item) {
      // Try inbox_subs
      let sub;
      try {
        sub = db.prepare('SELECT * FROM inbox_subs WHERE sub_id = ?').get(args.itemId);
      } catch (err) {
        sub = null;
      }
      if (sub) {
        printSubscription(sub);
        return;
      }
      console.error(`ERROR: ${args.itemId} not found`);
      process.exit(1);
    }

    // Print item details
    console.log(`Inbox Item: ${item.item_id}`);
    console.log('─'.repeat(60));
    console.log(`  Source:      ${item.source_type}`);
    console.log(`  Event:       ${item.event_type}`);
    console.log(`  Title:       ${item.title}`);
    console.log(`  Body:        ${(item.body || '—').substring(0, 200)}`);
    console.log(`  URL:         ${item.url || '—'}`);
    console.log(`  Author:      ${item.author || '—'}`);
    console.log(`  Status:      ${item.status}`);
    console.log(`  Related Task:${item.related_task_id || '—'}`);
    console.log(`  Action Taken:${item.action_taken || '—'}`);
    console.log(`  Occurred:    ${item.occurred_at}`);
    console.log(`  Ingested:    ${item.ingested_at}`);
    console.log(`  Processed:   ${item.processed_at || '—'}`);
    console.log(`  Fingerprint: ${item.fingerprint}`);

    if (item.source_raw) {
      console.log('\nRaw Source Data:');
      try {
        const raw = JSON.parse(item.source_raw);
        console.log(JSON.stringify(raw, null, 2));
      } catch {
        console.log(item.source_raw);
      }
    }
  });
}

// ─── Subcommand: subscribe ─────────────────────────────────────────

async function cmdSubscribe(args) {
  if (!args.source || !args.target) {
    console.error('Usage: stask inbox subscribe <source> <target> [--interval seconds] [--filter JSON]');
    console.error('  source: github | linear');
    console.error('  target: owner/repo (GitHub) or project-key (Linear)');
    process.exit(1);
  }

  const sourceType = args.source.toLowerCase();
  if (!['github', 'linear'].includes(sourceType)) {
    console.error('ERROR: source must be "github" or "linear"');
    process.exit(1);
  }

  // Validate target format
  if (sourceType === 'github' && !args.target.includes('/')) {
    console.error('ERROR: GitHub target must be "owner/repo"');
    process.exit(1);
  }

  // Validate connectivity before subscribing
  if (sourceType === 'github') {
    try {
      execFileSync('gh', ['api', 'repos/' + args.target, '--jq', '.full_name'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      console.error(`ERROR: Cannot access ${args.target} — check gh auth and repo name`);
      process.exit(1);
    }
  } else if (sourceType === 'linear') {
    try {
      execFileSync('linear', ['project', 'list', '--json'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      console.error('ERROR: Cannot access Linear — check linear auth');
      process.exit(1);
    }
  }

  await withDb(async (db, libs) => {
    // Create inbox_subs table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_subs (
        sub_id        TEXT PRIMARY KEY,
        source_type   TEXT NOT NULL CHECK (source_type IN ('github', 'linear')),
        target_id     TEXT NOT NULL,
        filters       TEXT,
        poll_interval INTEGER NOT NULL DEFAULT 300,
        active        INTEGER NOT NULL DEFAULT 1,
        last_poll_at  TEXT,
        last_cursor   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create inbox_items table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_items (
        item_id       TEXT PRIMARY KEY,
        sub_id        TEXT NOT NULL REFERENCES inbox_subs(sub_id),
        source_type   TEXT NOT NULL,
        source_id     TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        title         TEXT NOT NULL,
        body          TEXT,
        url           TEXT,
        author        TEXT,
        status        TEXT NOT NULL DEFAULT 'New'
                      CHECK (status IN ('New','Processing','Processed','Archived')),
        related_task_id TEXT REFERENCES tasks(task_id),
        action_taken  TEXT,
        source_raw    TEXT,
        fingerprint   TEXT NOT NULL UNIQUE,
        occurred_at   TEXT NOT NULL,
        ingested_at   TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Check for duplicate subscription
    const existing = db.prepare(
      'SELECT sub_id FROM inbox_subs WHERE source_type = ? AND target_id = ? AND active = 1'
    ).get(sourceType, args.target);

    if (existing) {
      console.error(`ERROR: Active subscription for ${args.target} already exists (${existing.sub_id})`);
      process.exit(1);
    }

    const subId = `SUB-${Date.now().toString(36).toUpperCase()}`;
    const pollInterval = sourceType === 'linear' ? 900 : 300; // Linear=15min, GitHub=5min

    const resolvedInterval = args.interval ?? pollInterval;
    db.prepare(`
      INSERT INTO inbox_subs (sub_id, source_type, target_id, filters, poll_interval, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(subId, sourceType, args.target, args.filter || null, resolvedInterval);

    console.log(`Subscribed to ${sourceType}: ${args.target}`);
    console.log(`  Sub ID:    ${subId}`);
    console.log(`  Interval:  ${resolvedInterval}s`);
  });
}

// ─── Subcommand: unsubscribe ───────────────────────────────────────

async function cmdUnsubscribe(args) {
  if (!args.subId) {
    console.error('Usage: stask inbox unsubscribe <sub-id>');
    process.exit(1);
  }

  await withDb(async (db, libs) => {
    const sub = db.prepare('SELECT * FROM inbox_subs WHERE sub_id = ?').get(args.subId);
    if (!sub) {
      console.error(`ERROR: Subscription ${args.subId} not found`);
      process.exit(1);
    }

    // Soft-delete: set active = 0
    db.prepare('UPDATE inbox_subs SET active = 0, updated_at = datetime("now") WHERE sub_id = ?').run(args.subId);
    console.log(`Unsubscribed: ${sub.source_type}:${sub.target_id} (${args.subId})`);
  });
}

// ─── Subcommand: subs list ─────────────────────────────────────────

async function cmdSubsList(args) {
  await withDb(async (db, libs) => {
    let rows;
    try {
      rows = db.prepare('SELECT * FROM inbox_subs ORDER BY created_at DESC').all();
    } catch (err) {
      console.log('No subscriptions yet. Run: stask inbox subscribe <source> <target>');
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log('No subscriptions.');
      return;
    }

    const header = ['Sub ID', 'Source', 'Target', 'Interval', 'Active', 'Last Poll'];
    const widths = header.map((h, i) => {
      if (i === 0) return 15;
      if (i === 1) return 10;
      if (i === 2) return 30;
      if (i === 3) return 10;
      if (i === 4) return 8;
      return 20;
    });
    const pad = (s, w) => String(s || '').substring(0, w).padEnd(w);

    console.log(header.map((h, i) => pad(h, widths[i])).join('  '));
    console.log(widths.map(w => '─'.repeat(w)).join('──'));
    for (const r of rows) {
      console.log([
        pad(r.sub_id, widths[0]),
        pad(r.source_type, widths[1]),
        pad(r.target_id, widths[2]),
        pad(`${r.poll_interval}s`, widths[3]),
        pad(r.active ? 'yes' : 'no', widths[4]),
        pad(r.last_poll_at ? r.last_poll_at.substring(0, 19) : 'never', widths[5]),
      ].join('  '));
    }
    console.log(`\n${rows.length} subscription(s)`);
  });
}

// ─── Print helpers ─────────────────────────────────────────────────

function printSubscription(sub) {
  console.log(`Subscription: ${sub.sub_id}`);
  console.log('─'.repeat(60));
  console.log(`  Source:     ${sub.source_type}`);
  console.log(`  Target:    ${sub.target_id}`);
  console.log(`  Interval:  ${sub.poll_interval}s`);
  console.log(`  Active:    ${sub.active ? 'yes' : 'no'}`);
  console.log(`  Filters:   ${sub.filters || 'none'}`);
  console.log(`  Last Poll: ${sub.last_poll_at || 'never'}`);
  console.log(`  Last Cursor:${sub.last_cursor || '—'}`);
  console.log(`  Created:   ${sub.created_at}`);
}

// ─── Main entry point ──────────────────────────────────────────────

export async function run(argv) {
  const args = parseArgs(argv);

  switch (args.subcommand) {
    case 'list':
      await cmdList(args);
      break;
    case 'show':
      await cmdShow(args);
      break;
    case 'subscribe':
      await cmdSubscribe(args);
      break;
    case 'unsubscribe':
      await cmdUnsubscribe(args);
      break;
    case 'subs':
      await cmdSubsList(args);
      break;
    case 'poll':
      await runPollerd([]);
      break;
    default:
      console.error(`Unknown subcommand: ${args.subcommand}`);
      console.error('Usage: stask inbox <list|show|subscribe|unsubscribe|subs|poll>');
      process.exit(1);
  }
}