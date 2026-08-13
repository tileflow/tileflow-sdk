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

Configure all eleven packages before creating the first release tag from this repository. The
workflow requires `id-token: write` and publishes packed tarballs with no long-lived npm token.

## Release checklist

1. Confirm the release scope and update all affected package versions together.
2. Update package READMEs, contracts, third-party notices, and changelog/release notes as needed.
3. Run the local gates:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm build
   pnpm run smoke:capture-public
   pnpm run publish:alpha:dry-run
   ```

4. Inspect every dry-run tarball. Confirm it contains only intended public files, carries the
   `tileflow/tileflow-sdk` repository metadata, and contains no credentials or machine paths.
5. Complete the cross-repository compatibility gate when a shared contract changed.
6. Commit, tag, and push:

   ```sh
   git commit -m "Release 0.1.0-alpha.N"
   git tag v0.1.0-alpha.N
   git push origin main
   git push origin v0.1.0-alpha.N
   ```

Tags containing `alpha` publish with the `alpha` dist-tag. Other `v*` tags publish with `latest`.
The workflow skips an exact package version that npm already contains and never overwrites it.

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
