# Review Template

Copy this file to `shared/reviews/<task-name>.md` when reviewing a task.

---

## Review: <task title>

**Task spec:** `../specs/<task-name>.md`
**Reviewed by:** {{LEAD_NAME}}
**Date:** YYYY-MM-DD
**Status:** ✅ Approved | ⚠️ Approved with notes | ❌ Changes required

---

### Checklist

#### Code Quality
- [ ] TypeScript — no `any`, no unsafe casts
- [ ] No leftover `console.log`
- [ ] Lint passes
- [ ] Types pass

#### Correctness
- [ ] Auth check present on all mutations
- [ ] Error handling on all external calls
- [ ] Edge cases covered (empty, loading, error states)
- [ ] Revalidation on correct routes

#### Database (if applicable)
- [ ] Migration named correctly
- [ ] New tables have RLS policies
- [ ] Indexes on queried columns
- [ ] Migration is safe to run

#### Payments / Integrations (if applicable)
- [ ] Correct client initialization
- [ ] Shared utilities used for calculations
- [ ] Webhook signature verified
- [ ] Test mode verified

#### UI (if applicable)
- [ ] Desktop tested
- [ ] Mobile tested
- [ ] Dark mode tested
- [ ] Loading/empty states present

---

### Issues Found

#### Critical (must fix before merge)
- [ ] None

#### Warnings (fix recommended)
- [ ] None

---

### Notes

_Anything worth documenting for future reference._

---

### Decision

**Returning to:** <agent name>
**Next action:** <merge | fix and resubmit | escalate to Lead>