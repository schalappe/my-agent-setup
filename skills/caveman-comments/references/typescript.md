# TypeScript and TSX

## JSDoc on Business Logic

Always document business-logic modules: services, repositories, helpers, and utilities.

- **Module:** Top-level `@module` JSDoc states responsibility.
- **Exported functions:** Keep `@param`, `@returns`, and applicable `@throws` tags.
- **Non-obvious behavior:** Document side effects, preconditions, and business rules.
- Keep tag bodies terse; preserve tags and contracts.

```ts
/**
 * @module userService
 * Fetch users. Cache stale ≤60s.
 */

/**
 * Fetch user by id.
 * @param id - User id. Negative -> throws.
 * @returns Hydrated user. Never null.
 * @throws {RangeError} id < 0.
 */
```

## Comment Prefixes

Preserve prefix; compress only trailing prose.

| Prefix    | Purpose                                          |
| --------- | ------------------------------------------------ |
| `// [!]:` | Warning, gotcha, pitfall, critical note          |
| `// [>]:` | Explanation, reason, context, business logic     |
| `// [?]:` | Question, uncertainty, needs review              |
| `// [@]:` | TODO, future improvement, planned change         |
| `// [~]:` | Workaround, hack, temporary fix                  |
| `// [&]:` | Dependency, external API behavior, library quirk |
