# AGENTS.md — Example Project Template

> Copy this file into a repository as `AGENTS.md`, replace every placeholder, and delete irrelevant sections. Keep repository facts here; keep generic assistant behavior in the global agent instructions.

## Project

`<Project name>` — `<one-sentence product and user outcome>`.

### Repository map

- `<path>/` — `<responsibility, language/runtime, important constraints>`
- `<path>/` — `<responsibility, language/runtime, important constraints>`
- `<path>/` — `<shared source of truth, generated output, or contract ownership>`

Nested instructions:

- `<path>/AGENTS.md` — `<scope>`
- `<path>/AGENTS.md` — `<scope>`

Long workflows live in `<docs-or-skills-path>/`; do not duplicate them here.

## Sources of Truth

| Concern | Source of truth | Derived/generated output |
|---|---|---|
| API contracts | `<path>` | `<path>` |
| Database schema | `<path>` | `<path>` |
| Configuration | `<path>` | `<path or none>` |
| Design tokens | `<path>` | `<path or none>` |

When changing a cross-layer contract, update in this order:

1. `<source of truth>`
2. `<producer/server>`
3. `<consumer/client>`
4. `<generated artifacts/docs>`

Never edit generated files directly: `<paths or patterns>`.

## Required Workflow

A task is complete only when the relevant loop is green.

```bash
<install command>
<fast static-check command>
<unit-test command>
<integration-test command>
<build command>
```

For another application/package:

```bash
cd <path>
<check command>
<test command>
<build command>
```

Rules:

- For bugs, reproduce first. For non-trivial behavior, prefer a failing test first.
- Run `<fast check>` after meaningful edits; run the full relevant loop before completion.
- Never disable, skip, or weaken a check to make the loop green.
- Do not run non-terminating commands for verification. Known long-running commands: `<commands>`.
- If environment-dependent verification cannot run, report exactly what is missing and what remains unverified.

## Architecture

Primary request/data flow:

```text
<UI/entrypoint> → <application layer> → <domain/service layer> → <adapter/repository> → <external system>
```

Key invariants:

- `<layer>` may depend on `<layer>`, never the reverse.
- `<entrypoints>` do not access `<database/external system>` directly.
- `<business logic>` belongs in `<path/layer>`, not `<path/layer>`.
- `<important consistency, sync, ownership, or transaction invariant>`.

### Where things live

| Need | Location |
|---|---|
| Authentication/authorization | `<path>` |
| API schemas/contracts | `<path>` |
| Domain logic | `<path>` |
| Persistence/database access | `<path>` |
| Migrations | `<path>` |
| Configuration/environment variables | `<path>` |
| Shared UI/design system | `<path>` |
| CI/release pipeline | `<path>` |

Ask before adding a new top-level directory or introducing a new architectural layer.

## Domain Vocabulary

Use one term per concept.

| Concept | Use | Avoid |
|---|---|---|
| `<meaning>` | `<canonical term>` | `<synonyms not used here>` |
| `<meaning>` | `<canonical term>` | `<synonyms not used here>` |
| `<meaning>` | `<canonical term>` | `<synonyms not used here>` |

Naming conventions:

- Functions: `<pattern and example>`
- Booleans: `<pattern and example>`
- Routes/events: `<pattern and example>`
- Database objects: `<pattern and example>`
- Files/tests: `<pattern and example>`
- User-facing copy: `<capitalization/localization rules>`

## Type and Boundary Rules

- Strictness settings that must remain enabled: `<settings>`.
- Parse all external input with `<schema/validation mechanism>` at `<boundary>`.
- Infer types from `<source of truth>`; do not duplicate schemas and handwritten types.
- Forbidden escapes: `<for example: any, unchecked casts, force unwraps, ignore directives>`.
- Exceptions require `<comment, issue link, approval, or other policy>`.

## Data and Migrations

- Migration policy: `<append-only / editable until release / other>`.
- Generate a migration with `<command>`; apply it with `<command>`.
- Never `<known dangerous migration behavior>`.
- Transaction boundary: `<rule>`.
- Pagination/bounded-read rule: `<rule>`.
- New query patterns require `<index/explain/benchmark policy>`.

## Error Handling and Observability

- Expected failures use `<typed error/result convention>`.
- Public error shape:

```json
{
  "error": {
    "code": "<stable_machine_code>",
    "message": "<actionable message>",
    "details": {}
  }
}
```

- Unexpected errors propagate to `<global handler/monitoring system>`.
- Never use empty catches or success responses for failures.
- Structured log fields: `<requestId, actorId, entityId, etc.>`.
- Never log: `<tokens, secrets, sensitive personal data>`.

## Dependencies

Before adding a dependency:

- Confirm the platform or an existing dependency does not already solve the problem.
- Check maintenance, release activity, ownership, license, security history, and ecosystem adoption.
- Ask before adding dependencies in `<sensitive areas>` or before adding any runtime dependency, if that is project policy.
- Pin according to `<version policy>` and commit `<lockfile>`.

Forbidden or preferred packages/frameworks:

- Prefer: `<list and why>`
- Do not use: `<list and why>`

## Performance and Reliability Budgets

- `<operation>`: `<latency/throughput/memory/bundle-size budget>`.
- Lists/queries: `<pagination and maximum size>`.
- Avoid `<N+1, unbounded reads, main-thread work, duplicate network calls, etc.>`.
- For changes touching `<large dataset/hot path>`, run `<profiling command>` and report `<evidence>`.
- Retry/idempotency/time-out policy: `<rules>`.

## Product-Level Verification

For changes spanning multiple layers, exercise the real user flow:

1. `<setup>`
2. `<happy path action and expected observation>`
3. `<persistence/external side-effect check>`
4. `<important unhappy paths>`

For UI changes:

- Inspect every changed state: loading, empty, populated, error, disabled, and success.
- Check `<supported viewport/device sizes>`, `<themes>`, and `<accessibility settings>`.
- Use realistic data from `<seed/fixture path>`.
- Capture screenshots or recordings with `<tool/process>`.

## Security and Privacy

- Authentication lives in `<path>`; authorization is enforced at `<boundary>`.
- Secrets/configuration come from `<mechanism and documented file>`.
- Sensitive data classification: `<brief rules or link>`.
- Critical state changes must emit `<audit event/log>`.
- Security review workflow: `<link/path>`.

## Failure Log

Add a short imperative rule only after a real project-specific failure or correction. Keep the cause or trap clear enough to prevent recurrence.

- Do not run `<command>` for verification; it does not terminate. Use `<command>`.
- Run `<prerequisite>` before `<command>`, otherwise `<specific failure>`.
- Do not edit `<generated path>`; regenerate it with `<command>`.
- `<domain-specific invariant that is easy to violate>`.

## Keeping This File Current

- Keep this file project-specific and concise; target `<line limit>` lines or fewer.
- Add discovered architecture facts to the relevant section.
- Add recurring mistakes to the failure log in the same change that fixes them.
- Move subsystem-only rules to the nearest nested `AGENTS.md`.
- Move long procedures to `<docs-or-skills-path>` and link them here.
- Delete stale, redundant, aspirational, or unenforceable rules.
