---
name: verify-app
description: Generate or refresh a repo's project-local `verify-<app>` skill that launches the real app, drives its features, and captures evidence.
disable-model-invocation: true
---

# Verify app

Write a project-local skill `verify-<app>` that the next agent reads cold, mid-task, to prove behavior in the real app. Put it in the repo's project skills dir (`.agents/skills/` or `.claude/skills/`; if both exist, the one already holding skills). A `verify-*` skill already there → **refresh mode**.

## 1. Interview the repo

Answer from the code (scripts, README, compose files, CI, existing e2e specs); ask the user only what the repo cannot show.

- **Surface**: web UI, API, CLI, mobile. Pick the primary one; note the rest.
- **Launch**: the repo's own dev command, ports, env vars, migrations, seed data, auth.
- **Drive**: existing harnesses first, then browser for web, HTTP for APIs, a PTY for CLIs.
- **Isolation**: can two instances run side by side? If not, the skill says so.

The checkout does not start → fix it or report the exact failure before generating.

## 2. Write `verify-<app>/SKILL.md`

Frontmatter `name` and a `description` naming the app and surface. Sections use this repo's real commands and selectors:

- **Doctor**: one read-only check: process up, right build, port owned by this run, auth valid.
- **Launch**: the command from an empty data dir (migrations, seeds) and the ready signal: usable, not just a port answering.
- **Drive**: the harness recipe, with any helper script executable and its invocation shown. Prefer stable handles (ARIA roles and names, `data-*`, route paths, prompt strings) over coordinates.
- **Evidence**: what to capture and where. Drive the real user path, never test-only endpoints; capture the action and the resulting state, side effects included.
- **Cleanup**: record each PID at launch (`$!`) and kill by that PID only. Evidence survives cleanup.
- **Maintenance** (verbatim into the generated skill):
  1. Run Doctor first on every use. Launch fails → fix the recipe before testing anything.
  2. A drive fails on a feature the code still has → stale recipe: fix it in the same PR. The code lost the feature → regression: report it, never edit the recipe to pass.
  3. A PR that changes launch, routes, or seeds updates the matching feature file in the same PR.
  4. A scenario blocked because you did not know how to create its data → once you find the recipe, add it to the matching feature file (or a new one) in the same PR, so the next agent is not blocked.

## 3. Seed the feature map

`verify-<app>/features/`: one file per user-facing feature (from routes, commands, menus), starting with at least the top 3. No upper limit: the map grows through Maintenance rule 4. Each file has five short parts:

- **Reach**: how to get there, from the user's point of view.
- **Set up**: how to create the data the feature needs (the real commands or API calls, in order), including the records verifiers most often lack, such as a second type of account or a closed period.
- **Drive**: how to perform the user actions.
- **Proof**: the observable result.
- **Gotchas**: preconditions the seed lacks and states that cannot be produced locally. Never weaken the journey to pass.

## 4. Prove it

Run the generated skill once end to end: Doctor, Launch, drive one mapped feature, capture evidence, Cleanup. Then confirm the evidence still exists and no started PID survives. Fix and rerun until it passes; run Cleanup after every failed attempt. A skill never executed is a draft.

## Refresh mode

Read the existing skill and feature files, interview the repo again, and show the user the diff. Rewrite only stale lines; keep every hand edit that is still true. Add a **Set up** part to feature files that lack one, and add files for features verifiers were blocked on. Then prove it (step 4).
