# Tileflow SDK

TypeScript packages and command-line tools for authoring, rendering, and deploying Tileflow maps.
Define a map in `tileflow.config.ts`, preview it locally, and use the same definition in an
application or a hosted deployment. Interactive maps use MapLibre GL JS.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Start with a local map

Use Node.js 22 or newer. Install the alpha packages explicitly and keep your package-manager lockfile:

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact tileflow@alpha
npx tileflow init
npx tileflow validate
npx tileflow preview
```

`init` creates `tileflow.config.ts`. `preview` serves that map on a loopback interface. Local
validation, compilation, and asset preparation need no Tileflow account or API key. Rendering may
still fetch the tiles, glyphs, or other remote resources referenced by the map; local does not mean
offline.

Each config exports one map. For example, replace the generated config with:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

Coordinates are `[longitude, latitude]`. This map inherits Streets' assets and its `light` and
`dark` themes. The browser selector `system` requires the map's light/dark mapping; builds and
captures always select a concrete theme.

## Choose a package

### Author and inspect maps

- [`tileflow`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md): CLI for
  initialization, validation, preview, builds, capture, data publication, and deployment. It is not
  a JavaScript library.
- [`@tileflow/core`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md): map
  definitions, semantic styling, validation, and MapLibre style compilation.
- [`@tileflow/maps`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/README.md): ten
  official maps and their icon, pattern, and font assets.
- [`@tileflow/capture`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/README.md):
  Node API for headless capture, receipts, visual reviews, and baseline comparisons.

### Render an application

Use one browser adapter and, optionally, the integration for your build tool. Browser adapters read
prepared manifests and styles; they do not compile executable map configuration.

- [`@tileflow/react`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md),
  [`@tileflow/vue`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vue/README.md), and
  [`@tileflow/svelte`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/svelte/README.md):
  interactive maps, themes, annotations, and image display.
- [`@tileflow/vite`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vite/README.md),
  [`@tileflow/next`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/next/README.md), and
  [`@tileflow/webpack`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md):
  watched development assets and production build integration.
- [`@tileflow/interactions`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/README.md):
  portable annotations, popup state, semantic POI bindings, and a direct MapLibre adapter.
- [`@tileflow/dev`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md): Node
  utilities for custom build and development-server integrations.

### Use location services

Installing a client does not enable a hosted service. Read the package's authentication,
availability, attribution, and retry requirements before making requests.

- [`@tileflow/static`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/static/README.md):
  static scenes, overlays, and creation/polling of hosted image renders.
- [`@tileflow/search`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/search/README.md):
  forward/reverse geocoding and suggestion resolution, without a UI.
- [`@tileflow/geoip`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/geoip/README.md):
  approximate location of the calling network connection; no private API key.
- [`@tileflow/coordinates`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/coordinates/README.md):
  coordinate reference system contracts, validation, and an HTTP client.
- [`@tileflow/coordinates-runtime`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/coordinates-runtime/README.md):
  local provisioning and execution adapter. Native engine, catalog, and grid assets are separate;
  no public native runtime distribution is currently offered.

## Use Tileflow from an agent

Start with the relevant package README or the [documentation index](llms.txt). Discover the map
language from the installed CLI rather than inventing properties or renderer layer IDs:

```sh
npx tileflow language manifest --json
npx tileflow language schema --json
npx tileflow validate --json
npx tileflow inspect --json
npx tileflow explain --theme dark --json
```

The two language commands return generated contracts without loading a project or accessing the
network. Other config-aware commands execute trusted repository code. Do not load an untrusted
`tileflow.config.ts` with credentials available.

The `main` branch can be ahead of npm. For an installed release, its packaged README, declarations,
and generated language contracts take precedence over examples from a newer checkout. Package
versions advance independently; do not assume every Tileflow package has the same alpha number.

## Contribute

This workspace uses Node.js 22 or newer and pnpm 11.13.1:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm run smoke:capture-public
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [documentation guide](docs/documentation.md).
Package behavior belongs in package READMEs; detailed ownership and lifecycle rules live in
[the SDK contracts](docs/README.md). The hosted API, dashboard, database, infrastructure, and
repository-only map playground are maintained separately.

Source packages use `0.0.0-development`. Merging a PR creates a release candidate, not an npm
publication. An authorized operator must dispatch the protected publication workflow and approve
its prepared bundle. See [PUBLISHING.md](PUBLISHING.md); do not edit versions, add changesets, create
release tags, or run `npm publish`.

## License

The SDK and Tileflow-owned official map artwork use the [Apache License, Version 2.0](LICENSE).
[Trademark rules](TRADEMARKS.md) apply separately. Third-party software, fonts, icons, data, and
imagery retain their own terms. Preserve the notices and attribution supplied with each package
and data source.
