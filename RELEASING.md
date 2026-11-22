# Releasing

Releases are published by `.github/workflows/release.yml` when a tag `vX.Y.Z` or
`vX.Y.Z-next.N` is pushed on `main` (13-REQ-06, 13-REQ-07). The workflow:

1. checks that the tag points to a commit on `main`, that it equals `version` in `package.json`
   **and** `create/package.json`, that `CHANGELOG.md` has a `## [X.Y.Z]` section, and that
   neither `package.json` has `"private": true` (`scripts/check-release.mjs`); otherwise it stops
   before anything is published;
2. runs the full CI (`ci.yml`) and the performance tests (`perf.yml`) on the tagged commit;
3. builds and **stages** both packages on npm from the `npm` environment with npm provenance
   through trusted publishing (OIDC; no npm token; `npm stage publish`), dist-tag `next` for
   `-next.N`, `latest` otherwise; a version already on npm is skipped, so a failed run can be
   re-run for the same tag. Staged versions are not public until the owner approves them with
   2FA (see "Approving a release");
4. creates the GitHub Release with the CHANGELOG section as notes;
5. for stable releases, builds the demo report and deploys it to GitHub Pages (`demo.yml`,
   13-REQ-17).

After the approval, `post-release.yml` (run by hand with the version) installs the published
create package with npm, pnpm and yarn in fresh Playwright projects (`test/release/`, 13-AC-10).

## Approving a release

The trusted publisher of both packages allows **stage publish only**: CI can stage a version,
but only the owner can make it public, with 2FA. After the `Release` run is green:

1. Approve `playwright-performance-regression` first (the create package installs it), then
   `create-playwright-performance-regression`:
   - on npmjs.com: package → **Staged versions** → the version → **Approve** (2FA), or
   - in a terminal: `npm stage list playwright-performance-regression`, then
     `npm stage approve <stage-id>` (2FA); the same for the create package.
2. Check: `npm view playwright-performance-regression@next version` (or `@latest`) prints the
   new version.
3. Run **Actions → Post-release checks → Run workflow** with the version (or
   `gh workflow run post-release.yml -f version=X.Y.Z`); all three jobs must be green.

A staged version that should not be released is rejected with `npm stage reject <stage-id>`.

Release tags are only pushed by the owner as part of this checklist; they are never moved or
deleted (13-REQ-23).

## First release: owner checklist

Do these steps in this order. Steps 1–4 and 9 change settings outside this repository and can
only be done by the owner.

1. **Make the repository public** (Settings → General → Danger Zone → Change visibility).
2. **Protect `main`** (13-REQ-18, checked by hand for 13-AC-14): Settings → Rules → new branch
   ruleset for `main` (or a classic branch protection rule):
   - require a pull request before merging;
   - require status checks to pass: `Checks`, every `Test (…)` job of `CI`, `PR title`,
     `CHANGELOG`; require branches to be up to date;
   - block force pushes; restrict deletions;
   - require linear history;
   - also check Settings → General → Pull Requests: only "Allow squash merging" (commit message
     "Pull request title and description"), "Automatically delete head branches" on (13-REQ-23).
3. **Configure npm trusted publishing** for `playwright-performance-regression` and
   `create-playwright-performance-regression` (npm account with 2FA, 13-REQ-08): on npmjs.com,
   package → Settings → Trusted Publisher → GitHub Actions with organization or user `Meser6`,
   repository `playwright-performance-regression`, workflow filename `release.yml`, environment
   `npm`, permission **stage publish** only (the default; direct publish stays off). If npm offers these settings only for a package that already exists, first publish a
   placeholder of each name by hand, exactly like step 4 (version `0.0.0`, the description
   "Placeholder; the first release follows."), then configure the trusted publisher. Optionally
   add required reviewers to the `npm` environment (Settings → Environments).
4. **Reserve `pw-perf` on npm** (13-REQ-06a, 13-AC-09) with an empty placeholder package that
   points to the real one:

   ```sh
   mkdir pw-perf-placeholder && cd pw-perf-placeholder
   cat > package.json <<'EOF'
   {
     "name": "pw-perf",
     "version": "0.0.1",
     "description": "Placeholder. The pw-perf command is part of playwright-performance-regression: npm install --save-dev playwright-performance-regression",
     "license": "MIT",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/Meser6/playwright-performance-regression.git"
     },
     "files": []
   }
   EOF
   printf '# pw-perf\n\nPlaceholder. The `pw-perf` command is part of\n[playwright-performance-regression](https://www.npmjs.com/package/playwright-performance-regression).\n' > README.md
   npm publish --access public
   npm view pw-perf
   ```

5. **Flip `private`**: a pull request that removes `"private": true` from `package.json` and
   `create/package.json` (CI must be green; squash merge).
6. **Version and CHANGELOG**: a pull request that sets `"version": "0.1.0-next.0"` in
   `package.json` and `create/package.json` and renames the `## [Unreleased]` entries to a
   `## [0.1.0-next.0] - YYYY-MM-DD` section with a new empty `## [Unreleased]` above it. Steps 5
   and 6 may be one pull request (`chore(release): prepare 0.1.0-next.0`).
7. **Tag the pre-release** on the merged commit of `main`:

   ```sh
   git checkout main && git pull
   node scripts/check-release.mjs v0.1.0-next.0   # prints "next"
   git tag v0.1.0-next.0 && git push origin v0.1.0-next.0
   ```

   Then follow the `Release` run in the Actions tab until every job is green, approve both
   staged versions and run the post-release checks ("Approving a release" above). The first
   staged publish also validates the trusted publisher configuration on npm.

8. **Verify provenance** (13-AC-01): the npm page of both packages shows the provenance
   attestation of the `release.yml` run, and
   `npm view playwright-performance-regression@next dist.attestations` (and the same for
   `create-playwright-performance-regression@next`) prints the attestations.
9. **Time the installation** (13-AC-05, S-01): a person outside the project follows the README
   (`npm init playwright-performance-regression`) in a fresh Playwright project; it must take at
   most 10 minutes. Record the time in the pull request of the next step.
10. **Enable GitHub Pages**: Settings → Pages → Source "GitHub Actions"; then run the
    `Demo report` workflow by hand (Actions → Demo report → Run workflow) and open the page.
11. **Release `0.1.0`**: a pull request with `"version": "0.1.0"` in both `package.json` files and
    a `## [0.1.0] - YYYY-MM-DD` CHANGELOG section; after the merge, tag and push `v0.1.0` as in
    step 7 (`check-release.mjs` prints `latest`). The workflow publishes under `latest` and
    deploys the demo report.

## Later releases

1. A pull request with the new version in both `package.json` files (13-REQ-01) and the CHANGELOG
   section (breaking changes under `Breaking` with migration steps, 13-REQ-05).
2. After the merge: `node scripts/check-release.mjs vX.Y.Z`, then tag and push `vX.Y.Z` (or
   `vX.Y.Z-next.N` to try a release under `next` first).
3. Approve the staged versions and run the post-release checks ("Approving a release").
4. If staging fails after the tag was pushed, re-run the failed jobs of the same `Release`
   run; versions already on npm are skipped.
