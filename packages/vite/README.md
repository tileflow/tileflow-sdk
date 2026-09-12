# @tileflow/vite

Prepare Tileflow styles and assets inside a Vite application. Development watches config and asset
changes; production emits the same prepared manifest, concrete-theme styles, sprites, and fonts.
Use a browser adapter separately to render the map.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing Vite 5–8 application. Tileflow requires Node.js 22 or newer; the selected Vite release
may impose a higher Node.js minor version.

```sh
npm install --save-dev @tileflow/vite@alpha
npm install @tileflow/core@alpha @tileflow/maps@alpha
```

For the browser component and its peers, follow the
[React](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md),
[Vue](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vue/README.md), or
[Svelte](https://github.com/tileflow/tileflow-sdk/blob/main/packages/svelte/README.md) guide. Those
adapters support MapLibre GL JS `>=6.4.1 <7`.

## Configure a map

Create `tileflow.config.ts` at the application root:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({id: 'madrid', version: 1, extends: streets});
```

Add `tileflow()` to the existing Vite plugins in `vite.config.ts`. Keep your existing framework
plugins; this minimal configuration shows only the Tileflow integration:

<!-- docs:check -->

```ts
import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';

export default defineConfig({plugins: [tileflow()]});
```

Run the application's normal development or production-build command. At the default base, the
component can use `source={{kind: 'tileflow', map: 'madrid'}}`; it reads
`/tileflow/manifest.json`. Do not also run a CLI build that overwrites the same delivery manifest.
Config loading executes trusted imports and is not a sandbox.

## Configure the worker

In a React application's client entry, before mounting an interactive map:

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/react';

configureTileflowMapLibre({workerUrl});
```

Vue and Svelte import the configuration function from their own adapter. This URL import is
Vite-specific. Keep the worker and main module from the same installed MapLibre version, and import
`maplibre-gl/dist/maplibre-gl.css` in the client. The browser needs the emitted worker closure, not
a CDN worker from another version.

## Serve under a subpath

Set the build bases in `vite.config.ts`:

<!-- docs:check -->

```ts
import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';

export default defineConfig({
  base: '/app/',
  plugins: [tileflow({base: '/maps'})],
});
```

In the application, pass the resulting public URL explicitly:

```ts
const source = {
  kind: 'tileflow' as const,
  map: 'madrid',
  manifestUrl: '/app/maps/manifest.json',
};
```

Development and production expose the same prefixed URL. The browser does not infer Vite's base;
omitting `manifestUrl` is correct only for exactly `/tileflow/manifest.json`.

## Assets and capture

Development watches transitive config imports and local icon/font inputs, and serves the latest
valid generation. Invalid edits retain the last good snapshot. Local PMTiles are snapshotted for
coherent requests. Production rejects unresolved local PMTiles; publish managed data explicitly or
supply an application-owned production source. The plugin does not copy, hash, or publish datasets.

The normal Vite process is the only application server needed. Keep it running in one terminal.
With the [CLI](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) installed
and an `app-desktop` application scene defined, run in another terminal:

```sh
npx tileflow capture app-desktop --url http://127.0.0.1:5173/ --json
```

Use the application's actual loopback URL. Do not start a second `tileflow dev` listener.
Local preparation needs no Tileflow key; rendering can still fetch remote map resources.

CI tests the accepted Vite major boundaries with packed packages and production builds. Future
majors remain excluded until verified. For a published release, prefer its installed README and types
rather than newer source on `main`.
