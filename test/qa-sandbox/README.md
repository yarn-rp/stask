# QA Sandbox

Ephemeral-HOME playground so the Helsinki QA agent can exercise `stask` end-to-end without ever touching the user's real `~/.openclaw` or `~/.stask`.

## Why this exists

On 2026-04-16 Helsinki ran `stask setup --only inbox` to test T-032 and, needing a "lead token" for the wizard, did:

```bash
cat > ~/.openclaw/openclaw.json << 'EOF'
{"channels":{"slack":{"accounts":{"professor":{"botToken":"xoxb-test-token",...}}}}}
EOF
```

…which clobbered the user's real 21 KB production config (4 agents, 10 Slack accounts, models, cron, etc.). Helsinki had no sandbox — every path in `lib/setup/*.mjs` is rooted at `process.env.HOME`, so any QA test that called `stask setup` hit the real home. Now it doesn't: Helsinki sources `activate.sh`, gets an ephemeral `$HOME=/tmp/stask-qa.XXXXXX` pre-populated with a full 4-agent team, and can break anything without consequence.

## One-time setup (user, not Helsinki)

1. **Create a dummy GitHub repo** — e.g. `yanrodriguez/stask-qa-dummy`, empty or with a minimal README. Your `gh auth` must have push access.
2. **Create a dummy Slack workspace** — or reuse the existing dev workspace. Create **four distinct Slack apps** (bot + socket mode), one per QA agent, so they don't collide with production. Generate each manifest on-demand from the live team templates:

   ```bash
   # Dump all four to stdout, with "(QA Test)" display names
   node test/qa-sandbox/print-manifests.mjs

   # Write them to a folder for copy-paste
   node test/qa-sandbox/print-manifests.mjs --write /tmp/qa-manifests

   # Copy just one to the clipboard (macOS)
   node test/qa-sandbox/print-manifests.mjs --role lead --copy
   ```

   These are rendered from `templates/team/<role>/manifest.json` via the same `generateSlackManifest()` stask setup uses — there is no forked "test" manifest. Change the templates, change what prints.
3. **Create the credentials file**:
   ```bash
   mkdir -p ~/.stask-qa
   cp test/qa-sandbox/credentials.example.json ~/.stask-qa/credentials.json
   chmod 600 ~/.stask-qa/credentials.json
   # ...then fill in the real values
   ```
4. **Install the sandbox** — this runs `npm link` and generates the seed by running the real `stask setup` once against your dummy credentials:
   ```bash
   bash test/qa-sandbox/install.sh
   ```
   Expected side-effects: a new channel/list/canvas in the dummy Slack workspace, a push to the dummy GitHub repo, and `seed/` + `SEED_VERSION` written locally.

## Daily use (Helsinki)

```bash
source test/qa-sandbox/activate.sh
# $HOME is now /tmp/stask-qa.XXXXXX with a full team ready.
cd $HOME/dummy-repo
stask list       # shows the seeded sample tasks (none initially, add tasks with `stask create`)
stask heartbeat helsinki
# ...test anything. Exit the shell → sandbox auto-deletes.
```

### Modes

| Command | What it does |
|---|---|
| `source activate.sh`         | Default. Ephemeral `$HOME` seeded with a complete 4-agent team. |
| `source activate.sh --empty` | Empty `$HOME` + `$HOME/.openclaw` + `git init`'d `$HOME/dummy-repo`. For testing `stask setup` itself from scratch. |
| `source reset.sh`            | Wipe current sandbox, re-seed. Useful mid-session after a destructive test. |
| `bash cleanup.sh`            | Archive the channel and delete the canvases the last `install.sh` created in the Slack workspace. Reads `credentials.json` so it cleans whichever workspace those tokens belong to. Pass `--dry-run` to preview, `--wipe-seed` to also nuke local `seed/` and `SEED_VERSION`. |
| `bash install.sh --skip-cleanup` | Skip the pre-install cleanup step (useful when you just switched `credentials.json` to a new workspace and the old one is already cleaned). |

### Environment Helsinki inherits

| Var | Value |
|---|---|
| `HOME`                          | `/tmp/stask-qa.XXXXXX` |
| `STASK_HOME`                    | `$HOME/.stask` |
| `STASK_QA_SANDBOX`              | `1` — the sentinel Helsinki's skill asserts on |
| `STASK_QA_SANDBOX_REAL_HOME`    | the user's real HOME (for debugging) |

## Debugging a failing test

The cleanup trap fires on shell exit, so to inspect a broken state:

```bash
source activate.sh
# ...reproduce the failure...
trap - EXIT            # disable the cleanup trap
echo $HOME             # /tmp/stask-qa.XXXXXX — won't be deleted now
```

The sandbox dir will stay on disk until the next reboot (or until you `rm -rf` it).

## Seed staleness

`install.sh` records a hash of `lib/setup/*.mjs` and `commands/setup.mjs` into `SEED_VERSION`. `activate.sh` re-computes the hash and warns if it has changed:

```
warning: lib/setup has changed since install — seed may be stale
  re-run: bash /Users/.../test/qa-sandbox/install.sh
```

The warning doesn't block activation — an agent testing a setup.mjs change *wants* the stale seed so they can verify the new install flow against the old shape. But if you're testing something else and see the warning, re-run install.

## Switching workspaces (e.g. migrating to a Pro workspace for Slack Lists)

Slack Lists are a paid-tier feature. If your dummy workspace is Free, `stask setup` will happily complete channel + canvas creation, but the task-board List step will fail with `unknown_method`. If your main workspace is on Pro/Business+, one option is to host the QA apps there.

To migrate:

1. **Clean up the old workspace first** (before you change credentials — `cleanup.sh` uses whatever tokens are in `credentials.json`):
   ```bash
   bash test/qa-sandbox/cleanup.sh --wipe-seed
   ```
2. **Create 4 fresh apps in the new workspace** using the same manifests — Slack apps are workspace-scoped, so you can't move them, but the manifests are identical:
   ```bash
   node test/qa-sandbox/print-manifests.mjs --write /tmp/qa-manifests
   # paste each file into api.slack.com → New App → From a manifest
   ```
3. **Install each app, grab the new bot + app tokens**, and update `~/.stask-qa/credentials.json` with the new values. Also update `slack.humanUserId` if your ID in the new workspace differs.
4. **Re-run install against the new workspace**. Skip auto-cleanup since the old workspace was already cleaned:
   ```bash
   bash test/qa-sandbox/install.sh --skip-cleanup
   ```

(If the "dummy" apps aren't yours to delete, you can leave them in the old workspace — they'll just sit idle with archived channels.)

## Known limits

- **Slack rate limits**: re-running `install.sh` creates a new channel + canvases every time. `install.sh` now auto-runs `cleanup.sh` first, so repeat runs don't accumulate. If something crashes mid-install you can always run `bash cleanup.sh` manually.
- **Skills**: `install.sh` sets `STASK_SKIP_SKILLS_INSTALL=1` so seed generation doesn't pull hundreds of MB of clawhub skills over the network. Stask-specific skills (`stask-general`, `stask-lead`, etc.) are still symlinked from the repo. If a test specifically needs a clawhub skill installed, unset that env and re-install.
- **Gateway restart**: shimmed to a noop (`STASK_SKIP_GATEWAY_RESTART=1`). Verifying the gateway actually reloads a new config is out of scope for this sandbox.
- **Real Slack API**: tests hit real Slack. This is good for catching API-shape drift but means the sandbox won't work offline.

## What's in `seed/`

Gitignored — each developer generates their own from their own credentials. After `install.sh`:

```
seed/
├── home/.openclaw/
│   ├── openclaw.json         # 4-agent config with dummy tokens
│   ├── workspace-stask-qa-dummy/{professor,berlin,tokyo,helsinki}/
│   ├── agents/{professor,berlin,tokyo,helsinki}/agent/
│   └── cron/jobs.json
├── home/.stask/
│   ├── config.json
│   ├── projects.json
│   ├── tracker.db
│   └── setup-state-stask-qa-dummy.json
└── dummy-repo/               # cloned from your github.repo in credentials
    ├── .git/
    └── .stask/config.json
```

## Files in this directory

| File | Role |
|---|---|
| `install.sh` | One-time: validates creds, `npm link`, auto-cleans prior artifacts, regenerates `seed/` by running `stask setup`. |
| `activate.sh` | Source to enter the sandbox. Creates ephemeral `$HOME`, rsyncs from `seed/`, exports `GH_TOKEN`, wires `gh` as a git credential helper, traps cleanup. |
| `reset.sh` | Source to wipe + re-activate. |
| `cleanup.sh` | Archives the sandbox's Slack channel + deletes its canvases. Invoked automatically by `install.sh`; also runnable manually. |
| `credentials.example.json` | Template for `~/.stask-qa/credentials.json`. |
| `print-manifests.mjs` | Dumps the 4 Slack app manifests to paste into api.slack.com. Reads from the real `templates/team/<role>/manifest.json` via `generateSlackManifest()` — no forked templates. |
| `fixtures/setup-answers.template.json` | Static answers for `stask setup` prompts. Dynamic values (tokens, repo path, gh login) merged in by `install.sh`. |
| `fixtures/render-answers.mjs` | Node helper that merges credentials + template → final answers file. |
| `.gitignore` | Excludes `seed/` and `SEED_VERSION` — those contain real tokens. |

## Stask code knobs this sandbox relies on

All env-gated. Production unaffected when unset.

| Env | Honored in | Effect |
|---|---|---|
| `STASK_SETUP_ANSWERS`        | `lib/setup/prompt.mjs`    | Non-interactive setup wizard (reads answers from JSON). |
| `STASK_SKIP_SKILLS_INSTALL`  | `lib/setup/skills.mjs`    | Skip `npx skills add` loop; only stask-specific skills are symlinked. |
| `STASK_SKIP_GATEWAY_RESTART` | `commands/setup.mjs`      | Skip `openclaw gateway restart` at end of setup. |
| `STASK_HOME`                 | `lib/resolve-home.mjs`    | Pre-existing. Sandbox points it at `$HOME/.stask`. |
