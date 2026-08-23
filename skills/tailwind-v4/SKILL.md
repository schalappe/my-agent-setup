---
name: tailwind-v4
description: Enforces Tailwind CSS v4 utility syntax. Use when writing or reviewing TSX or CSS that uses Tailwind CSS v4.
---

# Tailwind CSS v4

Always use Tailwind CSS v4 class syntax:

- Use a built-in utility instead of arbitrary brackets: `aspect-4/3`, not `aspect-[4/3]`; `translate-y-10`, not `translate-y-[2.5rem]`; `rounded-lg`, not `rounded-[4px]`.
- Use data attribute variants without brackets: `data-popup-open:`, not `data-[popup-open]:`.
- Use bare spacing values for computed max widths: `max-w-290`, not `max-w-[1160px]`.
- Do not use `@apply` in CSS. Put utility classes directly in JSX.

When unsure whether a utility exists, check the current Tailwind CSS v4 documentation via Context7 before using arbitrary value syntax.
