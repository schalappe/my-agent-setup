# CI and hooks

## Files written

| File | From | Tier |
|---|---|---|
| `.github/workflows/<area>.yml` per area | [templates/area.yml](templates/area.yml) + the language file | Floor (audit step: Standard) |
| `.github/actions/setup-<lang>-env/action.yml` per language used | `templates/setup-*-env.yml` | Floor |
| `.github/workflows/security.yml` | [templates/security.yml](templates/security.yml) | Floor (`secrets`); Standard (`workflows`, `pr-title`) |
| `.github/zizmor.yml` | [templates/zizmor.yml](templates/zizmor.yml) | Standard |
| `scripts/install-betterleaks.sh`, executable (`chmod +x`) | [templates/install-betterleaks.sh](templates/install-betterleaks.sh) | Floor |
| `lefthook.yml` | [templates/lefthook.yml](templates/lefthook.yml) | Floor (`secrets`, fix jobs); Standard (the rest) |
| `.github/dependabot.yml` | [templates/dependabot.yml](templates/dependabot.yml) | Floor |
| `.github/workflows/branch-guard.yml` | [templates/branch-guard.yml](templates/branch-guard.yml) | Standard, private-free only ([github.md](github.md)) |

Floor drops every block its template marks "Standard tier". Single-area repo: the workflow is `ci.yml` with `name: CI`, its job is named `check`, `working-directory` is `.`, and the `paths` filters go.

Every workflow keeps: top-level `permissions` at the least it needs (`{}` or `contents: read`), `persist-credentials: false` on checkout, `timeout-minutes` on each job. Workflows that run on PRs add `concurrency` cancelling stale runs. With these and `.github/zizmor.yml`, `uvx zizmor .github/` reports nothing; a finding it still reports is fixed in the workflow, not silenced.

Also in every repo:

- Root `.gitignore`: `.env` and `.env.*` with `!.env.example`, plus each area's build outputs (its language file lists them).
- `README.md` gains a **Development** section: the tools to install (with the `install-betterleaks.sh` line), `lefthook install`, and each area's check command.

## Lefthook

One `lefthook.yml` at the repo root, whatever the number of areas. It comes from the package manager of the area at the root (uv or Bun dev dependency, per the language file). With no Python or Bun area at the root (a monorepo, a Rust repo), install it once per machine: `uv tool install lefthook` (PyPI ships the binary; global: ask first), then `lefthook install`. The README's Development section names the path taken.

The hook runs `betterleaks` from PATH: install it with `scripts/install-betterleaks.sh <version> ~/.local/bin` (global: ask first).

## Monorepo

- One workflow per area, filtered with `paths:` (native, no third-party action). Shared files (a root `bun.lock`, a shared package) go into the `paths` of each area that reads them.
- A job that several areas feed (one database for all contract tests) is the only reason for a `changes` job with a path-filter action, as in fily-verify. Write it only then.
- Root `Makefile` with `check` and `audit` targets that run every area's (`$(MAKE) -C backend check`, `cd frontend && bun run check`): one local command for the whole repo.
- Workspaces stay native: one `uv.lock` per uv workspace, one `bun.lock` per Bun workspace, one `Cargo.lock` per cargo workspace. Dependabot gets one entry per lockfile.

## Pinning

After writing, pin every action: `bun ~/.agents/skills/bootstrap/pin.ts .github/workflows/*.yml .github/actions/*/action.yml`. Exit 1 lists the refs it could not resolve (a branch, a repo with no release): give those a tag and rerun. Dependabot keeps the SHAs current afterwards.

The two pins Dependabot cannot see: `BETTERLEAKS_VERSION` (handled in SKILL.md step 4) and the toolchain files it does not cover (`.python-version`, `packageManager`). Every run of this skill compares them with the latest release and proposes the bump.
