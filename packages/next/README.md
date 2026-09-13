# @tileflow/next

Prepare Tileflow styles and assets for a Next.js application. Development serves fresh generations
through an App Router route handler; production writes static files to `public/tileflow`. No separate
Tileflow server is needed.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing Next.js 14–16 App Router application on Node.js 22 or newer:

```sh
npm install @tileflow/next@alpha @tileflow/react@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
```

Use compatible React/React DOM versions from your Next.js application. The React adapter accepts
versions 18–19 and MapLibre GL JS `>=6.4.1 <7`. The server integration uses Node.js, not the Edge
runtime.

## Configure the map and Next.js

Create `tileflow.config.ts` at the application root:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  version: 1,
  extends: streets,
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

Wrap your existing configuration in `next.config.mjs`. The `.mjs` form works across the supported
Next.js versions:

<!-- docs:check -->

```js
import {withTileflow} from '@tileflow/next';

export default withTileflow({});
```

Keep the application's other Next.js options. Add
`app/api/tileflow/[[...tileflow]]/route.ts` (under `src/` when your app uses that directory):

<!-- docs:check -->

```ts
import {createTileflowRouteHandlers} from '@tileflow/next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const {GET, HEAD} = createTileflowRouteHandlers({routeBase: '/api/tileflow'});
```

`withTileflow()` rewrites `/tileflow/*` to this route only in development. The handler shares one
watched generation across repeated route-module evaluation. A custom harness that owns handlers
must call `close()` on shutdown; this App Router module retains its shared handler for the process
lifetime.

## Deliver the matching worker

Create `scripts/copy-maplibre-worker.mjs` in the application. Run it from the application root after
installing dependencies and before development or production builds:

```js
import {copyFile, mkdir} from 'node:fs/promises';

await mkdir('public/maplibre', {recursive: true});
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(
    new URL(import.meta.resolve(`maplibre-gl/dist/${file}`)),
    `public/maplibre/${file}`,
  );
}
```

```sh
node scripts/copy-maplibre-worker.mjs
```

Include that command in your existing `predev` and `prebuild` scripts. Copy both files from the same
installed MapLibre version; do not combine a new main module with an old or CDN-hosted worker.

## Render a client component

Create `app/map.tsx` (or `src/app/map.tsx`) and render `CityMap` from a page:

<!-- docs:check -->

```tsx
'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import {configureTileflowMapLibre, Map} from '@tileflow/react';

configureTileflowMapLibre({workerUrl: '/maplibre/maplibre-gl-worker.mjs'});

export function CityMap() {
  return <Map source={{kind: 'tileflow', map: 'madrid'}} theme="system" />;
}
```

The interactive map belongs behind a client boundary. It reads prepared assets, not executable
config. For annotations, capture readiness, and static-image behavior, see the
[React guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md).

## Use a base path

In `next.config.mjs`:

<!-- docs:check -->

```js
import {withTileflow} from '@tileflow/next';

export default withTileflow({basePath: '/app'}, {base: '/maps'});
```

Set the component's `source.manifestUrl` to `/app/maps/manifest.json` and the worker URL to
`/app/maplibre/maplibre-gl-worker.mjs`. Omitting `manifestUrl` is correct only for exactly
`/tileflow/manifest.json`. The browser does not discover `basePath`; explicit URLs also keep SSR and
hydration consistent.

## Build and capture

`next build` writes the complete static artifact generation. Preparation works with Next.js's
Webpack and Turbopack builds where those modes are supported by the installed Next.js version.
Development serves local PMTiles snapshots; production rejects unresolved local archives. Publish
managed data explicitly or supply an application-owned production source. Do not run a second CLI
build over a hosted delivery manifest.

Keep the normal Next.js server running in one terminal. With the
[CLI](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) installed and an
`app-desktop` application scene defined, run in another terminal:

```sh
npx tileflow capture app-desktop --url http://127.0.0.1:3000/ --json
```

Use the app's actual loopback URL. Capture does not start a server. Config loading executes trusted
imports; local preparation needs no API key, but rendering can still fetch remote data and fonts.
CI compiles packed consumers at the supported Next.js major boundaries. Use the installed README
and declarations for a release rather than newer source on `main`.
