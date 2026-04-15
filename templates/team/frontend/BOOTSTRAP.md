# BOOTSTRAP.md — {{FRONTEND_NAME}} (Frontend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Read the Shared Knowledge

{{LEAD_NAME}} has already documented how to run the project and the tech stack. **Read these first** — don't ask the human questions that are already answered:

- `../shared/PROJECT.md` — what the project is
- `../shared/STACK.md` — full tech stack
- `../shared/ARCHITECTURE.md` — data model, patterns, flows
- `../shared/CONVENTIONS.md` — code style and rules
- `../shared/OWNERSHIP.md` — who owns what
- `../shared/DEV.md` — **how to run the project locally** (follow this to get the app running)
- `../shared/ENV.md` — environment variables

If any of these are missing or incomplete, tell {{LEAD_NAME}} to fix them before you proceed.

## Phase 2: Verify You Can Run It

Follow `../shared/DEV.md` and actually run the project. Don't skip this.

- [ ] Install dependencies
- [ ] Start the dev server
- [ ] Open the app in a browser
- [ ] Log in with the test account from DEV.md
- [ ] Check both light and dark mode
- [ ] Check at least one page at mobile width (375px)

If anything fails, tell {{LEAD_NAME}} — the docs need fixing.

## Phase 3: Deep Frontend Interview

Now ask the human questions **specific to your domain** that {{LEAD_NAME}} wouldn't have covered:

### Design System & Visual Language
1. "What's the design system? (shadcn/ui, MUI, custom components, or a mix?)"
2. "Where are the base components vs custom components? What's the directory structure?"
3. "Are there design tokens? (colors, spacing, typography, breakpoints — where are they defined?)"
4. "Is there a Figma file, design reference, or style guide I should follow?"
5. "Any brand guidelines? (specific colors, fonts, logo usage rules)"

### Component Architecture
6. "What's the component pattern? (server-first? client-heavy? mixed?)"
7. "How do you handle state? (React hooks, context, Zustand, server state via fetch/SWR?)"
8. "What's the data fetching pattern? (server components, client fetch, server actions?)"
9. "How do forms work? (React Hook Form + Zod? Native? Something else?)"
10. "Any animation library? (Framer Motion, CSS transitions, none?)"

### UI Standards
11. "What does 'done' look like for a frontend task? Specifically:"
    - Do I need to test responsive at specific breakpoints? Which ones?
    - Is dark mode mandatory on every component?
    - Do I need loading skeletons for async data?
    - Do I need empty states for every list/grid?
12. "Any pages or components I should look at as 'the gold standard' — the best example of how things should be built?"

### Frontend-Specific Gotchas
13. "Any components that are fragile or tricky? Things that break easily?"
14. "Any CSS or styling gotchas? (z-index wars, global style conflicts, Tailwind purging issues)"
15. "Anything that looks wrong but is intentional? (So I don't 'fix' it)"

### Assets & Media
16. "Where do images and assets live? (public folder, CDN, Supabase storage?)"
17. "Any image optimization patterns I should follow? (next/image, lazy loading, etc.)"

### Write what you learn:

Update `TOOLS.md` with:
- Component library reference and directory structure
- Design token locations
- Key breakpoints for responsive testing
- Figma/design reference links
- Frontend-specific gotchas

Update shared docs if you found errors or gaps:
- `../shared/STACK.md` — frontend stack corrections
- `../shared/CONVENTIONS.md` — component patterns, naming, styling rules
- `../shared/KNOWN-ISSUES.md` — any frontend tech debt

## Phase 4: Map the Frontend (via OpenCode)

Use OpenCode to scan your domain:

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{FRONTEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}/skills/agentic-coding/SKILL.md \
  -- 'Map the frontend of {{PROJECT_ROOT}}. Focus on:
  - Pages and layouts — all routes, what renders where
  - Components — structure, shared vs page-specific, design system
  - Hooks — custom hooks, what state they manage
  - Styling — Tailwind config, CSS variables, design tokens, themes
  - Data fetching — how data flows from server to UI
  - Types — where TypeScript types live, key interfaces'
```

Cross-reference with what the human told you. Update `../shared/ARCHITECTURE.md` with anything missing.

## Phase 5: Skill Discovery

```bash
npx skills find "<your-component-library>"
npx skills find "<your-css-framework>"
npx skills find "<your-animation-library>"
npx skills find "<your-framework>"
```

Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 6: Enrich Your SOUL.md

Now that you know the project, fill in the blanks in SOUL.md:
- **Your Stack** — actual technologies, versions, design system
- **Your Scope** — actual file paths you own
- **Design Principles** — project-specific rules (from interview + CONVENTIONS.md)
- **Boundaries** — specific examples of what's yours vs {{BACKEND_NAME}}'s

## When You're Done

Delete this file. You now know the frontend inside out.

---

_Don't rush this. Missing a component pattern or design system convention now means inconsistency later._
