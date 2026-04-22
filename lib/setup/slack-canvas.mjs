/**
 * lib/setup/slack-canvas.mjs — Create project overview canvas and welcome message.
 */

import https from 'node:https';

function slackPost(token, endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/${endpoint}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Create the Project Overview canvas.
 *
 * @param {Object} opts
 * @param {string} opts.botToken
 * @param {string} opts.projectSlug
 * @param {string} opts.listUrl      — full URL to the Slack List
 * @param {Object} opts.agents       — { name: { role, slackUserId } }
 * @param {string} opts.humanUserId
 * @param {string} opts.channelId    — channel to bookmark in
 * @returns {Promise<{ ok: boolean, canvasId?: string, error?: string }>}
 */
export async function createProjectCanvas({ botToken, projectSlug, listUrl, agents, humanUserId, channelId }) {
  // Build team rows
  const teamRows = [];
  for (const [name, cfg] of Object.entries(agents)) {
    const roleLabel = cfg.role === 'lead' ? 'Project Agent' : cfg.role;
    teamRows.push(`| ${roleLabel} | ![](@${cfg.slackUserId}) |`);
  }
  teamRows.push(`| Project Owner | ![](@${humanUserId}) |`);

  const markdown = [
    '# Project overview',
    '',
    'This canvas includes everything you need to know about this project along with links to important resources and people.',
    '',
    '---',
    '',
    '## \u270d\ufe0f Project description',
    '',
    '*Add a brief summary of your project here. What are you building? Why does it matter?*',
    '',
    '---',
    '',
    '## \ud83c\udfaf Goals',
    '',
    '1. First goal',
    '2. Second goal',
    '3. Third goal',
    '',
    '---',
    '',
    '## \ud83d\udc65 Team',
    '',
    '| Role | Name |',
    '|------|------|',
    ...teamRows,
    '',
    '---',
    '',
    '## \u2705 Task tracker',
    '',
    'We use this task tracker to keep track of team tasks:',
    '',
    listUrl ? `[Project Tracker - stask](${listUrl})` : '*Set up the task tracker and add the link here*',
    '',
    '---',
    '',
    '## \ud83d\udd11 Key resources',
    '',
    '1. [stask CLI \u2014 GitHub](https://github.com/yarn-rp/stask)',
    '2. [OpenClaw Docs](https://docs.openclaw.ai)',
    '3. *Add your project-specific links here*',
    '',
  ].join('\n');

  // Create canvas — if channelId provided, it auto-attaches as a channel tab
  const createPayload = {
    title: `Project Overview - stask`,
    document_content: { type: 'markdown', markdown },
  };
  if (channelId) createPayload.channel_id = channelId;

  const res = await slackPost(botToken, 'canvases.create', createPayload);

  if (!res.ok) return { ok: false, error: res.error };

  const canvasId = res.canvas_id;

  // Grant OWNER access to human, write to agents
  if (humanUserId) {
    await slackPost(botToken, 'canvases.access.set', {
      canvas_id: canvasId,
      access_level: 'owner',
      user_ids: [humanUserId],
    });
  }
  const agentUserIds = Object.values(agents).map((a) => a.slackUserId).filter(Boolean);
  if (agentUserIds.length) {
    await slackPost(botToken, 'canvases.access.set', {
      canvas_id: canvasId,
      access_level: 'write',
      user_ids: agentUserIds,
    });
  }

  return { ok: true, canvasId };
}

/**
 * Send the welcome message + team introduction to the project channel.
 *
 * @param {Object} opts
 * @param {string} opts.botToken
 * @param {string} opts.channelId
 * @param {string} opts.humanUserId
 * @param {string} opts.projectSlug
 * @param {Object} opts.agents      — { name: { role, slackUserId } }
 * @param {string} opts.canvasId    — canvas ID for the project overview link
 * @param {string} opts.listUrl     — URL to the task tracker list
 */
export async function sendWelcomeMessage({ botToken, channelId, humanUserId, projectSlug, agents, canvasUrl, listUrl }) {
  const canvasLink = canvasUrl ? `<${canvasUrl}|Project Overview - stask>` : '*Project Overview - stask*';
  const listLink = listUrl ? `<${listUrl}|Project Tracker - stask>` : '*Project Tracker - stask*';

  // ── Message 1: Welcome (top-level) ─────────────────────────
  const msg1Text = [
    `Hi, <@${humanUserId}>! :wave: *#${projectSlug}-project* is ready to go.`,
    `This channel is more than just a conversation. Here\u2019s what was created for you:`,
    '',
    `\u2022  ${canvasLink} \u2014 your project\u2019s home page with goals, team, and key resources`,
    `\u2022  ${listLink} \u2014 a Kanban board to track tasks, synced with your local database`,
    `\u2022  <https://github.com/yarn-rp/stask|stask CLI> \u2014 the CLI that powers the task lifecycle`,
    `\u2022  <https://docs.openclaw.ai|OpenClaw Docs> \u2014 reference docs for the agent platform`,
    '',
    `:point_up_2: Check the *tabs* at the top of this channel for the Project Overview and add the Task Tracker as a tab too (click *+* \u2192 *List* \u2192 select it).`,
    '',
    `Now\u2019s your chance to edit this channel to fit your team\u2019s needs.`,
  ].join('\n');

  const msg1 = await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    text: msg1Text,
    unfurl_links: false,
  });

  if (!msg1.ok) return { ok: false, error: msg1.error };
  const threadTs = msg1.ts; // All follow-ups go in this thread

  // ── Message 2: Meet your project agent (threaded) ──────────
  const teamLines = [];
  for (const [, cfg] of Object.entries(agents || {})) {
    const info = cfg.role === 'lead'
      ? { emoji: '\ud83e\udde0', label: 'Project Agent', desc: 'Owns the full pipeline \u2014 spec, code, QA, and PR review \u2014 for every task on this project. Coding work is driven through acpx sessions; the agent itself orchestrates and merges.' }
      : { emoji: '\ud83d\udc64', label: cfg.role, desc: '' };
    teamLines.push(`${info.emoji}  <@${cfg.slackUserId}> \u2014 *${info.label}*`);
    teamLines.push(`      ${info.desc}`);
    teamLines.push('');
  }

  const msg2Text = [
    `:busts_in_silhouette: *Meet your project agent*`,
    '',
    `This is the AI agent that will be working on your project. It has its own Slack app and owns every phase of each task end to end.`,
    '',
    ...teamLines,
    `The agent runs on OpenClaw and checks for pending work on its cron heartbeat. All conversation happens in this channel and in task threads; no DMs.`,
  ].join('\n');

  await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text: msg2Text,
    unfurl_links: false,
  });

  // ── Message 3: CTA to reply in this thread to trigger bootstrap ──
  const leadEntry = Object.entries(agents || {}).find(([, cfg]) => cfg.role === 'lead');
  const leadUserId = leadEntry?.[1]?.slackUserId || '';

  await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text: `:rocket: Ready to get started? Reply in this thread to trigger bootstrap.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:rocket: *Ready to get started?*\n\nReply in this thread with the message below \u2014 <@${leadUserId}> is listening and will kick off bootstrap. All team conversation stays in this channel (or in task threads) from here on; no DMs.`,
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_preformatted',
            elements: [
              { type: 'text', text: `Hey! I just set up this project with stask. Run your bootstrap \u2014 explore the codebase, ask me questions about how I work, and get the team ready.` },
            ],
          },
        ],
      },
    ],
    unfurl_links: false,
  });

  return { ok: true };
}
