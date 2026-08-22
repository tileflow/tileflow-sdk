# Publishing

This repository is the only source of public Tileflow SDK releases. Merging an ordinary pull
request to `main` is the complete release action: after the exact `main` commit passes the full
`CI / Required` gate, `.github/workflows/publish.yml` reconciles its public package artifacts with
npm and publishes every material difference automatically. There is no changeset, Release PR,
release tag, manual npm login, or second approval.

Hosted platform, API, dashboard, database, and renderer workspaces are never published from this
repository.

## Package and version model

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

Every source manifest uses the sentinel version `0.0.0-development`. Do not edit it to prepare a
release. npm's `alpha` dist-tag is the authoritative released version for each package. A package
whose artifact changed advances independently from `X.Y.Z-alpha.N` to `X.Y.Z-alpha.(N+1)`; an
unchanged package keeps its registry version. The workflow never updates `latest`.

While the SDK is in alpha, all automatic releases advance only the numeric alpha counter. A future
stable, minor, or major channel needs a separate reviewed policy; semantic intent cannot be inferred
safely from source bytes.

Internal runtime, optional, and peer dependencies use this development template in source:

    workspace:>=0.1.0-alpha.16 <0.1.0-beta.0

The template is not copied blindly into every release. During baseline comparison, each existing
edge keeps the range from that package's current npm tarball; a newly added edge is floored at the
dependency's current npm alpha. If the dependent package is selected, its final tarball receives
`>=<effective dependency version> <0.1.0-beta.0` for every internal edge. An unselected dependent
keeps its published ranges byte-for-byte, including legacy exact pins. This lets packages advance
independently without allowing a newly published dependent to resolve an older sibling that lacks
the API it was built against. The upper bound excludes beta, release-candidate, and stable versions.
Because an older dependent may still resolve a newer dependency inside that alpha window, changes to
an internal dependency must remain backward compatible with every still-supported published
dependent. When that is impossible, the automatic alpha-counter policy is no longer sufficient and
the version/range policy must be changed in a separately reviewed migration before merging.

Development-only dependencies may use `workspace:*`; they are not installed from the published
artifact and do not affect release selection or publication order.

## Material artifact detection

The reconciler downloads each package currently named by its npm `alpha` dist-tag, records its
internal runtime ranges, temporarily applies those eleven registry versions and per-edge ranges to
a clean checkout, builds all packages, and packs them.
The ephemeral checkout retains the `workspace:` prefix on those exact release ranges so pnpm and
Turborepo preserve dependency-first build order; `pnpm pack` removes only that workspace protocol
when it writes the public tarball manifest.
It compares the extracted candidate and registry package trees. It considers public file names,
file modes, file bytes, and publishable manifest metadata. It ignores only:

- the package's `version`, because the candidate is deliberately built at its registry baseline;
- `devDependencies`, because npm consumers do not install them from the published artifact; and
- object-key ordering in `package.json`.

Tests, repository-only documentation, workflows, and tooling do not cause a release unless they
alter a packed public artifact. Package READMEs, `files`, exports, runtime dependencies, executable
modes, or built JavaScript/declarations do. A non-deterministic build would appear changed on every
run, so packed outputs must remain deterministic.

For every materially different package, the workflow generates an ephemeral release plan bound to
the exact `main` SHA, records its npm version and dependency-range baselines, and records the target
topology and exact effective floor for every selected package. It applies only those target
versions, raises each selected package's internal dependency floors, forces a clean rebuild, and
repeats the pack comparison. A selected tarball whose internal topology differs from the plan, or an
unselected artifact or dependency range that changes during the final build, fails closed.

## Trusted Publishing prerequisites

Every npm package must authorize GitHub Actions Trusted Publishing from:

- organization: `tileflow`
- repository: `tileflow-sdk`
- workflow: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

The GitHub `npm-publish` environment must allow deployments from protected `main` only. Required
reviewers stay empty because the reviewed source PR and required CI are the approval. The workflow
uses a GitHub-hosted runner, requests `id-token: write`, unsets `NODE_AUTH_TOKEN`, publishes with
provenance, and carries no long-lived npm write token.

Adding a twelfth npm package is not fully automatic: npm requires a one-time package bootstrap and
Trusted Publisher registration with a maintainer session and two-factor authentication. After that
setup, normal releases follow this automatic reconciler.

## Workflow behavior

`Publish` normally starts from the successful push `CI` run for `main`. It also runs hourly and can
be dispatched manually as recovery, but those triggers have no independent authority. Every path
must prove all of the following before reading or publishing package state:

1. the candidate is the exact current head of `main` in `tileflow/tileflow-sdk`;
2. that exact SHA has a successful push run of `.github/workflows/ci.yml`, named `CI`; and
3. that CI run contains exactly one successful job named `Required`; and
4. the checkout, GitHub event SHA, tested SHA, and remote `main` SHA agree.

Reconciliation runs are serialized. A stale run exits without publication and the newest `main`
run reconciles the registry. The workflow then:

1. fails before npm reconciliation when the reviewed `PUBLIC_RELEASE_BLOCKERS.md` interlock exists;
2. validates the development manifests and internal dependency topology;
3. downloads and validates all eleven current npm `alpha` tarballs;
4. builds and packs all eleven packages at those registry versions;
5. selects only materially different artifacts and assigns each its next independent alpha;
6. rebuilds and runs `pnpm check` at the target versions;
7. packs and audits all packages, verifies selected and unselected artifact invariants, and runs the
   clean packed capture consumer;
8. rechecks that `main` has not advanced;
9. preflights npm immediately before publication; and
10. publishes selected packages in dependency-safe repository order with OIDC and provenance.

If no artifact differs, the run succeeds without invoking `npm publish`.

## Retry, partial publication, and recovery

npm does not provide a multi-package transaction. A batch can therefore be partially visible for a
short time. Internal prerelease ranges keep already-published dependents compatible, and packages
are published dependency before dependent. The scheduled reconciler repairs missing packages
without a button click.

A retry is idempotent only when an already-created target version has byte-identical contents and
the `alpha` dist-tag points to it. The workflow skips that package and continues. It fails closed if
the same immutable version contains different bytes, if the tag moved unexpectedly, if the previous
version is missing, or if `main` advanced. Do not bypass these checks, overwrite versions, use
`unpublish` as rollback, or move `alpha` manually.

If published behavior is defective, merge a corrective source PR. The next green `main` commit
publishes a new immutable alpha only for its materially changed packages. Platform and SDK changes
cannot be one atomic transaction; shared hosted contracts must remain backward compatible and be
deployed server-first.

## Local validation

Normal source validation does not query or publish to npm:

    pnpm install --frozen-lockfile
    pnpm run release:verify-source
    pnpm build
    pnpm check
    pnpm run smoke:capture-public
    pnpm run publish:alpha:dry-run

The last command is still local and publication-free. The authoritative registry comparison runs
only in the protected `Publish` workflow after the exact `main` CI succeeds.

## Consumer installation

Alpha consumers should request the mutable channel explicitly and pin the CLI exactly when
reproducibility matters:

    pnpm add @tileflow/core@alpha maplibre-gl
    pnpm add @tileflow/react@alpha @tileflow/vite@alpha
    pnpm add @tileflow/next@alpha @tileflow/webpack@alpha
    pnpm add @tileflow/vue@alpha @tileflow/svelte@alpha
    pnpm add @tileflow/static@alpha
    pnpm add -D @tileflow/capture@alpha
    pnpm add -D --save-exact @tileflow/cli@alpha
