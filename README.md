# Tileflow SDK

Public TypeScript packages and command-line tooling for building beautiful, config-driven maps with
Tileflow and MapLibre GL JS.

The SDK keeps map configuration, local compilation, framework rendering, build integration,
headless capture, and hosted deployment tooling in one versioned workspace. The hosted platform,
API implementation, dashboard, database, and infrastructure live separately and are not part of
this repository.

## Packages

| Package                                 | Purpose                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`@tileflow/core`](packages/core)       | Typed configuration, semantic modules, validation, and MapLibre style compilation          |
| [`@tileflow/static`](packages/static)   | Static-map scene schemas, overlays, and request helpers                                    |
| [`@tileflow/dev`](packages/dev)         | Node integration utilities, watched artifacts, icons, and feature inspection               |
| [`@tileflow/capture`](packages/capture) | Pinned headless capture, receipts, visual analysis, and baseline comparison                |
| [`@tileflow/vite`](packages/vite)       | Vite development and build integration                                                     |
| [`@tileflow/next`](packages/next)       | Next.js development and build integration                                                  |
| [`@tileflow/webpack`](packages/webpack) | Webpack development and build integration                                                  |
| [`@tileflow/react`](packages/react)     | React map and static-image components                                                      |
| [`@tileflow/vue`](packages/vue)         | Vue map component                                                                          |
| [`@tileflow/svelte`](packages/svelte)   | Svelte map component                                                                       |
| [`@tileflow/cli`](packages/cli)         | `tileflow` init, validate, dev, capture, visual, icon, tileset, build, and deploy commands |

## Quick start

Install the alpha packages explicitly while the public API is still evolving:

```sh
npm install @tileflow/core@alpha @tileflow/react@alpha maplibre-gl
npm install --save-dev @tileflow/vite@alpha
npm install --save-dev --save-exact @tileflow/cli@alpha
```

Create `tileflow.config.ts`:

```ts
import {defineTileflow, labels, osm, poi} from '@tileflow/core';

export default defineTileflow({
  maps: {
    madrid: {
      basemap: osm(),
      theme: 'light',
      modules: [labels({roads: 'major'}), poi({categories: ['food', 'culture']})],
    },
  },
});
```

Then validate and run the application through its normal dev server:

```sh
npm exec --no -- tileflow validate
npm run dev
```

See the [Tileflow documentation](https://tileflow.dev/docs) and each package README for framework,
capture, visual-testing, icon, static-map, and hosted deployment workflows.

## Development

This repository uses Node.js 22 or newer and pnpm 11.13.1.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm run smoke:capture-public
```

The packed-consumer smoke installs the same `core`, `dev`, `capture`, and `cli` tarballs users
receive, audits their contents, and renders a deterministic local capture with the exact Playwright
Chromium headless shell.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Every package source manifest
uses `0.0.0-development`; after a normal pull request reaches `main` and its complete CI succeeds,
the protected publishing workflow compares packed artifacts with npm and releases only material
changes at their next independent alpha. There are no changesets, release tags, or Release PRs.
The exact operational and recovery contract lives in [PUBLISHING.md](PUBLISHING.md). The durable
local capture and visual-testing behavior is recorded in
[`docs/contracts/local-visual-capture.md`](docs/contracts/local-visual-capture.md).

## Licensing

No project-level source license is included in this snapshot. Third-party license and notice files
remain beside the code and artifacts they cover. Public visibility does not by itself grant rights
beyond applicable law and those third-party terms.
