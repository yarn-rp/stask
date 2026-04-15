# BOOTSTRAP.md — {{FRONTEND_NAME}} (Frontend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep Frontend Analysis

You need to understand every client-side system before writing a single line of code.

### 1. Map the Frontend

Use OpenCode to scan your domain:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{FRONTEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}/skills/agentic-coding/SKILL.md \
  -- 'Map the frontend of {{PROJECT_ROOT}}. Focus on:
  - Pages and layouts — all routes, what renders where
  - Components — structure, shared vs page-specific, design system
  - Hooks — custom hooks, what state they manage
  - Styling — Tailwind config, CSS variables, design tokens, themes
  - State management — client state, server state, form state
  - Data fetching — how data flows from server to UI
  - Types — where TypeScript types live, key interfaces'
```

### 2. Understand the Design System

Map the visual layer:
- What component library is used? (shadcn, MUI, custom)
- Where are base components vs custom components?
- Design tokens: colors, spacing, typography, breakpoints
- Dark mode: how it works, where it's configured
- Animations: what library, what patterns

### 3. Map Data Flow

For each major page:
- What data does it need?
- Where does it come from? (server component fetch, client fetch, server action)
- What state is client-only vs server-synced?
- What happens on error? Loading? Empty?

### 4. Review Shared Knowledge

Read and verify what {{LEAD_NAME}} documented:
- `../shared/STACK.md` — Does the frontend stack match what you found?
- `../shared/ARCHITECTURE.md` — Are the routing and component patterns accurate?
- `../shared/CONVENTIONS.md` — Are the frontend conventions followed?

**Update anything that's wrong or missing.** You are the frontend authority.

## Phase 2: Environment Setup Interview

Ask the human these critical questions.

### Local Development
1. "How do I run the dev server? What port?"
2. "Any environment variables specific to the frontend? (public API URLs, feature flags)"
3. "Does the frontend need the backend running locally? Or can I develop against a staging API?"

### Design & Assets
4. "Is there a Figma file or design reference I should follow?"
5. "Any brand guidelines? (colors, fonts, logo usage)"
6. "Where do images and assets live? (public folder, CDN, Supabase storage)"

### Testing & Credentials
7. "Are there test accounts I can log in with? (user, admin, seller, etc.)"
8. "What URL do I test against locally? (localhost:3000?)"
9. "Any browser-specific requirements? (Chrome-only features, mobile-specific flows)"

### Write what you learn:

Update `TOOLS.md` with:
- Dev server command and URL
- Component library reference
- Design token locations
- Test account info (where to find credentials, not the secrets themselves)
- Key breakpoints for responsive testing

Update shared docs if {{LEAD_NAME}} missed anything:
- `../shared/STACK.md` — frontend stack corrections
- `../shared/CONVENTIONS.md` — component patterns, naming, styling rules

## Phase 3: Skill Discovery

Search for frontend-relevant skills:

```bash
npx skills find "<technology>"
```

Search for your stack: component library, CSS framework, animation library, form library, etc.
Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Verify You Can Run It

Before you're done, actually verify:

- [ ] Dev server starts without errors
- [ ] You can load the app in a browser
- [ ] You can log in with a test account
- [ ] You've checked both light and dark mode
- [ ] You've checked at least one page at mobile width (375px)
- [ ] `TOOLS.md` has everything you need to do your job
- [ ] `../shared/STACK.md` accurately reflects the frontend stack

## When You're Done

Delete this file. You now know the frontend inside out.

---

_Don't rush this. Missing a component pattern or state management approach now means inconsistency later._
