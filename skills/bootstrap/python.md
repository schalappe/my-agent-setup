# Python area (uv)

## Create

In this order: the age gate must exist before the first `uv add`, or the lock takes releases it would refuse.

1. App or CLI: `uv init --app --package --python <minor> <name>`; library: `uv init --lib --python <minor> <name>`. `<minor>` is the newest Python minor Dependabot supports: it lags new Python releases (3.14 while 3.15 is out, October 2026), and a newer one fails every uv update with `tool_version_not_supported`. Step 5's Dependabot runs confirm it; on that error, go one minor lower. Without `--python`, uv picks the newest one already installed. Both use the `src/` layout, write `.python-version`, and set the `uv_build` backend.
2. Write the configuration below into `pyproject.toml`.
3. Dev tools: `uv add --dev ruff pyrefly pytest`.
4. A first test, `tests/test_<package>.py`, imports the package and asserts one fact about it. pytest exits 5 on an empty suite, which would turn CI red for no reason.

## Configure (`pyproject.toml`)

```toml
[tool.uv]
# Refuse releases younger than 7 days; most hijacked packages are pulled within that window.
# uv.lock records the span (exclude-newer-span), so every machine resolves the same way.
exclude-newer = "7 days"

[tool.ruff]
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "UP", "SIM", "RUF"]

[tool.pyrefly]
project-includes = ["src", "tests"]
```

- Standard tier, library, or anything with users: add `preset = "strict"` under `[tool.pyrefly]`.
- A package that must be newer than 7 days (an urgent fix): `exclude-newer-package = { <pkg> = false }` in `[tool.uv]`, with the reason in a comment.

## Check command

`Makefile` in the area:

```make
.PHONY: check audit

check:
	uv run ruff format --check .
	uv run ruff check .
	uv run pyrefly check
	uv run pytest -q

# uv's audit is experimental (uv 0.13): the flag silences the warning. It queries OSV and exits 1 on any
# known vulnerability; `--ignore-until-fixed <ID>` silences one with no fix yet, with the reason beside it.
audit:
	uv audit --preview-features audit-command
```

## CI

- Composite action: [templates/setup-python-env.yml](templates/setup-python-env.yml) → `.github/actions/setup-python-env/action.yml`.
- In [templates/area.yml](templates/area.yml):
  - `<setup>`: `uses: ./.github/actions/setup-python-env` with `working-directory: <area>`;
  - `<check command>`: `make check`;
  - `<audit command>`: `make audit`.

## Hooks

- Pre-commit fix job: `glob: "*.py"`, `run: uv run ruff format {staged_files} && uv run ruff check --fix {staged_files}`.
- Lefthook source when this area sits at the repo root: `uv add --dev lefthook`, then `uv run lefthook install`.
- `.gitignore` (repo root): `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`. `uv init` writes none inside an existing git repo.

## Dependabot

`package-ecosystem: uv`, `directory` = the folder holding `uv.lock`.

## CodeQL language (public repos)

`python`
