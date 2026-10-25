# TypeScript area (Bun)

## Create

In this order: the age gate must exist before the first install, and `bun init` already installs `@types/bun`.

1. Write `bunfig.toml` (below) in the area.
2. `bun init -y` (Blank; `--react` for a React app). It writes `index.ts` at the area root: move it to `src/index.ts`, point `module` (and `exports` for a library) in `package.json` at it, and update the README's run command.
3. Remove the `CLAUDE.md` that `bun init` writes when it detects Claude Code: the `agents-md` skill owns agent docs.
4. Pin Bun: `"packageManager": "bun@<version>"` in `package.json`, from `bun --version`. When a newer Bun exists, the plan proposes `bun upgrade` first (global: ask).
5. Dev tools: `bun add -d @biomejs/biome`. `bun init` lists `typescript` under `peerDependencies`, and `bun add -d typescript` only bumps that range: edit `package.json` to delete the `peerDependencies` entry and add `typescript` to `devDependencies`, then `bun install`. Replace `"@types/bun": "latest"` with `^` and the installed version.
6. `bunx biome init`, then `bunx biome check --write .` once: the files `bun init` wrote are not Biome-formatted, and `biome ci` would fail on them.
7. `tsconfig.json` keeps `"strict": true`; add `"noUncheckedIndexedAccess": true` when `bun init` did not.
8. A first test, `src/<name>.test.ts`, asserts one fact about the module. `bun test` fails on an empty suite.

## Configure

`bunfig.toml`:

```toml
[install]
# Refuse releases younger than 7 days (in seconds); most hijacked packages are pulled within that window.
minimumReleaseAge = 604800
```

`biome.json`: keep what `biome init` wrote, and set `"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }` so Biome skips ignored files.

## Check command

`package.json` scripts:

```json
{
  "check": "biome ci . && tsc --noEmit && bun test",
  "audit": "bun audit --audit-level=high"
}
```

`bun audit` has no production-only mode (Bun 1.4): it rates dev tools too. `--ignore=<GHSA>` silences one advisory, with the reason in the PR.

## CI

- Composite action: [templates/setup-bun-env.yml](templates/setup-bun-env.yml) → `.github/actions/setup-bun-env/action.yml`.
- In [templates/area.yml](templates/area.yml):
  - `<setup>`: `uses: ./.github/actions/setup-bun-env` with `working-directory: <area>`;
  - `<check command>`: `bun run check`;
  - `<audit command>`: `bun run audit`.

## Hooks

- Pre-commit fix job: `glob: "*.{ts,tsx,js,jsx,json,css}"`, `run: bunx biome check --write --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}`.
- Lefthook source when this area sits at the repo root: `bun add -d lefthook` and `"prepare": "lefthook install"` in `scripts`, so `bun install` installs the hooks.
- `.gitignore`: `bun init` writes one in the area; the repo root still needs `node_modules/` when the area is not at the root.

## Dependabot

`package-ecosystem: bun`, `directory` = the folder holding `bun.lock` (the workspace root in a Bun workspace).

## CodeQL language (public repos)

`javascript-typescript`
