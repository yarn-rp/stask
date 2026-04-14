# TOOLS.md — {{LEAD_NAME}} (Tech Lead)

_Environment-specific tools and references. Update during bootstrap._

## stask Commands (Quick Reference)

```bash
# Check for pending work
stask --project {{PROJECT_SLUG}} heartbeat {{LEAD_NAME_LOWER}}

# Create a task with spec
stask create --name "Feature name" --spec shared/specs/<task>.md --type Feature

# Transition task status
stask transition T-XXX "In-Progress"
stask transition T-XXX "Ready for Human Review"
stask transition T-XXX Done

# Create subtasks
stask subtask create --parent T-XXX --name "Backend: ..." --assign {{BACKEND_NAME_LOWER}}
stask subtask create --parent T-XXX --name "Frontend: ..." --assign {{FRONTEND_NAME_LOWER}}

# Update spec after changes
stask spec-update T-XXX --spec shared/specs/<task>.md

# List tasks
stask list --status "In-Progress"
stask list --assignee {{LEAD_NAME_LOWER}}
```

## Spec Template Location

Save specs to: `../shared/specs/<task-name>.md`

## Project Root

`{{PROJECT_ROOT}}`

## Spawning Agents

```js
sessions_spawn({
  agentId: "{{BACKEND_NAME_LOWER}}",
  cwd: "{{OPENCLAW_HOME}}/workspace-{{PROJECT_SLUG}}/{{BACKEND_NAME_LOWER}}",
  runtime: "subagent",
  task: "..."
})
```

---

_Add project-specific tools, paths, and shortcuts as you discover them during bootstrap._
