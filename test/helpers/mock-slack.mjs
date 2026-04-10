/**
 * mock-slack.mjs — Stubs Slack API calls, records what was called.
 * No network — purely in-memory.
 */

let _calls = [];
let _shouldFail = false;
let _nextRowId = 1;

export function resetMock() {
  _calls = [];
  _shouldFail = false;
  _nextRowId = 1;
}

export function setSlackFailure(fail) {
  _shouldFail = fail;
}

export function getCalls() {
  return [..._calls];
}

export function getCallsByMethod(method) {
  return _calls.filter(c => c.method === method);
}

function record(method, args) {
  _calls.push({ method, args, timestamp: Date.now() });
}

function maybeThrow() {
  if (_shouldFail) throw new Error('Slack API mock failure');
}

// ─── Mock Slack API functions ──────────────────────────────────────

export async function createListRow(listId, initialFields, parentItemId = null) {
  record('createListRow', { listId, initialFields, parentItemId });
  maybeThrow();
  const rowId = `R_MOCK_${_nextRowId++}`;
  return { ok: true, item: { id: rowId, fields: initialFields } };
}

export async function updateListCells(listId, cells) {
  record('updateListCells', { listId, cells });
  maybeThrow();
  return { ok: true };
}

export async function deleteListRow(listId, itemId) {
  record('deleteListRow', { listId, itemId });
  maybeThrow();
  return { ok: true };
}

export async function getListItems(listId, limit) {
  record('getListItems', { listId, limit });
  maybeThrow();
  return [];
}

export async function uploadFile(filename, content, contentType) {
  record('uploadFile', { filename, contentType });
  maybeThrow();
  return `F_MOCK_${_nextRowId++}`;
}
