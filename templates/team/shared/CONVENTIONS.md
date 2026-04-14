# Code Conventions

_Fill in during project setup. Document your code style and conventions._

## TypeScript

- Strict mode — no `any`, no implicit casts
- All types live in `lib/types/` or equivalent

## Server Actions / API Routes

```typescript
// Always: auth check first
// Always: return consistent shape { success } | { error }
// Never throw to client
```

## Database / External Calls

```typescript
// Always check errors
// Log errors with context
// Use caching where appropriate
// Always revalidate after mutations
```

## Components

- Functional components only, typed props (no `any`)
- Server components by default — add `"use client"` only when needed
- Component library for UI primitives — extend, don't rewrite
- Tailwind utilities over custom CSS
- Dark mode: always test both modes

## File Naming

- Components: kebab-case files, PascalCase exports
- Server actions: camelCase exports
- Types: PascalCase interfaces/types

## Git / PR / Deployment

- **Workflow:** Always branch from main, commit, push, PR.
- **Pre-Push Build:** Never push or merge unless build succeeds with **zero** errors.
- **Environment Check:** Always run `npm install` after a pull.
- Every non-trivial change goes through QA review
- DB migrations require QA sign-off before running
- Payment/security changes require Lead approval