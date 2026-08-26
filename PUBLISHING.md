# Publishing

This repository is the only source of public Tileflow SDK releases. An ordinary merge to `main`
creates a release candidate; it never publishes to npm. Publication starts only when an authorized
operator or Codex deliberately dispatches `.github/workflows/publish.yml` from `main`. The workflow
has no package, version, SHA, or channel inputs: it always uses the exact current head of `main`,
derives the changed packages and alpha versions, builds one immutable bundle, and then waits for one
approval on the GitHub `npm-publish` environment. Approval publishes the tarballs already in that
bundle. It does not rebuild or recalculate them.

There is no changeset, release PR, source-version commit, release tag, manual npm login, or publish
on merge. Hosted platform, API, dashboard, database, and renderer workspaces are never published
from this repository.

## Public catalog and alpha versions

`scripts/release-config.mjs` is the single ordered public catalog. It owns the dependency-safe
publication order and the independent first version for every package:

- `@tileflow/core`
- `@tileflow/maps`
- `@tileflow/interactions`
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

Every source manifest uses the sentinel version `0.0.0-development`. Do not edit it to prepare a
release. This deliberately keeps release-only version churn out of source commits. The protected
workflow proves that source manifests still contain the sentinel, materializes registry versions in
an ephemeral checkout, packs external-consumer tarballs, and verifies those tarballs before they can
reach npm. The version visible in an installed package, npm provenance, the release plan, and the
final receipt is therefore the real published version; the sentinel is never publishable output.

npm's `alpha` dist-tag is authoritative for an already-published package. A materially changed
package advances independently from `X.Y.Z-alpha.N` to `X.Y.Z-alpha.(N+1)`. An unchanged package
keeps its npm version. While the SDK remains in alpha, the reconciler never chooses patch, minor, or
major intent and never updates `latest`.

A package with no published alpha does not inherit Core's counter. Its catalog entry supplies its
own explicit `initialVersion`; currently Maps and Interactions each begin at `0.1.0-alpha.0`. The
release plan records `from: null`, `to: <initialVersion>`, and `package-unpublished`. npm requires a
one-time maintainer bootstrap before OIDC trust can be configured, so `PUBLIC_RELEASE_BLOCKERS.json`
must keep that package blocked until bootstrap and Trusted Publisher verification are complete.
The interlock file is optional and machine-readable: absence means the gate is open, a valid
non-empty blocker list fails publication with its stable IDs, and malformed JSON or schema fails
closed. Resolve every item and remove the file in a reviewed change; do not replace it with an empty
list.

Official PBF glyphs are a Hosted base asset, not part of a project `fontBundleId` and not a mutable
World release field. Before Maps can publish, Hosted must publish and verify the full-SHA asset set
named by `official-glyph-base-asset`; Streets and Ferraris must then reference that exact immutable
URL. The compatibility `/fonts/...` endpoint is not sufficient release evidence.

Stable SemVer is intentionally not automated yet. Before a stable channel exists, each public
change will need a reviewed intent in its source PR. Codex may propose `patch`, `minor`, or `major`;
CI may prove objective compatibility facts; a person reviews the intent; and the reconciler only
combines accepted intentions. It must never infer semantic intent from bytes or let the publish
workflow reclassify it.

The reserved stable contract is:

- `patch`: a compatible defect, security, accessibility, metadata, license, or asset correction;
- `minor`: a compatible export, feature, option, map, icon, font, module, or deliberate visual
  evolution; and
- `major`: removal or incompatible renaming/semantic change that makes a previously valid consumer
  or derived map require edits.

For `@tileflow/maps`, changing pixels is not automatically major. A compatible visual evolution is
minor and a correction that restores intended behavior is patch. Removing or renaming official
maps, public IDs, themes, modules, icons, fonts, or extension points; changing inherited semantics;
or invalidating existing derived maps is major. At first, every stable intent requires human review
in the source PR and a second Codex review of the complete bundle. If the second review disagrees,
publication stops and the intent is corrected through another PR; the workflow never offers a bump
override.

## Internal dependency ranges

Internal runtime, optional, and peer dependencies use this source template:

    workspace:>=0.1.0-alpha.16 <0.1.0-beta.0

The template is not copied blindly into releases. At baseline comparison, an existing edge keeps
the range from the package's current npm tarball; a newly added edge is floored at the dependency's
effective npm alpha or configured first version. If the dependent package is selected, its final
tarball receives `>=<effective dependency version> <0.1.0-beta.0` for every internal edge. An
unselected dependent preserves its published range byte-for-byte. Development-only dependencies may
use `workspace:*`; they do not affect release selection or publication order.

This allows packages to advance independently but requires changes to remain compatible with every
still-supported dependent inside the alpha window. An incompatible generation change requires a
separately reviewed version/range migration before it reaches `main`.

## What the workflow generates

The preparation job creates these ephemeral records under its runner temporary directory:

- `registry.json`: schema 4 snapshot of every npm alpha baseline, including explicit unpublished
  state and configured first versions;
- `candidate/`: all packages built at their effective baseline versions;
- `plan.json`: schema 4 plan bound to the exact 40-character `main` SHA, with baselines, selected
  packages, material differences, target alphas, and final internal ranges;
- `final/`: all packages rebuilt at the target graph;
- `selected-relative.txt`: dependency-safe ordered list of only the selected tarballs; and
- `release-bundle.tar`: `plan.json`, `selected-relative.txt`, and those exact selected tarballs.

The bundle SHA-256 and human-readable package table appear in the workflow summary. The bundle is
retained as a private GitHub artifact for 30 days so a failed publish job can retry the same bytes.
After npm returns, each registry integrity value is matched to the approved tarball bytes and every
selected version is downloaded again and compared exactly. The workflow creates
`release-receipt.json`. The receipt records the source SHA, bundle SHA-256, package versions,
material reasons, npm integrity, and each tarball's SHA-256 and size; it is retained for 90 days.

Merging to `main` alone creates none of these artifacts. `main` plus its green required CI is the
candidate; preparation is deliberately requested only when a release is wanted.

## Material artifact detection

The reconciler reads the catalog, downloads every package named by npm's `alpha` dist-tag, records
its internal runtime ranges, applies the effective baseline versions in the ephemeral checkout,
builds all packages, and packs them. npm 404 is accepted only as the explicit unpublished state; a
transport, authentication, or other registry failure fails closed.

Candidate and registry package trees are compared by public file names, file modes, file bytes, and
publishable manifest metadata. Comparison ignores only:

- the package's `version`, because the candidate first builds at its effective baseline;
- `devDependencies`, because consumers do not install them from the published artifact; and
- object-key ordering in `package.json`, except condition order under `exports` and `imports` where
  order is semantic.

Tests, workflows, and repository-only documentation do not cause a release unless they change a
packed artifact. Package READMEs, `files`, exports, runtime dependencies, executable modes, built
JavaScript, declarations, maps, icons, fonts, and other packaged resources do. A non-deterministic
build appears changed on every run, so packed outputs must remain deterministic.

After selection, the workflow applies target versions and dependency floors, forces a clean build,
runs the complete repository check and packed public consumer, and packs again. A selected tarball
whose topology differs from `plan.json`, an unselected artifact that changes, or an unselected
dependency range that drifts fails closed.

## GitHub configuration contract

Repository settings must enforce all of the following before `PUBLIC_RELEASE_BLOCKERS.json` is
removed:

- `main` is protected by a ruleset requiring pull requests, one approval, resolved conversations,
  dismissal of stale approvals, approval of the latest push by someone other than its author, the
  exact `CI / Required` check, linear history, and no force pushes or deletion;
- organization members use 2FA, Actions are limited to reviewed actions, and every third-party
  action in this repository remains pinned by full commit SHA;
- workflow `GITHUB_TOKEN` permissions default to read-only;
- environment `npm-publish` accepts protected `main` only, has one required reviewer, and prevents
  the workflow initiator from approving their own deployment when GitHub plan support allows it;
- only the publish job has `id-token: write`; preparation has no write permission;
- there is no `NPM_TOKEN` secret or long-lived npm write credential; and
- concurrent release runs share the non-cancelling `npm-publish` concurrency group.

Every public npm package must authorize GitHub Actions Trusted Publishing from organization
`tileflow`, repository `tileflow-sdk`, workflow `publish.yml`, environment `npm-publish`, allowed
action `npm publish`. The publish job runs on a GitHub-hosted runner, unsets `NODE_AUTH_TOKEN`, and
uses npm OIDC provenance.

## Deliberate release operation

Before preparation, the desired source must already be merged and the current `main` SHA must have
one successful push run of `.github/workflows/ci.yml` containing exactly one successful job named
`Required`.

During migration from the former scheduled reconciler, the live GitHub `Publish` workflow remains
manually disabled. Merge this reviewed manual-only workflow first, inspect the live trigger on
`main`, and only then re-enable it. Keep the matching machine-readable release blocker until that
readback has succeeded; never re-enable the legacy scheduled definition.

Start the release in GitHub with **Actions → Publish → Run workflow**, selecting `main`, or dispatch
the same parameter-free workflow through GitHub's API/CLI:

    gh workflow run publish.yml --ref main

Codex may perform that dispatch after reviewing the candidate. The operator does not select
packages, versions, counters, or a source SHA. The workflow binds itself to the current `main` head,
verifies its exact CI evidence, and stops if `main` advances at any point before a package is
published.

Preparation then:

1. validates and enforces the optional `PUBLIC_RELEASE_BLOCKERS.json` before reading npm state;
2. validates sentinel manifests and catalog topology;
3. records npm baselines and configured first versions;
4. builds and compares all public artifacts;
5. derives only the material package set and next independent alphas;
6. rebuilds, checks, packs, audits, and runs the clean consumer;
7. rechecks the exact current `main` SHA; and
8. uploads one immutable bundle and displays its plan and digest.

If no artifact differs, the workflow succeeds without requesting environment approval. Otherwise,
the `Approve and publish exact bundle` job waits at `npm-publish`. The reviewer checks the summary,
source SHA, package table, and bundle digest, then approves or rejects the whole bundle once. There
is no approval per package. Approval cannot alter the plan; any correction requires a new source PR
and a new deliberate workflow run.

After approval, the isolated publish job downloads the bundle, verifies its SHA-256 and source SHA,
rechecks npm immediately, publishes in catalog order with OIDC and provenance, downloads every
selected package back from npm, compares exact contents, and writes the final receipt.

## Retry, partial publication, and recovery

npm has no multi-package transaction. A bundle can therefore be partially visible briefly. The
workflow publishes dependency before dependent, and alpha ranges keep already-published dependents
compatible.

For a transient failure, use GitHub's **Re-run failed jobs** on the same workflow run while its
source is still current `main`. Do not dispatch a replacement merely to retry. The publish job uses
the retained bundle and preflights every selected package again:

- missing target plus unchanged previous alpha → publish;
- target exists with identical contents and `alpha` points to it → skip as already complete;
- target exists with different contents → fail;
- target exists but `alpha` points elsewhere → fail; and
- previous baseline or current `main` changed → fail.

Thus a dependency-first partial publication resumes without rebuilding or incrementing again. Never
overwrite, unpublish, manually move `alpha`, or bypass an invariant. If `main` advanced or the source
is defective, merge a corrective PR and deliberately prepare a new bundle. Platform and SDK changes
cannot be one atomic transaction; shared hosted contracts must remain backward compatible and deploy
server-first.

## One-time package bootstrap

npm cannot configure Trusted Publishing before a package exists. For each new catalog package:

1. keep a specific item in `PUBLIC_RELEASE_BLOCKERS.json`;
2. prepare and review a bootstrap-only version and the exact first alpha tarball;
3. have a maintainer publish the bootstrap-only version with 2FA under a non-default `bootstrap`
   tag; it must be distinct from the catalog's reserved `initialVersion`;
4. configure and independently verify the package's Trusted Publisher;
5. let the protected workflow reconcile and publish the reserved first alpha according to an
   explicitly reviewed bootstrap runbook; and
6. remove the blocker only in the reviewed change containing the evidence.

The normal OIDC job is not authority to invent or bootstrap a package.

## Local publication-free validation

Local validation never queries npm for authoritative release selection and never publishes:

    pnpm install --frozen-lockfile
    pnpm run release:verify-source
    pnpm build
    pnpm check
    pnpm run smoke:capture-public
    pnpm run publish:alpha:dry-run

The authoritative npm comparison exists only inside the deliberately dispatched protected workflow.

## Consumer installation

Alpha consumers request the mutable channel explicitly and pin tools exactly when reproducibility
matters:

    pnpm add @tileflow/core@alpha @tileflow/maps@alpha @tileflow/interactions@alpha maplibre-gl
    pnpm add @tileflow/react@alpha @tileflow/vite@alpha
    pnpm add @tileflow/next@alpha @tileflow/webpack@alpha
    pnpm add @tileflow/vue@alpha @tileflow/svelte@alpha
    pnpm add @tileflow/static@alpha
    pnpm add -D @tileflow/capture@alpha
    pnpm add -D --save-exact @tileflow/cli@alpha
