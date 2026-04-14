# Git Workflow

## Branch Strategy

```
main          — production, always deployable
feature/*     — feature branches (one per task)
fix/*         — bug fix branches
chore/*       — non-feature work (deps, config, refactors)
```

## Branch Naming

Format: `<type>/<short-description-in-kebab-case>`

Always branch off `main`.

## Commit Style

Follow conventional commits:

```
feat: add category filter to explore page
fix: check auth before remix action
chore: update dependencies
docs: add webhook setup notes
refactor: extract utility to shared lib
test: add unit tests for validation
```

Format: `<type>: <short present-tense description>`

Keep commits atomic — one logical change per commit.

## PR Rules

1. PR title matches commit style
2. Description includes: what, why, how to test
3. Must pass type check + lint
4. Must have {{QA_NAME}}'s review
5. {{LEAD_NAME}} gives final approval before merge

## Who Can Merge

- {{LEAD_NAME}} merges after {{QA_NAME}} approves
- Only {{LEAD_NAME}} or {{HUMAN_NAME}} merge to `main`
- No agent merges directly to `main`

## Migration Safety

- Never run migrations directly in production
- Always test locally first
- {{QA_NAME}} reviews migration SQL before it runs anywhere
- Migrations are irreversible — get it right the first time
