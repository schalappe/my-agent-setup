---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Tailwind CSS v4

Always use v4 class syntax:

- **No arbitrary brackets when a utility exists**: `aspect-4/3` not `aspect-[4/3]`, `translate-y-10` not `translate-y-[2.5rem]`, `rounded-lg` not `rounded-[4px]`
- **Data attributes without brackets**: `data-popup-open:` not `data-[popup-open]:`
- **Computed max-width**: `max-w-290` not `max-w-[1160px]` (Tailwind v4 supports bare numbers as spacing scale)
- **No `@apply` in CSS** — use utility classes directly in JSX

When unsure about a class, check the Tailwind v4 docs via Context7 MCP before using arbitrary value syntax.
