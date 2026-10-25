# Rust area (cargo)

## Create

- Binary: `cargo new <name>`; library: `cargo new --lib <name>`. Edition 2024.
- `cargo generate-lockfile`: `cargo new` writes none, and `--locked` in the check needs one. Commit `Cargo.lock` for binaries and libraries alike.
- Pin the toolchain, `rust-toolchain.toml`. The next `cargo` call downloads that toolchain into `~/.rustup` (and may self-update rustup): list it in the plan as a global install.

  ```toml
  [toolchain]
  channel = "<latest stable, e.g. 1.99.1>"
  components = ["clippy", "rustfmt"]
  ```

- A first test (a `#[test]` beside the code) asserts one fact about it.

## Configure

Standard tier, `Cargo.toml`:

```toml
[lints.clippy]
pedantic = { level = "warn", priority = -1 }
```

An app or a crate not meant for crates.io: `publish = false` under `[package]`, so the license check skips the crate itself.

`deny.toml`: run `cargo deny init`, then:

- `[licenses] allow`: the licenses the current dependencies use (`cargo deny list` shows them). An empty list fails every dependency; a crate with none passes.
- `[licenses.private]`: flip the `ignore = false` that `init` wrote to `true` (a second `ignore` key is a parse error). Unpublished crates (`publish = false`) then need no license; a crate published to crates.io sets `license` instead.
- `[sources] unknown-registry = "deny"`, `unknown-git = "deny"`: crates come from crates.io only.
- `[bans] multiple-versions = "warn"`.

## Check command

`Makefile` in the area:

```make
.PHONY: check audit

check:
	cargo fmt --check
	cargo clippy --all-targets --locked -- -D warnings
	cargo test --locked

# Advisories (RustSec), licenses, banned crates, and sources, from deny.toml.
audit:
	cargo deny check
```

`cargo-deny` is a global install (`cargo install --locked cargo-deny`): ask before installing it.

## CI

The runner image ships rustup; `rustup toolchain install` with no argument installs the toolchain `rust-toolchain.toml` names.

- In [templates/area.yml](templates/area.yml), drop the `<setup-action>` paths lines (no composite action), and `<setup>` is two steps:

  ```yaml
  - run: rustup toolchain install
  - uses: Swatinem/rust-cache@LATEST
    with:
      workspaces: <area>
  ```

- `<check command>`: `make check`.
- `<audit command>`: replace the step with the action, which carries its own cargo-deny. Its log shows `override toolchain '<version>' is not installed` before it downloads the pinned toolchain in its container: expected, the step still passes.

  ```yaml
  - name: Dependency audit
    if: ${{ !cancelled() }}
    uses: EmbarkStudios/cargo-deny-action@LATEST
    with:
      manifest-path: <area>/Cargo.toml
  ```

## Hooks

- Pre-commit fix job: `glob: "*.rs"`, `run: cargo fmt` (whole crate: `cargo fmt` takes no file arguments).
- Lefthook source: the global one ([ci.md](ci.md#lefthook)); cargo has no dev-dependency for tools.
- `.gitignore` (repo root): `target/`. `cargo new` writes none inside an existing git repo.

## Dependabot

Two entries: `package-ecosystem: cargo` and `package-ecosystem: rust-toolchain` (bumps `rust-toolchain.toml`), both with `directory` = the area.

## CodeQL language (public repos)

`rust`
