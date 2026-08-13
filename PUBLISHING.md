# Publishing

This repository is the only source of public Tileflow SDK releases. Each package has its own
version and is published only when its reviewed changeset selects it. A release batch may contain
one package or several packages at different versions; unchanged packages are not versioned merely
to keep the workspace aligned. The Release PR merge SHA is the immutable identity of that batch;
there is no release tag.

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

1. Record the exact current head SHA of the generated Release PR. Do not use its moving branch name
   as release evidence.
2. In the private platform repository, manually dispatch the `SDK Candidate` workflow with that
   commit SHA as its `sdk_ref` input.
3. The workflow checks out the SDK candidate separately, builds and packs it with pnpm, and
   publishes the candidate tarballs only to a loopback, ephemeral Verdaccio registry. It installs
   the platform against that registry without editing the primary platform checkout and never
   writes to public npm.
4. Require the workflow's platform boundary, affected API/database/web/renderer, Atocha consumer,
   `pnpm check`, and `pnpm build` gates to pass. Run the hosted canary sequence when wire, deploy,
   icon, style, session, or Static Maps behavior changed.
5. If the Release PR head changes, repeat the gate against the new SHA. Deploy compatible platform
   behavior and obtain the release owner's rollout approval before merging the Release PR, because
   publication begins automatically after its `main` CI succeeds.

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

The GitHub `npm-publish` environment must allow deployment from the protected `main` branch only.
Keep required reviewers empty because merging the Release PR is the explicit human approval; an
additional environment approval would make the documented automatic flow wait for a second click.

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

After the Release PR has produced a non-empty release plan, run the repository gates from that
checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm run smoke:capture-public
pnpm run publish:alpha:dry-run
pnpm run test:release
git fetch --no-tags origin main
base_sha="$(git merge-base origin/main HEAD)"
head_sha="$(git rev-parse HEAD)"
node scripts/validate-release.mjs \
  --base "$base_sha" \
  --head "$head_sha" \
  --require-packages
```

Inspect the packed output for every package, even though only release-plan packages will be
published. Confirm that tarballs contain intended public files, correct repository metadata, no
credentials or machine paths, and exact internal package versions.

Complete the cross-repository compatibility gate when the candidate changes a shared contract.
When its `Required` check is green and the package list, versions, summaries, changelogs, and private
compatibility evidence are correct, mark the Release PR ready and merge it. That merge is the final,
irreversible publication approval. No release branch naming convention is required for normal
development branches, and no release tag is created manually.

Closing the Release PR without merging does not publish. Neither does merging a normal source PR,
a fork PR, or a commit that does not introduce a newly reviewed release plan.

## Workflow behavior

After the official Release PR reaches `main`, `.github/workflows/publish.yml` waits for the complete
`CI` workflow on that exact commit. Only when `CI / Required` and all of its matrix dependencies have
succeeded does the publish workflow:

1. verifies that the tested commit belongs to this repository, is on `main`, and is associated with
   exactly one merged same-repository PR from `changeset-release/main`;
2. reconstructs the release plan from the Release PR base manifests and reviewed changesets, then
   rejects stale plans, unconsumed changesets, or version drift in unselected packages;
3. builds and verifies the whole workspace;
4. packs and audits all eleven public packages, including the clean packed capture consumer;
5. selects only release-plan tarballs in dependency-safe order;
6. verifies that unselected internal dependency versions already exist on npm;
7. preflights only selected package versions and requires each package's current `alpha` version to
   equal the reviewed previous version, preventing out-of-order releases;
8. skips a selected version only when npm already has identical tarball contents and `alpha`
   already points to it; and
9. publishes only missing selected tarballs through Trusted Publishing with provenance.

npm versions are immutable. The workflow never overwrites a version and never silently moves
`alpha` backwards. Ordinary green `main` builds are classified and skipped without requesting an
npm OIDC token.

## Retry and recovery

The workflow is safe to rerun for the same Release PR merge commit after a network error or partial
batch. Packages already published by that attempt are byte-compared with the candidate and skipped;
missing packages continue through publication. Rerun the existing GitHub Actions `Publish` run for
that exact commit; do not remerge, manufacture a tag, or bump versions merely to retry
infrastructure.

If `Publish` was never created because the exact `main` CI run failed for an infrastructure reason,
rerun that CI run first. Do not rerun or bypass CI for a real code failure. Do not merge a second
Release PR until the earlier `Publish` run finishes: publication runs are serialized, but their CI
runs may complete in a different order and the monotonic-version guard will safely reject an older
release that arrives late.

The retry stops if an existing version has different contents, if its `alpha` dist-tag no longer
matches, or if an internal dependency is unavailable. Investigate instead of bypassing those
checks. If published package behavior is defective, keep the immutable version, deprecate it when
appropriate, add a corrective changeset, and publish a new alpha version through a new Release PR.
Do not use unpublish as rollback; restore compatible platform pins or roll forward both sides of a
shared contract.

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
