# Publishing

This repository is the only source of public Tileflow SDK releases. An ordinary merge to `main`
creates a release candidate; it never publishes to npm. Publication starts only when an authorized
operator or Codex deliberately dispatches `.github/workflows/publish.yml` from `main`. The workflow
has no package, version, SHA, or channel inputs: it always uses the exact current head of `main`,
derives the changed packages and alpha versions, builds and verifies one immutable bundle, and waits
for one approval on the GitHub `npm-publish` environment. Approval publishes the tarballs already in that
bundle. It does not rebuild or recalculate them.

There is no changeset, release PR, source-version commit, release tag, manual npm login, or publish
on merge. Hosted platform, API, dashboard, database, and renderer workspaces are never published
from this repository.

The Swift and Android SDKs under `platforms/` follow the same principles through a separate workflow,
`.github/workflows/native-publish.yml`, and a separate approval; see
[Native Swift and Android releases](#native-swift-and-android-releases). Their only tags live in the
generated Swift distribution repository, never in this one.

## Public catalog and alpha versions

`scripts/release-config.mjs` is the single ordered public catalog. It owns the dependency-safe
publication order and the independent first version for every package:

- `@tileflow/core`
- `@tileflow/maps`
- `@tileflow/interactions`
- `@tileflow/react-native`
- `@tileflow/geoip`
- `@tileflow/coordinates`
- `@tileflow/coordinates-runtime`
- `@tileflow/search`
- `@tileflow/routing`
- `@tileflow/elevation`
- `@tileflow/static`
- `@tileflow/dev`
- `@tileflow/capture`
- `@tileflow/vite`
- `@tileflow/next`
- `@tileflow/webpack`
- `@tileflow/react`
- `@tileflow/vue`
- `@tileflow/svelte`
- `tileflow`

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

A package with no published alpha does not inherit another package's counter. Its catalog entry
supplies its own explicit `initialVersion`; `tileflow` and `@tileflow/react-native` each begin at
`0.1.0-alpha.0`. The release plan
records `from: null`, `to: <initialVersion>`, and `package-unpublished`. npm requires a one-time
maintainer bootstrap before OIDC trust can be configured, so `PUBLIC_RELEASE_BLOCKERS.json` must
keep that package blocked until bootstrap and Trusted Publisher verification are complete.
The interlock file is optional and machine-readable: absence means the gate is open, a valid
non-empty blocker list fails publication with its stable IDs, and malformed JSON or schema fails
closed. Resolve every item and remove the file in a reviewed change; do not replace it with an empty
list.

Official PBF glyphs are a Hosted base asset, not part of a project `fontBundleId` and not a mutable
World release field. Before Maps can publish, Hosted must publish and verify the full-SHA asset set
named by `official-glyph-base-asset`; every official root using Noto Sans—currently Streets,
Soundings and Blueprint—must then reference that exact
immutable URL. The compatibility `/fonts/...` endpoint is not sufficient release evidence.

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
- `candidate/` and `candidate-repeat/`: two candidate packings of all packages built at their
  effective baseline versions;
- `plan.json`: schema 4 plan bound to the exact 40-character `main` SHA, with baselines, selected
  packages, material differences, target alphas, and final internal ranges;
- `final/`: all packages rebuilt at the target graph;
- `selected-relative.txt`: dependency-safe ordered list of only the selected tarballs; and
- `coordinates-builder-input/` and `coordinates-builder-input-receipt.json`: an offline-verifiable
  input only when `@tileflow/coordinates-runtime` is selected, bound to its exact tarball, source
  revision, and content-addressed input ID; and
- `release-bundle.tar`: `plan.json`, `selected-relative.txt`, the exact selected tarballs, and that
  optional builder input.

The bundle SHA-256 and human-readable package table appear in the workflow summary. The bundle is
retained as a private GitHub artifact for 30 days so a failed publish job can retry the same bytes.
After npm returns, each registry integrity value is matched to the approved tarball bytes and every
selected version is downloaded again and compared exactly. The workflow creates
`release-receipt.json`. The receipt records the source SHA, bundle SHA-256, package versions,
material reasons, npm integrity, and each tarball's SHA-256 and size; it is retained for 90 days.

Before native qualification, a consumer verifies the exact release-bundle SHA-256, then supplies
the builder-input ID from `coordinates-builder-input-receipt.json` as a separate expected value.
It must not trust an ID or receipt copied from an unverified input directory.

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

`LICENSE` is maintained once at the repository root. Each package's pack lifecycle copies that file
into its tarball and removes the temporary copy afterwards; release verification requires the packed
bytes to match the root license. Third-party notices remain only with the packages and assets they
cover.

Tests, workflows, and repository-only documentation do not cause a release unless they change a
packed artifact. Package READMEs, `files`, exports, runtime dependencies, executable modes, built
JavaScript, declarations, maps, icons, fonts, and other packaged resources do. Before selection, the
workflow builds and packs every candidate twice. Each package's contents must match under the exact
release comparison; otherwise preparation stops. `tsconfig.base.json` sets TypeScript's
`stableTypeOrdering` for every package: tsup emits each module's declarations in the order Rollup
loads them, and without it TypeScript can print union members and mapped keys in a different order
on each build.
Candidate tarballs remain the immutability proof for unselected packages; their later final rebuild
output is neither selected nor bundled.

After selection, the workflow applies target versions and dependency floors, forces a clean build,
packs again, and runs the packed public consumer. A selected tarball
whose topology differs from `plan.json`, or an unselected final manifest version or dependency range
that drifts, fails closed.

Three isolated verification jobs then apply the bundled plan on the exact source SHA and preparation's
Node version: one runs all static checks and remaining package verification, one verifies Dev, and
one verifies CLI. Together they retain every check in `pnpm check`. Each job repacks all packages,
validates every version and internal dependency range, and compares selected package contents with
the immutable bundle. Any failure, cancellation or skipped verification blocks npm approval.
Preparation and verification use temporary Node compile caches within each runner; test results
are not cached. Publication still uses the original bundle without rebuilding.

## GitHub configuration contract

Repository settings must enforce all of the following before `PUBLIC_RELEASE_BLOCKERS.json` is
removed:

- `main` is protected by a ruleset requiring pull requests, resolved conversations, the exact
  `CI / Required` check, linear history, and no force pushes or deletion. The ruleset deliberately
  requires zero approving reviews so an operator or Codex can merge after self-review and green CI;
- this zero-review policy applies only to merging code. It does not remove the manual approval
  gate configured on the `npm-publish` environment for public release bundles;
- organization members use 2FA; GitHub Actions enforces full commit-SHA pinning, and action changes
  are reviewed with their source pull request;
- workflow `GITHUB_TOKEN` permissions default to read-only;
- environment `npm-publish` accepts protected `main` only and requires approval by a listed reviewer.
  A listed reviewer may approve a workflow they initiated; `prevent_self_review` is disabled.
  Administrative bypass remains disabled;
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

Keep squash commit messages free of CI-skip directives. A green pull-request run does not replace
the exact-main push run required for publication.

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
6. rebuilds, packs, audits, and runs the clean consumer;
7. rechecks the exact current `main` SHA;
8. uploads one immutable bundle and displays its plan and digest; and
9. runs all three verification jobs against its final graph and checks their rebuilt artifacts.

If no artifact differs, the workflow succeeds without requesting environment approval. Otherwise,
after every verification job succeeds, the `Approve and publish exact bundle` job waits at
`npm-publish`. The reviewer checks the summary,
source SHA, package table, and bundle digest, then approves or rejects the whole bundle once. There
is no approval per package. Approval cannot alter the plan; any correction requires a new source PR
and a new deliberate workflow run.

The workflow initiator may perform this review when listed on the environment. Starting a workflow
does not approve its bundle: the reviewer must separately approve the pending `npm-publish`
deployment in GitHub after inspecting the prepared artifacts.

After approval, the isolated publish job downloads the bundle, verifies its SHA-256 and source SHA,
rechecks npm immediately, publishes in catalog order with OIDC and provenance, and waits
collectively for every selected `alpha` tag to become visible. npm may accept a package with `202`
while processing it asynchronously, so this convergence gate allows up to ten minutes without
multiplying that wait by package count. The job then downloads every selected package back from
npm, compares exact contents, and writes the final receipt.

The isolated publish job installs no workspace dependencies. Every repository script it runs after
approval must load with Node built-ins alone, and the convergence check validates each selected
package name, version, order, and count against the sealed `plan.json`.

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

An npm `202` followed by delayed package visibility is a successful asynchronous publication, not
authority to republish immediately. Let the bounded convergence gate finish. If it still times out,
verify the target version, `alpha` tag, integrity, and bytes independently before using **Re-run
failed jobs**; the same idempotent preflight must classify visible targets as identical.

## One-time package bootstrap

npm cannot configure Trusted Publishing before a package exists. For each new catalog package:

1. keep a specific item in `PUBLIC_RELEASE_BLOCKERS.json`;
2. prepare and review a bootstrap-only version and the first-alpha candidate contents;
3. have a maintainer publish the bootstrap-only version with 2FA under a non-default `bootstrap`
   tag; it must be distinct from the catalog's reserved `initialVersion`;
4. configure and independently verify the package's Trusted Publisher;
5. remove the blocker only in the reviewed change containing that evidence; and
6. let the protected workflow reconcile, validate and request approval for the exact first-alpha
   bundle before publishing it.

The normal OIDC job is not authority to invent or bootstrap a package.

### Elevation first alpha

Remove `elevation-initial-publisher` only after the maintainer bootstrap and independent Trusted
Publisher verification for `@tileflow/elevation` are complete. Reserve `0.1.0-alpha.0` for the
protected first alpha; never use that version for bootstrap or move `alpha` manually. Do not release
the other changed packages separately to bypass this interlock.

### Routing first alpha

Remove `routing-initial-publisher` only after the maintainer bootstrap and independent Trusted
Publisher verification for `@tileflow/routing` are complete. Reserve `0.1.0-alpha.0` for the
protected first alpha; never use that version for bootstrap or move `alpha` manually. Do not release
the other changed packages separately to bypass this interlock.

### React Native first alpha

Remove `react-native-initial-publisher` only after the maintainer bootstrap and independent Trusted
Publisher verification are complete. Reserve `0.1.0-alpha.0` for the protected first alpha; never
use that version for bootstrap or move `alpha` manually. Do not release the other changed packages
separately to bypass this interlock.

Before the maintainer publishes anything, review the bootstrap artifact, its distinct version and
digest. Verify the npm package owner and the Trusted Publisher fields above independently. Remove
the blocker through a reviewed PR only after that evidence is available. The subsequent protected
workflow derives one coordinated bundle and requires its own approval.

The existing `pnpm smoke:mobile:packed` checks the exact React Native peer tuple against Expo and
Community CLI consumers, including declaration compilation and Android/iOS autolinking. It does not
prove device rendering or Hosted availability. React Native is not a Node import target in the
general public-package smoke.

## Local publication-free validation

Local validation never queries npm for authoritative release selection and never publishes:

    pnpm install --frozen-lockfile
    pnpm run release:verify-source
    pnpm build
    pnpm check
    pnpm run smoke:capture-public
    pnpm run smoke:mobile:packed
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
    pnpm add -D --save-exact tileflow@alpha

After the first `@tileflow/search` alpha exists, install it through the same explicit channel:

    pnpm add @tileflow/search@alpha

After the first React Native alpha exists, use the exact host versions in its
[package README](packages/react-native/README.md), then install:

    pnpm add --save-exact @tileflow/react-native@alpha @tileflow/core@alpha @tileflow/interactions@alpha @maplibre/maplibre-react-native@11.5.0

## Native Swift and Android releases

The native SDKs ship as one release with one version:

- the Swift package, from the generated distribution repository
  [`tileflow/tileflow-swift`](https://github.com/tileflow/tileflow-swift), with the products
  `Tileflow`, `TileflowConfiguration`, `TileflowSearch`, `TileflowRouting`, `TileflowElevation`,
  `TileflowGeoIP` and `TileflowServiceContent`; and
- the Android artifacts on Maven Central under `dev.tileflow`: `tileflow-sdk` (the map),
  `tileflow-configuration`, `tileflow-search`, `tileflow-routing`, `tileflow-elevation`,
  `tileflow-geoip` and `tileflow-service-content`.

`platforms/native-release.json` is the single catalog: the first version, the Swift distribution
repository, and every Maven artifact with its Gradle module, name and description. The shared Gradle
script `platforms/android/gradle/publishing.gradle.kts` reads it to write each POM, so a new
published module needs one catalog entry and one `apply(from = ...)` line. The release scripts read
the same file.

### Native versions

Native releases use the alpha channel, `X.Y.Z-alpha.N`, like npm packages. No source file carries a
release version: Gradle builds `0.0.0-local.1` unless a version is supplied, and the Swift manifest
has none. The release workflow reads what is already public, the tags of the Swift distribution
repository and the Maven Central metadata of every catalog artifact, and selects the next alpha after
the highest version found on either side. The first release uses the catalog's `initialVersion`,
`0.1.0-alpha.0`. Any public native version that is not an alpha stops planning. Every artifact and
the Swift tag of a release share that version, and a version that reached only one side is never
reused. As with npm, stable SemVer intent is not automated.

### Swift distribution repository

SwiftPM resolves packages from a git repository with `Package.swift` at its root and SemVer tags,
and it must find every resource in the tagged tree. The embedded runtime is a build output that this
repository does not track, so tags on this monorepo would make every consumer clone the pnpm
workspace and still miss the runtime. The release therefore generates a separate repository whose
root holds exactly:

- `Package.swift`, `Sources/` and `Tests/` from `platforms/ios`, with the embedded runtime under
  `Sources/Tileflow/EmbeddedRuntime/`;
- `README.md` from `platforms/ios/distribution/README.md`, and `LICENSE`; and
- `provenance.json`: source repository and revision, clean-source state, the digest of every source
  input, the version and the runtime digest.

Each release is one commit on the distribution's `main`, whose tree is exactly that generated
package, and a tag named after the version. Nobody edits the distribution repository by hand: issues
and changes belong here. The package is distributed as source. A binary XCFramework would add
platform slices, compiler compatibility, resource bundles and binary checksums without a present
requirement, and would hide source that is already public.

### What the native workflow does

Start a release with **Actions → Native publish → Run workflow** on `main`, or:

    gh workflow run native-publish.yml --ref main

The workflow has no inputs and runs only for the current head of `main`.

1. **Readiness** (Linux, read-only): enforces `NATIVE_RELEASE_BLOCKERS.json`, requires one
   successful push run of `ci.yml` with a successful `Required` job for the exact SHA, requires the
   SHA to still be the head of `main`, requires the protected `native-publish` environment described
   below, and plans the version.
2. **Build and verify** (macOS, read-only): rebuilds the embedded runtime and stages it for both
   platforms; builds the Swift tree and the Maven repository with
   `scripts/native-release-prepare.mjs`; validates every POM, Gradle module metadata file, sources
   jar and documentation jar against Maven Central's requirements; and prepares the Swift release
   commit and tag on top of the distribution's current `main` as a git bundle. It pushes that commit
   to a local mirror with the same code the publish job uses. Independent consumers then build from
   the release only: the UIKit and SwiftUI examples resolve the package from the mirror at the
   release tag for the iOS Simulator, the Swift integration tests, including map rendering, run with
   Mac Catalyst against that same tag, and the Android example resolves `dev.tileflow` only from the
   Maven candidate. Each consumer must carry the candidate's exact runtime bytes. The job uploads
   one bundle, retained for 30 days, and shows its SHA-256, the version, the source SHA, the runtime
   digest, the Swift commit and tree, and the Maven coordinates.
3. **Approve and publish** (Linux, `native-publish` environment): after approval, the job checks that
   every credential exists before it does anything else, verifies the bundle digest, the source SHA
   and the head of `main`, imports the signing key and requires its fingerprint, and checks that the
   public key is on `keyserver.ubuntu.com`. It signs every Maven file with the primary key, writes MD5,
   SHA-1, SHA-256 and SHA-512 checksums, and uploads one zip to the Central Publisher Portal as a
   user-managed deployment that stops at `VALIDATED`. Only then does it push the Swift commit and tag,
   without force, and publish the validated deployment. It waits until Maven Central serves every
   file, compares the bytes with the approved bundle, and keeps a release receipt for 90 days.

Approval publishes exactly the bundle that was verified; the publish job runs no build tool. The
reviewer checks the job summary before approving: version, source SHA, runtime digest, Swift commit,
Maven coordinates and bundle digest.

### Native GitHub configuration contract

The `NATIVE_RELEASE_BLOCKERS.json` interlock stops every native release until all of the following
exist. Remove it, like `PUBLIC_RELEASE_BLOCKERS.json`, in a reviewed change once they do.

- Environment `native-publish` in this repository: deployment branches limited to `main`, at least
  one required reviewer, and administrator bypass disabled. The readiness job refuses to continue
  otherwise, because GitHub would create a missing environment without protection.
- Environment secrets of `native-publish`, readable only by the publish job:

  | Secret                          | Contents                                                                  |
  | ------------------------------- | ------------------------------------------------------------------------- |
  | `MAVEN_CENTRAL_TOKEN_USERNAME`  | Username half of a Central Publisher Portal user token                    |
  | `MAVEN_CENTRAL_TOKEN_PASSWORD`  | Password half of that token                                               |
  | `NATIVE_SIGNING_KEY`            | ASCII-armored secret key of the release signing key                       |
  | `NATIVE_SIGNING_KEY_PASSPHRASE` | Passphrase of that key                                                    |
  | `SWIFT_DISTRIBUTION_DEPLOY_KEY` | Private SSH key whose public half is a write deploy key of the Swift repo |

- Environment variable `NATIVE_SIGNING_KEY_FINGERPRINT`: the 40-character fingerprint of the signing
  key. The publish job refuses any other key.
- The release signing key signs with its primary key (Maven Central does not verify subkey
  signatures), and its public key is published on `keyserver.ubuntu.com` and `keys.openpgp.org`.
- The `dev.tileflow` namespace is verified in the Central Publisher Portal for the account that owns
  the user token.
- The public repository `tileflow/tileflow-swift`, with `main` as its default branch, issues disabled
  in favor of this repository, and rules that let only the deploy key create tags or update `main`;
  nobody may force-push or delete `main`, or update or delete a tag.

No other workflow, job or repository reads these credentials.

### Native retries and recovery

Maven Central and SwiftPM tags are immutable. A published version is never overwritten, deleted or
moved: a defective release is replaced by the next alpha. For a transient failure, use **Re-run failed
jobs** on the same run while its source is still the head of `main` and its bundle is retained. The
publish job is idempotent:

- a Swift tag at the prepared commit counts as published, and a tag elsewhere stops the release;
- a distribution `main` that moved since preparation stops the release; prepare a new run;
- Maven artifacts already published for the version are not uploaded again, only verified byte for
  byte, and a version published for some artifacts but not others stops for investigation; and
- a deployment that validated but was not published is dropped when the job fails, so a rerun uploads
  it again.

If Maven Central needs longer than the wait to serve the files, rerun the failed job later; it
verifies the published bytes without publishing again.

### Native local validation

These commands publish nothing. The candidate directory must not exist; the candidate is marked
`sourceDirty` unless it was built from a clean commit.

    pnpm install --frozen-lockfile
    node scripts/native-release-prepare.mjs --output /absolute/new/candidate
    node scripts/native-maven-bundle.mjs validate --repository /absolute/new/candidate/maven --version 0.0.0-local.1
    node scripts/native-consumers-prepare.mjs /absolute/new/candidate /absolute/new/consumers

To exercise signing, create a throwaway key in a temporary `GNUPGHOME`, export it into the
`NATIVE_SIGNING_KEY`, `NATIVE_SIGNING_KEY_PASSPHRASE` and `NATIVE_SIGNING_KEY_FINGERPRINT`
environment variables, then run `native-maven-bundle.mjs import-key` and `bundle` as the workflow
does. Never sign with, or store, the release key on a development machine. For a clean candidate,
`native-swift-release.mjs prepare` and `publish` accept `--remote` with a local bare repository, and
`native-consumers-prepare.mjs --swift-url` builds the consumers from that repository's tag.

### Native consumer installation

After the first native release, Swift applications add the package and pin an exact alpha:

    .package(url: "https://github.com/tileflow/tileflow-swift", exact: "0.1.0-alpha.0")

Android applications use Maven Central:

    implementation("dev.tileflow:tileflow-sdk:0.1.0-alpha.0")
