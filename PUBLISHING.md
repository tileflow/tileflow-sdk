# Publishing

This repository owns the coordinated public release of Tileflow's SDK packages. Hosted platform,
API, dashboard, database, and renderer workspaces are not published from here.

## Package set

Publish these packages together unless a release is deliberately scoped and dependency
compatibility has been proven:

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

All package manifests must carry the same intended release version. npm versions are immutable; do
not retry an already published version with different bytes.

## Cross-repository compatibility gate

`@tileflow/core`, `@tileflow/dev`, the Tileflow API, and `@tileflow/cli` share hosted API and icon
package contracts. Before publishing a change to those contracts:

1. pack the candidate SDK packages without publishing them;
2. install the candidate tarballs in the Tileflow platform repository;
3. run the platform API, database, web, renderer, Docker, and Cloudflare build gates;
4. deploy compatible platform behavior before or together with the SDK release; and
5. obtain release-owner approval for the coordinated rollout.

Do not roll back only one side of an incompatible contract. Roll forward or restore the matching
platform and SDK versions together.

## Trusted Publishing

Each npm package must authorize GitHub Actions Trusted Publishing from:

- organization: `tileflow`
- repository: `tileflow-sdk`
- workflow: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

Configure all eleven packages before creating the first release tag from this repository. The
workflow requires `id-token: write`, runs only on matching release tags, publishes packed tarballs
with no long-lived npm token, and records npm provenance for each published version.

`@tileflow/capture` did not exist when this repository was created, and npm cannot attach a Trusted
Publisher to a package that does not exist. Bootstrap an isolated `0.0.0-bootstrap.0` artifact once
under the non-consumer `bootstrap` dist-tag with an authenticated maintainer after all local and
remote gates pass. Do not call that bootstrap alpha.14: its code depends on SDK contracts newer
than the published alpha.14 set. Configure its Trusted Publisher immediately afterward; the first
consumer capture release and every later release must use the OIDC workflow.

The equivalent npm CLI configuration for an existing package is:

```sh
npx npm@11.19.0 trust github @tileflow/core \
  --repo tileflow/tileflow-sdk \
  --file publish.yml \
  --env npm-publish \
  --allow-publish
```

Repeat it for the complete package set and confirm with
`npx npm@11.19.0 trust list <package>`. Trust commands require npm 11.15 or newer, a maintainer
session, and two-factor authentication; do not create an automation token for the release workflow.

Create the one-time capture bootstrap from an audited alpha.15 build without changing the committed
release manifests:

```sh
bootstrap_root="$(mktemp -d)"
pnpm --filter @tileflow/capture pack --pack-destination "$bootstrap_root"
mkdir "$bootstrap_root/package"
tar -xzf "$bootstrap_root"/tileflow-capture-0.1.0-alpha.15.tgz \
  -C "$bootstrap_root/package" --strip-components=1
npm pkg set version=0.0.0-bootstrap.0 \
  dependencies.@tileflow/core=0.1.0-alpha.15 \
  dependencies.@tileflow/dev=0.1.0-alpha.15 \
  --prefix "$bootstrap_root/package"
npx npm@11.19.0 publish "$bootstrap_root/package" --access public --tag bootstrap
npx npm@11.19.0 dist-tag ls @tileflow/capture
```

npm assigns `latest` to the first version of a newly created package even when that first publish
uses a different tag. The registry can reject removing `latest` while it is the package's only
version. Inspect the generated package, configure its Trusted Publisher immediately, and minimize
the interval before the first coordinated consumer release. As soon as that release is public,
remove the automatic tag and verify that only `bootstrap` and the intended release stream remain:

```sh
npx npm@11.19.0 dist-tag rm @tileflow/capture latest
npx npm@11.19.0 dist-tag ls @tileflow/capture
```

Remove the temporary directory afterward. Never add the bootstrap tag to installation examples or
move `alpha` or `latest` to it.

## Release checklist

1. Confirm the release scope, confirm `main` CI is green, and update all affected package versions
   together.
2. Update package READMEs, contracts, third-party notices, and changelog/release notes as needed.
3. Run the local gates:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   pnpm check
   pnpm run smoke:capture-public
   pnpm run publish:alpha:dry-run
   ```

4. Inspect every dry-run tarball. Confirm it contains only intended public files, carries the
   `tileflow/tileflow-sdk` repository metadata, and contains no credentials or machine paths.
5. Complete the cross-repository compatibility gate when a shared contract changed.
6. Commit and push `main`; wait for the complete CI matrix to pass.
7. Validate that every package trusts `tileflow/tileflow-sdk`, `publish.yml`, and the
   `npm-publish` environment.
8. Create and push the exact matching tag:

   ```sh
   node scripts/validate-release.mjs v0.1.0-alpha.N
   git tag v0.1.0-alpha.N
   git push origin v0.1.0-alpha.N
   ```

Tags containing `alpha` publish with the `alpha` dist-tag. Other `v*` tags publish with `latest`.
The workflow has no manual publish trigger. It refuses a tag that differs from package versions,
builds before running the full test suite, checks the packed capture consumer, and verifies byte
integrity before skipping an exact version that npm already contains. It never overwrites a version.

## Consumer installation

Alpha consumers should request the alpha dist-tag explicitly and pin the CLI exactly:

```sh
pnpm add @tileflow/core@alpha maplibre-gl
pnpm add @tileflow/react@alpha @tileflow/vite@alpha
pnpm add @tileflow/next@alpha @tileflow/webpack@alpha
pnpm add @tileflow/vue@alpha @tileflow/svelte@alpha
pnpm add @tileflow/static@alpha
pnpm add -D @tileflow/capture@alpha
pnpm add -D --save-exact @tileflow/cli@alpha
```
