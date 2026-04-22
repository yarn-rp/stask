# Code Conventions

_Fill in during project setup. These are the rules everyone follows._

## TypeScript

_Document type strictness, where types live, validation approach._

## Server-Side

_Document server action patterns, auth check requirements, error handling._

## Components

_Document component patterns, styling approach, state management._

## File Naming

_Document naming conventions for files, components, types, etc._

## Git / PR / Deployment

- **Workflow:** Always `git pull origin main` → `git checkout -b <branch>` → `git add .` → `git commit` → `git push origin <branch>` → `gh pr create`.
- **Pre-Push Build:** Never push or merge a branch unless `npm run build` succeeds locally with **zero** errors.
- **Environment Check:** Always run `npm install` after a pull to ensure `node_modules` are in sync.
- Every non-trivial change is verified in a fresh `<T>:qa` acpx session before it reaches PR
- DB migrations are reviewed inside `<T>:qa` before running in any environment
