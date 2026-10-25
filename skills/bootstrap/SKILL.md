---
name: bootstrap
description: "Start a project, or bring an existing one up to standard: toolchain (uv, bun, cargo), quality checks, secret scanning, dependency updates, CI, and GitHub security settings."
disable-model-invocation: true
---

# Bootstrap

Set up a repo so that:

- one local command runs lint, format, type, and test checks, and CI runs the same command;
- a commit holding a secret is refused;
- Dependabot opens dependency update PRs;
- every action is pinned to a commit SHA.

The run has six steps: explore, ask what the repo cannot show, plan, write, prove, hand off.

A repo that already has some of this → **upgrade mode**: the same steps, but every existing file is compared, not overwritten (step 4).

## Boundaries

This skill owns the toolchain, quality checks, security floor, CI, hooks, and GitHub settings. It ends by offering the skills that own the rest: `agents-md` (AGENTS.md), `setup-repo` (issue tracker, labels, domain docs), `verify-app` (driving the real app).

## 1. Explore

Read what exists; assume nothing.

- Empty folder, plain folder, or git repo? `git remote -v` → GitHub owner/name.
- Visibility and plan: `gh repo view --json visibility,owner`, then probe `gh api repos/{o}/{r}/rulesets`. A 403 "Upgrade to GitHub Pro" means no rulesets or branch protection: the **private-free** branch of [github.md](github.md). Decide from this probe, never from the docs, which disagree. No remote yet: a private repo is planned as private-free, and the probe runs right after `gh repo create` to confirm.
- **Areas**: each directory holding `pyproject.toml`, `package.json`, or `Cargo.toml`. Workspaces (`[tool.uv.workspace]`, `workspaces` in `package.json`, `[workspace]` in `Cargo.toml`) group several into one area per lockfile. More than one area → monorepo ([ci.md](ci.md#monorepo)).
- Existing floor: `.github/workflows/`, `.github/dependabot.yml`, `lefthook.yml` or `.githooks/`, `.gitleaks.toml`/`.betterleaks.toml`, `Makefile`, lockfiles, `.python-version`, `rust-toolchain.toml`, `packageManager`.
- Machine: versions of `uv`, `bun`, `cargo`/`rustup`, `lefthook`, `betterleaks`, `gh` (logged in). Compare each with its latest release (`gh api repos/{o}/{r}/releases/latest --jq .tag_name`).

## 2. Ask

One `AskUserQuestion` call, only for what exploration left open, recommended answer first:

- **Languages and kind** per area: Python, TypeScript, Rust; app, library, or CLI.
- **Visibility** (new repo only): private or public. Public unlocks GitHub's free secret scanning, push protection, CodeQL, and rulesets.
- **Tier**:
  - **Floor** (default for sandboxes, ML experiments, learning): checks in CI, secret hook and history scan, Dependabot, pinned actions, release-age gates.
  - **Standard** (anything with users or a deploy): Floor plus dependency audit in CI, workflow audit (zizmor), Conventional Commit messages and PR titles, protected default branch.

## 3. Plan

Show, then wait for approval:

- every file to create or change, per area, from the language files ([python.md](python.md), [typescript.md](typescript.md), [rust.md](rust.md)), [ci.md](ci.md), and [github.md](github.md);
- every install or upgrade outside the repo (a global tool, a GitHub setting), with its version and cost. These change the machine or the remote: ask, never install silently;
- in upgrade mode, the diff per existing file.

## 4. Write

Templates live in [templates/](templates/). Fill the placeholders (`<area>`, `<default-branch>`, …); keep the comments that explain a choice.

- **No version is written from memory.** Tool versions come from the latest release at run time. Actions are written `owner/repo@LATEST` and pinned by [pin.ts](pin.ts): `bun ~/.agents/skills/bootstrap/pin.ts .github/workflows/*.yml .github/actions/*/action.yml`. `github/codeql-action` releases bundles, not action versions: write its major tag (`@v4`), not `@LATEST`.
- **Upgrade mode** compares named units, not text: a workflow job, a step (by `name` or `uses`), a lefthook job, a Dependabot entry (ecosystem and directory), a Makefile target, a `package.json` script, a TOML table. For each unit, after filling placeholders and ignoring pinned SHAs:
  - identical: leave it;
  - missing: add it;
  - different: show both, recommend one, ask;
  - absent from the templates (hand-written): keep it verbatim.

  Running the skill twice changes nothing the second time.
- Existing `.gitleaks.toml` and `.gitleaksignore` stay: Betterleaks reads them.
- **Betterleaks is the one pin Dependabot cannot see.** Every run compares `BETTERLEAKS_VERSION` in `security.yml` and the local `betterleaks version` with the latest release, and proposes the bump for both (`scripts/install-betterleaks.sh <version> ~/.local/bin` locally). Between runs, the workflow's "Betterleaks is current" step warns.

## 5. Prove

The run is done when each of these was observed, not assumed:

- each area's check command passes locally (`make check`, `bun run check`, `cargo …`, per the language file);
- `actionlint` and `uvx zizmor .github/` report nothing on the generated workflows;
- the hook refuses a planted fake secret, tested before the first commit or on a branch (on `main` the `protected-branch` job fails too and muddies the result): stage a file holding `ghp_` + 36 random alphanumerics (`LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36`; a regular sequence like `abc…789` scores too low to count as a secret), `git commit` fails naming the file, then unstage and delete it;
- after the first push, every run is green: `gh run list --commit <sha>`, then `gh run watch <id> --exit-status` per run. That includes the dynamic runs GitHub starts itself: "Dependabot Updates" (one per ecosystem; its log names a rejected config or tool version) and "CodeQL Setup" on public repos;
- the same on a first PR that touches every area: `gh pr checks <n> --watch`;
- `gh api` reads back each GitHub setting that was changed.

A failing step is fixed and rerun, or reported with its output. Never report success over a red or skipped check.

## 6. Hand off

Report what changed, what each check now protects, and what the user must still do (a secret to add, a GitHub setting the plan refused). Then offer `agents-md`, `setup-repo`, and `verify-app`.
