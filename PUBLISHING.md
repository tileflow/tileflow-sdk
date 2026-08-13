# Publishing

This repository is the only source of public Tileflow SDK releases. Each package has its own
version and is published only when its reviewed changeset selects it. A release batch may contain
one package or several packages at different versions; unchanged packages are not versioned merely
to keep the workspace aligned.

Hosted platform, API, dashboard, database, and renderer workspaces are never published from this
repository.

## Package set

The public workspace contains:

- `@tileflow/core`
- `@tileflow/static`
- `@tileflow/dev`
- `@tileflow/capture`
- `@tileflow/vite`
- `@tileflow/next`
- `@tileflow/webpack`
- `@tileflow/react`
- `@tileflow/vue`
- `@tileflow/svelte`
- `@tileflow/cli`

All packages remain on numeric alpha versions for now, but their versions advance independently.
The workflow always publishes with npm's `alpha` dist-tag. It never updates `latest`; enabling a
stable channel requires a separate reviewed change to the workflow and this guide.

## Release intent and dependency contract

Add a changeset for every change that should publish a package:

```sh
pnpm changeset
```

Select only packages whose own public artifact or compatibility contract changed. Do not select an
unchanged dependent solely because one of its dependencies changed. Select that dependent when its
code, declarations, metadata, or compatibility contract also needs a release.

Merges to `main` that contain changesets create or update the `Release changed packages` pull
request. Its versioning step:

1. advances only selected manifests to their next numeric alpha version;
2. updates only their changelogs;
3. consumes the included changeset files; and
4. writes `.changeset/release-plan.json` as the reviewed, machine-readable release intent.

Do not run `changeset version`; Tileflow's `pnpm release:version` command owns independent
versioning. Review the release plan and confirm that its package list, previous versions, target
versions, summaries, and changed manifests match the intended release.

Source manifests use `workspace:*` for internal `@tileflow/*` dependencies. `pnpm pack` rewrites
those references to exact package versions. For every selected package, each packed internal
dependency must resolve in exactly one of these ways:

- the dependency is selected in the same batch and the packed reference equals its target version;
- the dependency is not selected and that exact version already exists on npm.

The release workflow rejects ranges, mismatched batch versions, and unpublished internal versions.
This permits independent releases without producing a package whose dependency graph cannot be
installed from the public registry after the batch completes.

## Cross-repository compatibility gate

`@tileflow/core`, `@tileflow/dev`, `@tileflow/cli`, and some capture/static behavior share hosted
API, style, icon-package, deploy, or rendering contracts with the private Tileflow platform. A
change to one of those contracts requires the cross-repository gate before publication:

1. Push the SDK candidate branch and record its full commit SHA. Do not use a moving branch name as
   release evidence.
2. In the private platform repository, manually dispatch the `SDK Candidate` workflow with that
   commit SHA as its `sdk_ref` input.
3. The workflow checks out the SDK candidate separately, builds and packs it with pnpm, and
   publishes the candidate tarballs only to a loopback, ephemeral Verdaccio registry. It installs
   the platform against that registry without editing the primary platform checkout and never
   writes to public npm.
4. Require the workflow's platform boundary, affected API/database/web/renderer, Atocha consumer,
   `pnpm check`, and `pnpm build` gates to pass. Run the hosted canary sequence when wire, deploy,
   icon, style, session, or Static Maps behavior changed.
5. Deploy compatible platform behavior before or together with the SDK batch and obtain the
   release owner's rollout approval.

If GitHub Actions is unavailable, a release owner may reproduce the same isolation locally in a
disposable sandbox with candidate tarballs and temporary exact overrides. That is a recovery path,
not the canonical gate: never edit the primary platform checkout and never substitute a public npm
publish for the ephemeral registry.

The private platform's `docs/runbooks/sdk-upgrade.md` owns its exact consumer commands and the
post-publication upgrade/rollback procedure. If the release owner cannot complete the private gate,
do not publish a shared-contract change. Never roll back only one side of an incompatible contract;
roll forward or restore matching platform and SDK behavior together.

## Trusted Publishing prerequisites

Every npm package must authorize GitHub Actions Trusted Publishing from:

- organization: `tileflow`
- repository: `tileflow-sdk`
- workflow: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

The GitHub `npm-publish` environment must allow deployment from protected tag pattern
`release-*`. Replace the historical `v*` deployment policy before creating the first batch tag.
Keep required reviewers empty if releases are intended to run without a manual environment
approval.

The workflow requests `id-token: write`, unsets `NODE_AUTH_TOKEN`, and publishes with npm
provenance. Do not add a long-lived npm automation token. The equivalent one-time npm CLI setup for
an existing package is:

```sh
npx npm@11.19.0 trust github @tileflow/core \
  --repo tileflow/tileflow-sdk \
  --file publish.yml \
  --env npm-publish \
  --allow-publish
```

Repeat that setup for all eleven packages and confirm it with
`npx npm@11.19.0 trust list <package>`. Trust commands require npm 11.15 or newer, a maintainer
session, and two-factor authentication.

`@tileflow/capture@0.0.0-bootstrap.0` was a one-time package bootstrap created before Trusted
Publishing could be configured. Do not recreate it, publish new bytes at that version, or use it in
installation examples.

## Validate a release candidate

After the release pull request has produced a non-empty release plan, run the repository gates from
this checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm run smoke:capture-public
pnpm run publish:alpha:dry-run
node --test \
  scripts/release-packages.test.mjs \
  scripts/validate-release.test.mjs \
  scripts/select-release-tarballs.test.mjs
node scripts/validate-release.mjs release-20260813.1 --require-packages
```

Use a syntactically valid placeholder batch tag for the local validator; the real tag is created
only after the release pull request is merged. Inspect the packed output for every package, even
though only release-plan packages will be published. Confirm that tarballs contain intended public
files, correct repository metadata, no credentials or machine paths, and exact internal package
versions.

Complete the cross-repository compatibility gate when the candidate changes a shared contract.
Then merge the release pull request and wait for the full `main` CI matrix to pass. That merge or
squash commit is the only commit eligible for the batch tag: it must introduce or change
`.changeset/release-plan.json` relative to its first parent. This one-commit eligibility prevents a
later documentation or tooling commit from reusing a stale release plan.

## Create a release batch

A release is triggered by one lightweight tag with this exact shape:

```text
release-YYYYMMDD.N
```

The date is UTC, `N` starts at `1` each day and has no leading zero, and every batch tag is unique.
The tag must point directly at the release pull request's merge or squash commit. It identifies the
release event, not a shared package version. For example, one
`release-20260813.2` batch could publish `@tileflow/core@0.1.0-alpha.17` and
`@tileflow/react@0.1.0-alpha.19` while leaving every other package unchanged.

From an up-to-date checkout immediately after the release pull request has merged, with `HEAD` still
at that merge or squash commit:

```sh
git switch main
git pull --ff-only
git tag --list 'release-*' --sort=-version:refname
test "$(git diff --name-only HEAD^1 HEAD -- .changeset/release-plan.json)" = \
  '.changeset/release-plan.json'
node scripts/validate-release.mjs release-20260813.1 --require-packages
git tag release-20260813.1
git push origin release-20260813.1
```

Choose the actual UTC date and next unused daily sequence. The workflow rejects an empty plan, an
invalid calendar tag, a tag whose commit is not the current `origin/main` commit, and a commit that
did not change the release plan relative to its first parent. Never move or reuse a release tag. If
another commit reaches `main` before the tag is created, do not tag that later commit; create a new
release pull request so a fresh reviewed plan becomes eligible.

## Workflow behavior

For every `release-*` tag, `.github/workflows/publish.yml`:

1. validates the batch tag, non-empty release plan, independent alpha bumps, package metadata,
   exact `main` commit, and one-commit release-plan eligibility;
2. builds and verifies the whole workspace;
3. packs and audits all eleven public packages, including the clean packed capture consumer;
4. selects only release-plan tarballs;
5. verifies that unselected internal dependency versions already exist on npm;
6. preflights only selected package versions and the `alpha` dist-tag;
7. skips a selected version only when npm already has identical tarball contents and `alpha`
   already points to it; and
8. publishes only missing selected tarballs through Trusted Publishing with provenance.

npm versions are immutable. The workflow never overwrites a version and never silently moves
`alpha` backwards.

## Retry and recovery

The workflow is safe to rerun for the same tag after a network error or partial batch. Packages
already published by that attempt are byte-compared with the candidate and skipped; missing
packages continue through publication. Rerun the existing GitHub Actions run for the same tag—do
not create a replacement tag or bump versions merely to retry infrastructure.

The retry stops if an existing version has different contents, if its `alpha` dist-tag no longer
matches, or if an internal dependency is unavailable. Investigate instead of bypassing those
checks. If published package behavior is defective, keep the immutable version, deprecate it when
appropriate, add a corrective changeset, and publish a new alpha version in a new batch. Do not use
unpublish as rollback; restore compatible platform pins or roll forward both sides of a shared
contract.

## Consumer installation

Alpha consumers should request the mutable `alpha` channel explicitly and pin the CLI exactly when
reproducibility matters:

```sh
pnpm add @tileflow/core@alpha maplibre-gl
pnpm add @tileflow/react@alpha @tileflow/vite@alpha
pnpm add @tileflow/next@alpha @tileflow/webpack@alpha
pnpm add @tileflow/vue@alpha @tileflow/svelte@alpha
pnpm add @tileflow/static@alpha
pnpm add -D @tileflow/capture@alpha
pnpm add -D --save-exact @tileflow/cli@alpha
```
