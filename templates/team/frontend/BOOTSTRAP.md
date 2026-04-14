# BOOTSTRAP.md — {{FRONTEND_NAME}} (Frontend Engineer)

_First-run onboarding. This file guides your initial project exploration and setup. Delete it when done._

## Phase 1: Deep Frontend Analysis

You need to understand every UI pattern, component, and design decision before building anything.

### 1. Map the Frontend

Use the `gsd` skill's `map-codebase` workflow focused on your domain:

```
Map the frontend of {{PROJECT_ROOT}}. Focus on:
- app/ — all pages, layouts, route groups, loading/error states
- components/ — UI component library, naming patterns, composition
- hooks/ — custom React hooks, state management patterns
- lib/types/ — TypeScript type definitions, shared interfaces
- lib/utils.ts — utility functions
- app/globals.css + tailwind.config.ts — styling setup, design tokens, custom classes
- public/ — static assets, fonts, images
```

### 2. Understand the Design System

Identify:
- Component library (shadcn/ui? Custom? Material?)
- Color palette and design tokens (CSS variables? Tailwind config?)
- Typography scale
- Spacing/layout system
- Icon set (Lucide? Heroicons? Custom?)
- Animation library (Framer Motion? CSS transitions?)
- Dark mode implementation (next-themes? CSS? Manual?)
- Responsive breakpoints (mobile-first? Desktop-first?)

### 3. Map State Management

For each state pattern found:
- Server state (React Server Components? SWR? React Query?)
- Client state (useState? Context? Zustand? Redux?)
- Form state (React Hook Form? Formik? Native?)
- URL state (searchParams? Dynamic routes?)

### 4. Review Shared Knowledge

Read and verify:
- `../shared/STACK.md` — Does the frontend stack match?
- `../shared/CONVENTIONS.md` — Are component conventions followed?
- `../shared/OWNERSHIP.md` — Does the frontend file map match reality?

Update anything wrong or missing.

## Phase 2: Environment & Design Interview

Ask the human:

### Development Setup
1. "How do I run the dev server? Any special setup needed?"
2. "Is there a Figma/design file I should reference?"
3. "Are there design guidelines or a style guide?"

### Design Decisions
4. "What's the design philosophy? Minimal? Bold? Corporate? Playful?"
5. "Mobile-first or desktop-first? What are the key breakpoints?"
6. "Dark mode — is it required? How should it behave?"
7. "Any accessibility requirements? (WCAG level, screen reader support)"

### Component Patterns
8. "Are there preferred component patterns? (Composition? Render props? Slots?)"
9. "How should loading states look? (Skeletons? Spinners? Shimmer?)"
10. "How should empty states look? (Illustrations? Text? CTAs?)"

## Phase 3: Skill Discovery

Search skills.sh for frontend-relevant skills:

```bash
npx skills find "<technology>"
```

Search for: UI framework, component library, CSS framework, animation library, form handling, etc.
Install valuable matches: `npx skills add <owner/repo@skill>`

## Phase 4: Document Everything

Update these files:
- **TOOLS.md** → Dev server URL, design system paths, browser testing checklist, key component locations
- **SOUL.md** → Enrich "Your Stack" section with actual technologies, add design principles discovered
- **../shared/CONVENTIONS.md** → Add any missing frontend conventions
- **../shared/DEV.md** → Update with frontend-specific dev setup

## When You're Done

Delete this file. You now understand every pixel.

---

_The details matter. A missing breakpoint or wrong color token shows up in every page._
