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
4. Must have a QA PASS verdict from the `<T>:qa` acpx session (captured by `stask qa`)
5. {{HUMAN_NAME}} reviews on GitHub before merge

## Who Can Merge

- Only {{HUMAN_NAME}} merges to `main`
- {{LEAD_NAME}} never merges PRs; the task auto-transitions to Done when {{HUMAN_NAME}} merges

## Migration Safety

- Never run migrations directly in production
- Always test locally first
- {{LEAD_NAME}} reviews migration SQL inside `<T>:qa` before it runs anywhere
- Migrations are irreversible — get it right the first time
