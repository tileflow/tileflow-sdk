# @tileflow/webpack

Prepare Tileflow styles and assets through Webpack. The plugin serves watched generations in
Webpack Dev Server and emits static assets in a production build. It does not render the map in
your application; use a browser adapter for that.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use an existing Webpack application with Node.js 22 or newer and Webpack `>=5.61 <6`:

```sh
npm install --save-dev @tileflow/webpack@alpha
npm install @tileflow/core@alpha @tileflow/maps@alpha
```

For interactive UI, also follow the
[React](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md),
[Vue](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vue/README.md), or
[Svelte](https://github.com/tileflow/tileflow-sdk/blob/main/packages/svelte/README.md) guide.
Use the framework's supported peer versions and MapLibre GL JS `>=6.4.1 <7`.

## Configure a map and build

Create `tileflow.config.ts` in the application's root:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({id: 'madrid', version: 1, extends: streets});
```

Add the plugin to your existing Webpack configuration. This minimal example uses `webpack.config.mjs`:

<!-- docs:check -->

```js
import {TileflowWebpackPlugin} from '@tileflow/webpack';

export default {
  plugins: [new TileflowWebpackPlugin()],
};
```

Keep your application's existing entry, loaders, and plugins. Start it with its normal development
command, or run its production Webpack build. By default, the plugin exposes
`/tileflow/manifest.json` and concrete-theme styles under `/tileflow/styles/`. A component source of
`{kind: 'tileflow', map: 'madrid'}` selects the matching config ID.

## Configure the MapLibre worker

In a React application's client entry, configure the worker before mounting a map:

```js
import {configureTileflowMapLibre} from '@tileflow/react';

const workerUrl = new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString();
configureTileflowMapLibre({workerUrl});
```

Vue and Svelte import the same function name from their own adapter. Import
`maplibre-gl/dist/maplibre-gl.css` in the client as described in that adapter's guide. Webpack emits
the worker closure; serve every emitted asset at the configured public path. The worker and main
module must come from the same installed MapLibre version.

## Use a public path

The browser defaults only to `/tileflow/manifest.json`. It never reads Webpack configuration.
For example, in `webpack.config.mjs`:

<!-- docs:check -->

```js
import {TileflowWebpackPlugin} from '@tileflow/webpack';

export default {
  output: {publicPath: '/app/'},
  plugins: [new TileflowWebpackPlugin({base: '/maps'})],
};
```

Pass the final URL in your application, not in the Webpack configuration:

```ts
const source = {
  kind: 'tileflow' as const,
  map: 'madrid',
  manifestUrl: '/app/maps/manifest.json',
};
```

`base` defaults to `/tileflow`; `config` defaults to `tileflow.config.ts`. An explicit plugin
`publicPath` also changes asset locations. Keep the manifest URL and worker delivery consistent with
the final public path.

## Production output and hosted manifests

Production emits styles, prepared sprites, and packaged fonts. It rejects unresolved local PMTiles
rather than copying or publishing datasets. Publish managed data explicitly or supply an
application-owned production source. Development serves immutable PMTiles snapshots at stable
logical paths while generations change.

Before every emission, including watch rebuilds, the plugin refuses to replace a hosted delivery
manifest under `output.path`. Use `emitBuildArtifacts: false` or a separate output when deliberately
packaging a hosted manifest. `overwriteHostedManifest: true` is an explicit migration escape hatch;
it defaults to false and is not needed for normal setup.

## Capture the application

Keep Webpack Dev Server running in one terminal. With the
[CLI](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) installed and an
`app-desktop` application scene defined, run in another terminal:

```sh
npx tileflow capture app-desktop --url http://127.0.0.1:8080/ --json
```

Use your actual loopback URL. Capture neither starts the server nor needs a separate `tileflow dev`
process. Config imports are trusted executable code; local preparation needs no key, but rendered
maps may still request remote resources.

The peer-compatibility smoke tests use packed packages at the accepted Webpack boundary. Webpack 6
is outside the supported range. Use the installed README and declarations for release-specific APIs.
