# Git Workflow

## Branch Strategy

```
main          — production, always deployable
dev           — integration branch (optional)
feature/*     — feature branches (one per task)
fix/*         — bug fix branches
chore/*       — non-feature work (deps, config, refactors)
```

## Branch Naming

Format: `<type>/<short-description-in-kebab-case>`

```
feature/agent-search-filters
fix/remix-button-auth-check
chore/update-deps
```

Always branch off `main` (or `dev` if using integration branch).

## Commit Style

Follow conventional commits:

```
feat: add category filter to explore page
fix: check auth before mutation
chore: update dependencies
docs: add setup notes
refactor: extract fee calculation to utilities
test: add unit tests
```

Format: `<type>: <short present-tense description>`

Keep commits atomic — one logical change per commit.

## PR Rules

1. Branch → `main` (or `dev` if using integration branch)
2. PR title matches commit style
3. Description includes: what, why, how to test
4. Must pass type check + lint
5. Must have QA review
6. Lead gives final approval before merge

## Who Can Merge

- Lead merges after QA approves
- Only Lead or Human merge to `main`
- No agent merges directly to `main` without review

## Working with Monorepos (if applicable)

```bash
# Fill in your monorepo commands
```