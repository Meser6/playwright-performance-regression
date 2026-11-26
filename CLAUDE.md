# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

## Project

`playwright-performance-regression` is an npm package for Playwright Test. In a dedicated
measurement run (the user's own test command with `PW_PERF_MODE=test`, D-35) it records backend request timings and `test.step`
durations during existing e2e tests, groups requests into endpoint keys, compares per-key statistics with
thresholds files committed to the user's repository, and fails the run on regression. A second
package, `create-playwright-performance-regression`, powers `npm init playwright-performance-regression`.

## Specification

- The specification lives in a **separate private repository**, expected as a sibling checkout:
  `../npm-spec/perfo/` (`spec/`, `vX_todo.md`, `HANDOFF.md`). Read the relevant spec files before working on a task.
- The spec is the source of truth. If code and spec disagree, the spec wins; if the spec is wrong,
  it is changed and merged in the spec repository **first**, then the code follows.
- Never copy spec text, roadmap or business details into this public repository. Refer to spec
  items by ID only (e.g. `05-REQ-14`, `09-AC-03`, `D-20`).
- `spec-ids.json` (exported from the spec repo) lists valid IDs for the AC coverage check.
- Machine-readable sources live **here** and are the single source of truth: `schemas/` (JSON
  Schema, including all config defaults) and `test/golden/`.

## Work process

- Overriding rule (see `../npm-spec/CLAUDE.md`): everything that goes into a release is specified
  first. Order: item in `vX_todo.md` → spec in `../npm-spec/perfo/spec/` (merged in the spec repo)
  → code. No code for an item that has no spec yet.
- Work follows the current `vX_todo.md` in the spec repo: one item = one branch = one PR.
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

- Never commit to `main` directly and never rewrite `main` history. Claude squash-merges its own
  PRs once CI is green (`gh pr merge --squash`); the owner delegated review and merge (13-D-17).
- Branch per work package: `<type>/<short-name>` (e.g. `feat/collector`, `fix/cli-exit-codes`).
- Conventional Commits, English, imperative mood, subject ≤ 72 characters, no trailing period:

  ```
  <type>(<scope>): <subject>

  <body: what and why, wrapped at 72>

  Refs: 05-REQ-14, 05-AC-09
  Spec: npm-spec@<short spec commit>
  Co-Authored-By: Claude <model> <noreply@anthropic.com>
  ```

  - types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`
  - scopes: `core`, `config`, `collector`, `fixture`, `steps`, `normalize`, `stats`,
    `evaluate`, `thresholds`, `reporter`, `html`, `cli`, `init`, `create`, `schemas`, `deps`,
    `release`
  - breaking changes: `!` after type/scope and a `BREAKING CHANGE:` footer with migration steps

- Each commit on a branch is a logical step that builds. Tidy the branch (no "wip"/"fix typo"
  commits) before opening the PR; never force-push a branch someone else has pulled.
- PR title follows Conventional Commits (it becomes the squash commit subject). Fill in
  `.github/pull_request_template.md`. Mention Claude's contribution in the PR description.
- Only squash merges. Release tags `vX.Y.Z` are created by the release workflow only.

## Commands

Requires Node >= 22.18.0 and pnpm (version pinned in `packageManager`; `corepack enable`).

```sh
pnpm install                 # install dev dependencies (frozen lockfile in CI)
pnpm build                   # tsup: ESM + CJS + declarations per entry point into dist/
pnpm typecheck               # tsc --noEmit (src, test, scripts)
pnpm lint                    # ESLint, including the src/core import boundary rule
pnpm format                  # Prettier --write; `pnpm format:check` in CI
pnpm test                    # Vitest: unit, contract, script and integration tests
                             # (integration runs Playwright on dist/: `pnpm build` first)
pnpm test:perf               # performance tests (12-PERF-*, perf.yml before a release; `pnpm build` first)
pnpm test:stats              # statistical tests (12-STAT-*, weekly CI; `pnpm build` first)
pnpm gen:types               # regenerate src/core/types/generated/ from schemas/
pnpm check:types-generated   # fail when the generated types are out of date
pnpm check:ac                # AC coverage for the criteria in scripts/ac-scope.json (--all: every AC)
pnpm check:pr-title "<title>"   # validate a PR title (Conventional Commits rules above)
pnpm publint && pnpm attw    # package exports check (run after `pnpm build`)
```

- Never edit `src/core/types/generated/` by hand: change the schema and run `pnpm gen:types`.
- `spec-ids.json` is regenerated, never edited: run
  `node ../npm-spec/perfo/scripts/export-spec-ids.mjs --out spec-ids.json` from this repository.
- When a work package implements acceptance criteria, add them (or the whole spec file prefix) to
  `scripts/ac-scope.json`; manual or out-of-CI criteria go to `scripts/ac-manual.json`.
