/**
 * lib/setup/slack-list.mjs — Create Slack List from schema and extract column/option IDs.
 *
 * Creates the project task board as a Slack List with all 14 columns,
 * status options, and type options. Returns the IDs needed for .stask/config.json.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON from Slack: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * The full column schema for the stask project board.
 * Key names here must match what stask config expects.
 */
const LIST_SCHEMA = {
  columns: [
    {
      key: 'name',
      name: 'Task Name',
      type: 'text',
      is_primary_column: true,
    },
    {
      key: 'task_id',
      name: 'Task ID',
      type: 'text',
    },
    {
      key: 'status',
      name: 'Status',
      type: 'select',
      options: {
        format: 'single_select',
        choices: [
          { value: 'backlog', label: 'Backlog', color: 'gray' },
          { value: 'todo', label: 'To-Do', color: 'blue' },
          { value: 'in-progress', label: 'In-Progress', color: 'yellow' },
          { value: 'testing', label: 'Testing', color: 'purple' },
          { value: 'review', label: 'Ready for Human Review', color: 'orange' },
          { value: 'blocked', label: 'Blocked', color: 'red' },
          { value: 'done', label: 'Done', color: 'green' },
        ],
      },
    },
    {
      key: 'assignee',
      name: 'Assigned To',
      type: 'user',
      options: { format: 'single_entity' },
    },
    {
      key: 'type',
      name: 'Type',
      type: 'select',
      options: {
        format: 'single_select',
        choices: [
          { value: 'feature', label: 'Feature', color: 'blue' },
          { value: 'bug', label: 'Bug', color: 'red' },
          { value: 'improvement', label: 'Improvement', color: 'green' },
          { value: 'research', label: 'Research', color: 'purple' },
        ],
      },
    },
    { key: 'spec', name: 'Spec', type: 'attachment' },
    { key: 'worktree', name: 'Worktree', type: 'text' },
    { key: 'pr', name: 'PR', type: 'link' },
    { key: 'qa_report_1', name: 'QA Report 1', type: 'attachment' },
    { key: 'qa_report_2', name: 'QA Report 2', type: 'attachment' },
    { key: 'qa_report_3', name: 'QA Report 3', type: 'attachment' },
    { key: 'completed', name: 'Completed', type: 'checkbox' },
    {
      key: 'spec_approved',
      name: 'Spec Approved',
      type: 'select',
      options: {
        format: 'single_select',
        choices: [
          { value: 'approved', label: 'Approved', color: 'green' },
          { value: 'not-approved', label: 'Not Approved', color: 'gray' },
        ],
      },
    },
    { key: 'pr_status', name: 'PR Status', type: 'attachment' },
  ],
};

// Map of stask status names → select choice values
const STATUS_MAP = {
  'Backlog': 'backlog',
  'To-Do': 'todo',
  'In-Progress': 'in-progress',
  'Testing': 'testing',
  'Ready for Human Review': 'review',
  'Blocked': 'blocked',
  'Done': 'done',
};

// Map of stask type names → select choice values
const TYPE_MAP = {
  'Feature': 'feature',
  'Bug': 'bug',
  'Improvement': 'improvement',
  'Research': 'research',
};

// Map of stask spec-approved labels → select choice values
const SPEC_APPROVED_MAP = {
  'Approved': 'approved',
  'Not Approved': 'not-approved',
};

/**
 * Create a Slack List with the full stask column schema.
 *
 * @param {Object} opts
 * @param {string} opts.botToken    — Lead agent's bot token (needs lists:write)
 * @param {string} opts.listName    — e.g. "My Project — Task Board"
 * @returns {Promise<{ ok: boolean, listId?: string, columns?: Object, statusOptions?: Object, typeOptions?: Object, error?: string }>}
 */
export async function createProjectList({ botToken, listName }) {
  // Build the schema payload for slackLists.create
  // IMPORTANT: The key is "schema", not "columns" — Slack silently drops columns.
  const schemaPayload = LIST_SCHEMA.columns.map((col) => {
    const def = {
      key: col.key,
      name: col.name,
      type: col.type,
    };
    if (col.is_primary_column) def.is_primary_column = true;
    if (col.options) def.options = col.options;
    return def;
  });

  const createRes = await slackPost(botToken, 'slackLists.create', {
    name: `Project Tracker - stask`,
    schema: schemaPayload,
    description_blocks: [{
      type: 'rich_text',
      elements: [{
        type: 'rich_text_section',
        elements: [
          { type: 'text', text: 'Manage and monitor your OpenClaw Project Tasks from Slack. Visit ' },
          { type: 'link', url: 'https://github.com/yarn-rp/stask', text: 'Github Repo' },
          { type: 'text', text: ' for more info.' },
        ],
      }],
    }],
  });

  if (!createRes.ok) {
    return { ok: false, error: createRes.error, detail: createRes };
  }

  // Debug: write raw response to temp file for inspection
  const debugPath = path.join(os.tmpdir(), 'stask-setup', 'slack-list-response.json');
  fs.mkdirSync(path.dirname(debugPath), { recursive: true });
  fs.writeFileSync(debugPath, JSON.stringify(createRes, null, 2));

  // Extract list ID — Slack returns it as top-level `list_id`
  const listId = createRes.list_id || createRes.list?.id || createRes.id;
  if (!listId) {
    return { ok: false, error: 'No list ID in response', detail: createRes, debugPath };
  }

  // Parse column IDs from list_metadata.schema (Slack's response format)
  const responseColumns = createRes.list_metadata?.schema
    || createRes.list?.columns
    || createRes.list_metadata?.columns
    || createRes.columns
    || [];
  const columns = {};
  const statusOptions = {};
  const typeOptions = {};
  const specApprovedOptions = {};

  for (const col of responseColumns) {
    // Match by key or name
    const schemaCol = LIST_SCHEMA.columns.find(
      (s) => s.key === col.key || s.name === col.name
    );
    if (!schemaCol) continue;

    columns[schemaCol.key] = col.id;

    // Extract select option values — check both col.choices and col.options.choices
    const choices = col.choices || col.options?.choices || [];

    if (schemaCol.key === 'status' && choices.length) {
      for (const choice of choices) {
        for (const [staskName, choiceValue] of Object.entries(STATUS_MAP)) {
          if (choice.value === choiceValue || choice.label === staskName) {
            statusOptions[staskName] = choice.id || choice.value;
          }
        }
      }
    }

    if (schemaCol.key === 'type' && choices.length) {
      for (const choice of choices) {
        for (const [staskName, choiceValue] of Object.entries(TYPE_MAP)) {
          if (choice.value === choiceValue || choice.label === staskName) {
            typeOptions[staskName] = choice.id || choice.value;
          }
        }
      }
    }

    if (schemaCol.key === 'spec_approved' && choices.length) {
      for (const choice of choices) {
        for (const [staskName, choiceValue] of Object.entries(SPEC_APPROVED_MAP)) {
          if (choice.value === choiceValue || choice.label === staskName) {
            specApprovedOptions[staskName] = choice.id || choice.value;
          }
        }
      }
    }
  }

  return {
    ok: true,
    listId,
    columns,
    statusOptions,
    typeOptions,
    specApprovedOptions,
    rawResponse: createRes,
  };
}

/**
 * Grant access to the list and share it in the project channel.
 *
 * @param {Object} opts
 * @param {string} opts.botToken
 * @param {string} opts.listId
 * @param {string} opts.channelId    — project channel to post the link in
 * @param {string[]} opts.userIds    — all user IDs (agents + human) to grant access
 * @param {string} opts.humanUserId  — human gets owner access
 */
export async function shareListInChannel({ botToken, listId, channelId, userIds, humanUserId }) {
  // Grant OWNER access to human
  if (humanUserId) {
    await slackPost(botToken, 'slackLists.access.set', {
      list_id: listId,
      user_ids: [humanUserId],
      access_level: 'owner',
    });
  }

  // Grant write access to agents (exclude human since they're already owner)
  const agentIds = (userIds || []).filter((id) => id !== humanUserId);
  if (agentIds.length) {
    await slackPost(botToken, 'slackLists.access.set', {
      list_id: listId,
      user_ids: agentIds,
      access_level: 'write',
    });
  }

  // Get workspace URL for the list link
  const authRes = await slackPost(botToken, 'auth.test', {});
  const wsUrl = authRes.url?.replace(/\/$/, '') || 'https://slack.com';
  const teamId = authRes.team_id || '';
  const listUrl = `${wsUrl}/lists/${teamId}/${listId}`;

  return { ok: true, listUrl };
}

/**
 * Write the extracted column/option IDs into .stask/config.json.
 */
export function writeSlackIdsToConfig(configPath, { listId, channelId, columns, statusOptions, typeOptions, specApprovedOptions }) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.slack = config.slack || {};
  config.slack.columns = config.slack.columns || {};
  config.slack.statusOptions = config.slack.statusOptions || {};
  config.slack.typeOptions = config.slack.typeOptions || {};
  config.slack.specApprovedOptions = config.slack.specApprovedOptions || {};

  if (listId) config.slack.listId = listId;
  if (channelId) config.slack.channelId = channelId;

  // Write column IDs (only overwrite placeholders)
  for (const [key, colId] of Object.entries(columns)) {
    if (config.slack.columns[key]) {
      config.slack.columns[key] = colId;
    }
  }

  // Write status option IDs
  for (const [status, optId] of Object.entries(statusOptions)) {
    if (config.slack.statusOptions[status]) {
      config.slack.statusOptions[status] = optId;
    }
  }

  // Write type option IDs
  for (const [type, optId] of Object.entries(typeOptions)) {
    if (config.slack.typeOptions[type]) {
      config.slack.typeOptions[type] = optId;
    }
  }

  // Write spec-approved option IDs (always — they're not user-customizable)
  if (specApprovedOptions) {
    for (const [label, optId] of Object.entries(specApprovedOptions)) {
      config.slack.specApprovedOptions[label] = optId;
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
