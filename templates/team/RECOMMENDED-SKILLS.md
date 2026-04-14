# Recommended Skill Sets

To be fully operational, each agent should be equipped with these core process skills. Since project-specific skills (like "Stripe" or "Supabase") vary, these are the "foundational" skills that enable the team to function.

## Lead Agent
- **`technical-spec-design`**: The core of the 6-phase process. Used for requirements, analysis, and final spec creation.
- **`requirements-analysis`**: Used in Phase 1 to resolve ambiguities with the human.
- **`code-review`**: Used in Phase 6 to verify implementation quality and logic.
- **`security-auditor`**: Used during review to identify vulnerabilities.
- **`feature-specification`**: For high-level feature mapping.

## Backend Engineer
- **`agentic-coding`**: Core loop for implementing backend logic via OpenCode.
- **`api-dev`**: Guidelines for REST/RPC design and implementation.
- **`api-security-audit`**: Ensuring endpoints are protected and validated.
- **`database-migrations`**: Framework for idempotent and safe schema changes.
- **`fullstack-conventions`**: Ensuring alignment with the overall project architecture.
- **`debug-pro`**: Advanced troubleshooting and log analysis.

## Frontend Engineer
- **`react-expert`**: Deep knowledge of hooks, state, and component lifecycle.
- **`nextjs-expert`**: App router, server components, and optimization patterns.
- **`shadcn-ui`**: Mastery of the UI library and Radix primitives.
- **`tailwind-design-system`**: Ensuring consistent styling and layout.
- **`responsive-design`**: Mobile-first and breakpoint-specific implementation.
- **`accessibility`**: Ensuring the product is usable for everyone.

## QA Engineer
- **`qa-patrol`**: The primary browser testing and verification loop.
- **`afrexai-qa-test-plan`**: Generating coverage matrices from ACs.
- **`openclaw-api-tester`**: Testing APIs and webhooks without a browser.
- **`playwright-pro`**: Writing persistent E2E test suites.
- **`e2e-testing-patterns`**: Reference for Page Object Models and test pyramids.

---

**Note:** These skills should be installed into each agent's `skills/` directory. When spawning OpenCode, agents must attach the relevant skill via `-f`.