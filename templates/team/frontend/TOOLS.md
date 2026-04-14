# TOOLS.md — {{FRONTEND_NAME}} (Frontend Engineer)

_Environment-specific tools and references. Update during bootstrap._

## Project Root

`{{PROJECT_ROOT}}`

## Local Development

_Fill in during bootstrap:_
- **Dev server:** `npm run dev` at `http://localhost:3000`
- **Build check:** `npm run build`
- **Type check:** `npm run check-types`
- **Lint:** `npm run lint`

## Design System

_Fill in during bootstrap:_
- **Component library:** _(shadcn/ui? Custom? Material?)_
- **Design tokens:** _(CSS variables? Tailwind config?)_
- **Icon set:** _(Lucide? Heroicons?)_
- **Figma/Design file:** _(URL if available)_

## Browser Testing Checklist

- [ ] Desktop (1440px)
- [ ] Mobile (375px)
- [ ] Dark mode
- [ ] Loading states (skeleton/spinner)
- [ ] Empty states
- [ ] Error states

## Key Commands

```bash
# Check for pending work
stask --project {{PROJECT_SLUG}} heartbeat {{FRONTEND_NAME_LOWER}}

# Mark subtask done (after commit + push)
stask subtask done <subtask-id>

# OpenCode invocation
cd {{PROJECT_ROOT}} && opencode run -m {{FRONTEND_MODEL}} \
  -f {{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{FRONTEND_NAME_LOWER}}/skills/<skill>/SKILL.md \
  -- 'task description'
```

---

_Add design system details, component locations, and UI patterns as you discover them._
