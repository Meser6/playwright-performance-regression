# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

## Project

`playwright-performance-regression` is an npm package for Playwright Test. In a dedicated
measurement run (`npx pw-perf test`) it records backend request timings and custom measurements
during existing e2e tests, groups requests into endpoint keys, compares per-key statistics with
thresholds files committed to the user's repository, and fails the run on regression. A second
package, `create-playwright-performance-regression`, powers `npm init playwright-performance-regression`.

## Specification

- The specification lives in a **separate private repository**, expected as a sibling checkout:
  `../pw-benchmark/` (`spec/`, `PLAN.md`). Read the relevant spec files before working on a task.
- The spec is the source of truth. If code and spec disagree, the spec wins; if the spec is wrong,
  it is changed and merged in the spec repository **first**, then the code follows.
- Never copy spec text, roadmap or business details into this public repository. Refer to spec
  items by ID only (e.g. `05-REQ-14`, `09-AC-03`, `D-20`).
- `spec-ids.json` (exported from the spec repo) lists valid IDs for the AC coverage check.
- Machine-readable sources live **here** and are the single source of truth: `schemas/` (JSON
  Schema, including all config defaults) and `test/golden/`.

## Work process

- Work follows `PLAN.md` in the spec repo: one work package = one branch = one PR.
- Acceptance-criteria tests are written before the code. A test covering an AC has the AC ID in
  its title, e.g. `test('09-AC-03 rule is skipped below minSamples', ...)`.
- Definition of done for a work package:
  1. AC tests exist, were written first and pass;
  2. lint, typecheck, unit, golden and contract tests pass locally;
  3. the AC coverage check reports no gaps for the implemented files;
  4. golden file changes are intentional and explained in the PR;
  5. spec deviations were merged in the spec repo first and `spec-ids.json` is refreshed;
  6. `CHANGELOG.md` has an entry for user-visible changes;
  7. the work is on its own branch with tidy commits and an open PR.

## Hard constraints

- No runtime dependencies, no telemetry, no network calls, no install/lifecycle scripts
  (`postinstall` etc.) in either package.
- `src/core/` is pure: no imports from Node built-ins or Playwright; deterministic output
  (same input → byte-identical JSON).
- Only public Playwright APIs.
- Outside perf mode the package must not change Playwright behaviour or add overhead.
- Public docs, CLI messages, report texts, code identifiers and commit messages are in English.

## Git workflow

- Never commit to `main` directly and never rewrite `main` history. The owner merges PRs; Claude
  does not merge.
- Branch per work package: `<type>/<short-name>` (e.g. `feat/collector`, `fix/cli-exit-codes`).
- Conventional Commits, English, imperative mood, subject ≤ 72 characters, no trailing period:

  ```
  <type>(<scope>): <subject>

  <body: what and why, wrapped at 72>

  Refs: 05-REQ-14, 05-AC-09
  Spec: pw-benchmark-docs@<short spec commit>
  Co-Authored-By: Claude <model> <noreply@anthropic.com>
  ```

  - types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`
  - scopes: `core`, `config`, `collector`, `fixture`, `custom`, `normalize`, `stats`,
    `evaluate`, `thresholds`, `reporter`, `html`, `cli`, `init`, `create`, `schemas`, `deps`,
    `release`
  - breaking changes: `!` after type/scope and a `BREAKING CHANGE:` footer with migration steps
- Each commit on a branch is a logical step that builds. Tidy the branch (no "wip"/"fix typo"
  commits) before opening the PR; never force-push a branch someone else has pulled.
- PR title follows Conventional Commits (it becomes the squash commit subject). Fill in
  `.github/pull_request_template.md`. Mention Claude's contribution in the PR description.
- Only squash merges. Release tags `vX.Y.Z` are created by the release workflow only.

## Commands

Set up in work package 01 (toolchain). Until then there is nothing to build or test.
