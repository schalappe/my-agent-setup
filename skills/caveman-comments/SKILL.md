---
name: caveman-comments
description: compress code comments while enforcing Python and TypeScript documentation conventions. Use when writing or editing comments, docstrings, JSDoc, Rustdoc, Python, TypeScript, or TSX.
---

Caveman comments: substance stay, fluff die. Why > what.

## Load References

Before editing, load only references matching touched files:

- Python: `references/code-style.md` and `references/python.md`
- TypeScript/TSX: `references/code-style.md` and `references/typescript.md`

## Mode

Once triggered, apply to every new or touched comment/docstring this session.

## Process

1. Load matching references.
2. Prefer self-documenting code; delete prose code already says.
3. Compress survivors: fragments OK; articles, filler, and hedging gone; short words; `X -> Y` for causality.
4. Preserve contracts: technical terms, error strings, types, units, side effects, preconditions, invariants.
5. Use safety exception only when terse risks harm: `unsafe`, security warnings, irreversible ops, tricky preconditions. Full sentences allowed there; return to caveman after.

Comment-only work never changes code, signatures, imports, or behavior. Requested code changes still follow loaded style rules.

Done when every targeted comment/docstring is deleted as restater, left untouched by boundary, or compressed with all contracts preserved.

## Compression Rules

Drop:

- Articles: `a`, `an`, `the`
- Filler: `just`, `really`, `basically`, `simply`
- Pleasantries, throat-clearing, narrative
- Prose repeating nearby code

Prefer:

- Imperative mood
- One word when enough
- `X -> Y` for causality
- Exact domain words over generic synonyms

Bad: `// We need to do this because the API sometimes returns null on rate-limit`
Good: `// API null on rate-limit -> retry once.`

Bad: `// Increment the counter by one`
Good: delete.

## Rust — Rustdoc

Keep `///`, `//!`, and sections (`# Errors`, `# Panics`, `# Safety`, `# Examples`). Compress prose.

```rust
/// Fetch user. Cache stale ≤60s.
///
/// # Errors
/// `Err` if id < 0 or DB unreachable.
fn fetch_user(id: i64) -> Result<User, FetchErr> { ... }
```

## Safety Exception

```rust
/// # Safety
///
/// Caller must ensure `ptr` is non-null, aligned to 8 bytes, and that no
/// other reference to the same memory exists for the duration of this call.
/// Violating either constraint is undefined behavior.
```

## Boundaries

- Rewrite prose inside comments/docstrings only during comment-only work.
- Keep project-required prefixes; compress text after prefix only.
- Keep licenses, generated-file banners, and external spec text exact unless explicitly asked.
