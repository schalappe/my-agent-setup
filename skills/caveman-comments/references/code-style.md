# Shared Python and TypeScript Style

Applies to Python, TypeScript, and TSX files.

## Code

- **Naming:** Descriptive, intent-revealing names; avoid abbreviations.
- **Functions:** One focused task; under 50 lines ideal.
- **Formatting:** Use consistent automated formatting.
- **Dead code:** Delete unused code, commented blocks, and imports.
- **DRY:** Extract common logic after 3+ repetitions.
- **YAGNI:** Build only current requirements.
- **Simplicity:** No backward-compatibility hacks unless explicitly required.

## Comments

1. Prefer clear structure and naming over explanatory prose.
2. Keep comments minimal; reserve them for non-obvious or large logic sections.
3. Explain why, not what nearby code does.
4. Apply skill compression rules to every new or touched comment/docstring.
