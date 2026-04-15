# BOOTSTRAP.md — {{FRONTEND_NAME}} (Frontend Engineer)

_Spawned by {{LEAD_NAME}} for exploration. Delete when done._

## Your Task: Autonomous Frontend Exploration

{{LEAD_NAME}} spawned you to explore the frontend of {{PROJECT_NAME}}. **Do NOT ask the human any questions.** Explore the codebase via OpenCode, write your findings to `../shared/artifacts/bootstrap-frontend.md`, then terminate.

The human will review your findings later with {{LEAD_NAME}}. If you have questions, write them into your artifact — don't ask them live.

## Phase 1: Deep Exploration via OpenCode

```bash
cd {{PROJECT_ROOT}} && opencode run -m {{FRONTEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}/skills/agentic-coding/SKILL.md \
  -- 'Deep frontend analysis of {{PROJECT_ROOT}}. Map:

  1. Routing & pages: all routes, layouts, nested layouts, dynamic segments.
  2. Component system: component library (shadcn, MUI, custom), directory structure (ui/ vs components/), design system patterns.
  3. Styling: CSS framework, design tokens (colors, spacing, typography), themes, dark mode support, breakpoints.
  4. State management: client state (hooks, context, Zustand, Redux), server state (SWR, React Query, server components), form state.
  5. Data fetching: server components fetch? client fetch? server actions? how is loading/error handled?
  6. Animation & interaction: Framer Motion, CSS transitions, gesture handling.
  7. Types: where TypeScript types live, key interfaces.
  8. Potential tech debt: inconsistent components, CSS hacks, any-types, commented-out code, duplicated logic.
  9. Questions: things you cannot determine from the code alone.

  Output a structured markdown report.'
```

## Phase 2: Cross-Reference with Shared Docs

Read whatever shared docs already exist:
- `../shared/STACK.md` — if it exists, confirm your findings match
- Any README in the project root

## Phase 3: Write Findings

Write a structured report to `../shared/artifacts/bootstrap-frontend.md`:

```markdown
# Frontend Exploration — {{FRONTEND_NAME}}

## Stack
- Framework (Next.js? version?), component library, CSS framework, animation library
- Versions detected (package.json)

## Routing & Pages
- Key routes, layouts, dynamic segments
- Server vs client components split

## Component System
- Library used (shadcn/MUI/custom)
- Directory convention (components/ui/, components/cult/, etc.)
- Base components vs composed components

## Styling
- CSS framework (Tailwind? version?)
- Design tokens location
- Dark mode approach
- Breakpoints in use

## State & Data
- Client state approach
- Server state approach
- Data fetching patterns (server component? SWR? server action?)
- Form library (React Hook Form + Zod? native? other?)

## Patterns Observed
- Loading states (skeleton? spinner? nothing?)
- Empty states
- Error states
- Responsive approach (mobile-first?)
- Dark mode parity

## Tech Debt Candidates
_Patterns I think might be tech debt — the human will confirm or reject:_
- [Item 1 — what it is, why it might be tech debt]
- [Item 2 — ...]

## Questions for the Human
- [Specific questions I could not answer from code alone]

## Recommended Scope
_Suggested list of frontend file paths/directories I should own, based on what I found_
```

## Phase 4: Enrich Your Own Files

Based on what you discovered, enrich your own templates:
- Update `SOUL.md` — fill in "Your Stack" with actual technologies found
- Update `TOOLS.md` — add commands, paths, references specific to this project

## Phase 5: Terminate

You're done. {{LEAD_NAME}} will read your artifact and present findings to the human.

Delete this BOOTSTRAP.md file when you've finished writing your artifact.

---

_Don't ask questions live. Write them into your artifact. {{LEAD_NAME}} runs the human conversation._
