# Tileflow SDK

Public TypeScript packages and command-line tooling for building beautiful, config-driven maps with
Tileflow and MapLibre GL JS.

The SDK keeps map configuration, local compilation, framework rendering, build integration,
headless capture, and hosted deployment tooling in one versioned workspace. The hosted platform,
API implementation, dashboard, database, and infrastructure live separately and are not part of
this repository.

These workflows share one public authoring unit: a map. Every `tileflow.config.ts` exports one map,
usually by importing an existing map and extending it. Map inheritance and semantic modules resolve
to MapLibre Style JSON, MapLibre renders that style, local tooling prepares and serves assets, and
Hosted deployment publishes the prepared result. The durable ownership rules and terminology live
in the [SDK responsibility and delivery contract](docs/contracts/sdk-responsibilities.md).

## Packages

| Package                                           | Purpose                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`@tileflow/core`](packages/core)                 | Typed map language, semantic modules, validation, and MapLibre style compilation                           |
| [`@tileflow/maps`](packages/maps)                 | Official Streets, Ferraris, Härad, Siegfried, Soundings, Streets Dark, Cyberpunk, Matrix, and Verdant maps |
| [`@tileflow/interactions`](packages/interactions) | Portable annotations, tooltips, popups, state, and MapLibre interaction lifecycle                          |
| [`@tileflow/static`](packages/static)             | Hosted Static Maps scene schemas, overlays, and bounded request client                                     |
| [`@tileflow/dev`](packages/dev)                   | Node integration utilities, watched artifacts, icons, fonts, and feature inspection                        |
| [`@tileflow/capture`](packages/capture)           | Pinned headless capture, receipts, visual analysis, and baseline comparison                                |
| [`@tileflow/vite`](packages/vite)                 | Vite development and build integration                                                                     |
| [`@tileflow/next`](packages/next)                 | Next.js development and build integration                                                                  |
| [`@tileflow/webpack`](packages/webpack)           | Webpack development and build integration                                                                  |
| [`@tileflow/react`](packages/react)               | React map and static-image components                                                                      |
| [`@tileflow/vue`](packages/vue)                   | Vue map component                                                                                          |
| [`@tileflow/svelte`](packages/svelte)             | Svelte map component                                                                                       |
| [`@tileflow/cli`](packages/cli)                   | `tileflow` init, validate, preview (`dev` alias), capture, visual, icons, build, and deploy commands       |

## Quick start

Install the alpha packages explicitly while the public API is still evolving:

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha @tileflow/react@alpha maplibre-gl
npm install --save-dev @tileflow/vite@alpha
npm install --save-dev --save-exact @tileflow/cli@alpha
```

Create `tileflow.config.ts`:

```ts
import {defineMap, labels, poi, roads} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  modules: {
    roads: roads({detail: 'streets', hierarchy: 'clear'}),
    labels: labels({roads: 'major'}),
    poi: poi({categories: ['food', 'culture']}),
  },
});
```

`@tileflow/maps` also exports `ferraris`, `harad`, `siegfried`, `soundings`, `streetsDark`,
`cyberpunk`, `matrix`, and `verdant`. Streets, Ferraris, Härad, Siegfried, Soundings, and Verdant are complete
first-party roots. They share Core's semantic Streets compiler, but each defines its design
directly without importing or extending another official map. Siegfried adds browser-derived
contours, three-ink terrain engraving patterns, and locally packaged Cormorant Garamond faces;
Ferraris, Härad, Soundings, and Verdant likewise declare only their own package-owned assets.
Streets Dark and Cyberpunk are ordinary maps that extend Streets; Matrix extends Cyberpunk with a
monochrome phosphor-green palette and its own terminal-style symbols.
For the complete dark Streets map, import `streetsDark` and use it as the `extends` value;
`theme: {mode: 'dark'}` changes defaults for omitted styles but does not recolor exact styles in an
inherited curated map. The package-owned icons, patterns, and Cyberpunk font files ship under
`assets/`. Streets, Ferraris, Härad, Soundings, and Verdant each declare the canonical Tileflow glyph
URL with the exact `Noto Sans Regular` and `Noto Sans Bold` stacks. Cyberpunk selects the local
`Oxanium Medium` and `Oxanium SemiBold` faces; Siegfried selects local Cormorant Garamond Regular,
SemiBold, and Italic faces. The package exports each map's reusable icon and font directory
descriptors; Streets Dark composes its two directories in order so its dark `sidewalk-dot` replaces
the base icon without duplicating the rest of the catalog.

Then validate and run the application through its normal dev server:

```sh
npm exec --no -- tileflow validate
npm run dev
```

See the [Tileflow documentation](https://tileflow.dev/docs) and each package README for framework,
capture, visual-testing, icon, static-map, and hosted deployment workflows.

## Map playground

The SDK owns the reusable map definitions and packaged assets. The Tileflow Tiles repository owns
the local playground, development data wiring, scenes, and visual baselines that exercise those
maps. This keeps published SDK packages independent from repository-only example applications.

## Development

This repository uses Node.js 22 or newer and pnpm 11.13.1.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm run smoke:capture-public
```

The packed-consumer smoke installs the same `core`, `maps`, `dev`, `capture`, and `cli` tarballs users
receive, audits their contents, and renders a deterministic local capture with the exact Playwright
Chromium headless shell.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Every package source manifest
uses `0.0.0-development`; after a normal pull request reaches `main` and its complete CI succeeds,
it is a release candidate but nothing is published automatically. A deliberate, parameter-free
dispatch of the protected workflow compares packed artifacts with npm, prepares one exact bundle,
and waits for a single `npm-publish` environment approval before releasing only material changes at
their next independent alpha. There are no changesets, release tags, or Release PRs.
The exact operational and recovery contract lives in [PUBLISHING.md](PUBLISHING.md). The durable
local capture and visual-testing behavior is recorded in
[`docs/contracts/local-visual-capture.md`](docs/contracts/local-visual-capture.md).

## Licensing

The Tileflow SDK and Tileflow-owned official map artwork are licensed under the
[Apache License, Version 2.0](LICENSE). Every public npm package carries the same `LICENSE`,
[`NOTICE`](NOTICE), [generated-output grant](GENERATED_OUTPUT_LICENSE.md), and
[trademark boundary](TRADEMARKS.md).

The generated-output grant explicitly permits personal and commercial use, modification,
deployment, and redistribution of Tileflow-owned compiled styles and artifacts. It does not
relicense third-party software, fonts, map data, imagery, or other inputs. Preserve the license,
notice, and attribution requirements recorded beside those materials and in package-specific
`THIRD_PARTY_NOTICES.md` files.
