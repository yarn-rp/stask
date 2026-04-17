#!/usr/bin/env bash
# cleanup.sh — tear down Slack artifacts the QA sandbox installed.
#
# Deletes:
#   - The Slack List recorded in seed/dummy-repo/.stask/config.json (via files.delete)
#   - Every canvas tab attached to the sandbox's project channel
# Does NOT archive the channel by default — once archived, the bot gets
# kicked out and Slack's API won't let it unarchive itself (only a
# workspace admin can, via the UI). Leaving the channel active lets
# `stask setup` / bootstrap-channel.mjs reuse it on the next install,
# which is why we don't keep accumulating archived channels forever.
#
# Uses the Lead agent's bot token from ~/.stask-qa/credentials.json, so it
# operates on whichever workspace those tokens belong to. If you're about
# to switch workspaces, run cleanup BEFORE editing credentials.
#
# Usage:
#   bash test/qa-sandbox/cleanup.sh               # delete list + canvases
#   bash test/qa-sandbox/cleanup.sh --wipe-seed   # also delete local seed/ + SEED_VERSION
#   bash test/qa-sandbox/cleanup.sh --dry-run     # preview without calling destructive APIs
#   bash test/qa-sandbox/cleanup.sh --archive     # also archive the channel (admin UI needed to undo)

set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS="$HOME/.stask-qa/credentials.json"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
step()  { printf '\033[36m→\033[0m %s\n' "$*"; }

# ── Args ────────────────────────────────────────────────────────
WIPE_SEED=0
DRY=0
ARCHIVE=0
for arg in "$@"; do
  case "$arg" in
    --wipe-seed) WIPE_SEED=1 ;;
    --dry-run)   DRY=1 ;;
    --archive)   ARCHIVE=1 ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ── Sanity ──────────────────────────────────────────────────────
[ -f "$CREDS" ] || { red "Missing $CREDS — nothing to clean (no token)."; exit 1; }
command -v curl >/dev/null || { red "curl required"; exit 1; }
command -v node >/dev/null || { red "node required"; exit 1; }

# ── Pull bot token + expected channel name ─────────────────────
TOKEN=$(node -e "console.log(require('$CREDS').slack.apps.professor.botToken)")
[ -n "$TOKEN" ] || { red "Lead bot token missing from $CREDS"; exit 1; }

# Slug is fixed for the QA sandbox — matches setup-answers.template.json.
SLUG="stask-qa-dummy"
CHANNEL_NAME="${SLUG}-project"

api() {
  # api METHOD [JSON-BODY]
  # POST with JSON body (used for most write APIs).
  local method=$1
  local body=${2:-'{}'}
  curl -sS -X POST "https://slack.com/api/$method" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$body"
}

api_get() {
  # api_get METHOD QUERY_STRING
  # GET with query params (required by conversations.info etc.).
  local method=$1
  local query=${2:-}
  curl -sS "https://slack.com/api/$method?$query" \
    -H "Authorization: Bearer $TOKEN"
}

# jq_like NAME EXPR — reads JSON from stdin, writes the node expression's
# result to stdout. Avoids shell-quoting pitfalls of inlining large JSON
# payloads into -e arguments.
jq_like() {
  local name=$1 expr=$2
  node -e "
    let buf=''; process.stdin.on('data', c => buf += c); process.stdin.on('end', () => {
      const d = JSON.parse(buf);
      if (!d.ok) { console.error('  slack error ($name):', d.error); process.exit(2); }
      process.stdout.write(String(${expr} ?? ''));
    });
  "
}

# ── 1. Find the channel by name ─────────────────────────────────
# Slack's conversations.list honours exclude_archived only via GET query
# params; JSON body is ignored (and then returns archived rows too).
# Match the base channel or any counter-suffix variant bootstrap-channel.mjs
# might have created.
step "Looking up #$CHANNEL_NAME (or counter-suffix variants)"
CHAN_ID=$(api_get 'conversations.list' 'types=public_channel&limit=1000&exclude_archived=true' \
  | jq_like conversations.list "
    (d.channels || [])
      .filter(c => !c.is_archived)
      .filter(c => c.name === '$CHANNEL_NAME' || c.name.match(new RegExp('^$CHANNEL_NAME-\\\\d+\$')))
      .sort((a, b) => a.name === '$CHANNEL_NAME' ? -1 : 1)[0]?.id
  ")

if [ -z "$CHAN_ID" ]; then
  dim "  nothing to clean — no active channel matching #$CHANNEL_NAME"
else
  green "  found $CHAN_ID"
fi

# ── 2. If there's a channel, enumerate its canvas tabs ──────────
# All canvases created by stask setup live as tabs on the channel
# (properties.tabs[].type === "canvas").  Multiple install runs accumulate
# multiple tabs, so we collect them all.
CANVAS_IDS=""
if [ -n "$CHAN_ID" ]; then
  step "Fetching channel tabs"
  CANVAS_IDS=$(api_get 'conversations.info' "channel=$CHAN_ID" \
    | jq_like conversations.info "(d.channel?.properties?.tabs || []).filter(t => t.type === 'canvas').map(t => t.data?.file_id).filter(Boolean).join(' ')")
  if [ -z "$CANVAS_IDS" ]; then
    dim "  no canvas tabs found"
  else
    green "  canvases: $CANVAS_IDS"
  fi
fi

# ── 2b. Locate the Slack List recorded in the seed ──────────────
# Slack Lists are exposed via the files API (filetype=list). `files.delete`
# removes them entirely — no separate slackLists.delete method exists.
LIST_ID=""
SEED_CONFIG="$SANDBOX_DIR/seed/dummy-repo/.stask/config.json"
if [ -f "$SEED_CONFIG" ]; then
  LIST_ID=$(node -e "
    try { const c = require('$SEED_CONFIG'); const id = c.slack?.listId; process.stdout.write(id && id !== 'YOUR_SLACK_LIST_ID' ? id : ''); } catch { }
  ")
fi
if [ -n "$LIST_ID" ]; then
  step "Seeded list: $LIST_ID"
else
  dim "  no list recorded in seed (or placeholder value)"
fi

# ── 3. Act ──────────────────────────────────────────────────────
if [ "$DRY" = "1" ]; then
  echo
  dim "(dry-run — not calling destructive APIs)"
else
  # Returns "ok" if the Slack call succeeded, otherwise the error string.
  api_result() {
    node -e "
      let buf=''; process.stdin.on('data', c => buf += c); process.stdin.on('end', () => {
        try { const d = JSON.parse(buf); process.stdout.write(d.ok ? 'ok' : (d.error || 'unknown')); }
        catch { process.stdout.write('parse_error'); }
      });
    "
  }

  if [ -n "$CANVAS_IDS" ]; then
    for CID in $CANVAS_IDS; do
      step "Deleting canvas $CID"
      RES=$(api 'canvases.delete' "{\"canvas_id\":\"$CID\"}" | api_result)
      if [ "$RES" = "ok" ]; then green "  ✓ deleted"; else red "  FAILED: $RES"; fi
    done
  fi

  if [ -n "$LIST_ID" ]; then
    step "Deleting list $LIST_ID"
    RES=$(api 'files.delete' "{\"file\":\"$LIST_ID\"}" | api_result)
    if [ "$RES" = "ok" ]; then green "  ✓ deleted"; else red "  FAILED: $RES"; fi
  fi

  if [ -n "$CHAN_ID" ]; then
    # Skip bookmark cleanup — bookmarks.list needs `bookmarks:read` which
    # stask's manifests don't request. Stask's setup is idempotent on
    # bookmarks (re-adding the same one returns already_exists), so they
    # don't accumulate in practice.

    if [ "$ARCHIVE" = "1" ]; then
      step "Archiving channel $CHAN_ID"
      red "  warning: once archived, the bot is kicked and only a workspace admin can unarchive via the Slack UI"
      RES=$(api 'conversations.archive' "{\"channel\":\"$CHAN_ID\"}" | api_result)
      if [ "$RES" = "ok" ]; then green "  ✓ archived"; else red "  FAILED: $RES"; fi
    fi
  fi
fi

# ── 4. Optionally wipe the local seed ───────────────────────────
if [ "$WIPE_SEED" = "1" ] && [ "$DRY" != "1" ]; then
  step "Removing local seed"
  rm -rf "$SANDBOX_DIR/seed" "$SANDBOX_DIR/SEED_VERSION"
  green "  seed/ + SEED_VERSION deleted"
fi

echo
green "✓ Cleanup done"
dim "Next step: rerun install.sh (same workspace) or update credentials and rerun (new workspace)"
