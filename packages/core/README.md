# @tileflow/core

Define and customize maps in TypeScript, then compile them to MapLibre Style JSON. Start from an
official Tileflow map or create your own, with typed settings for themes, roads, buildings,
labels, and other map features.

Use Core to author and validate the map and the Tileflow CLI to preview it. Display it with a
framework adapter, or the JavaScript API described below.

## Install

The SDK is in alpha. Use ES modules and Node.js 22.14+ (22.x) or 24+ for the CLI.

```sh
npm install --save-exact @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact tileflow@alpha
```

`@tileflow/maps` supplies the official Streets map used below. Keep your package-manager lockfile.

## Define your first map

Create `tileflow.config.ts` in your project:

<!-- docs:check -->

```ts
import {defineMap, labels, roads} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  modules: {
    roads: roads({detail: 'streets', hierarchy: 'clear'}),
    labels: labels({roads: 'major'}),
  },
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

This keeps Streets' themes and assets, customizes its roads and labels, and opens over Madrid.
Coordinates are `[longitude, latitude]`. Each config exports one map.

## Preview it

```sh
npx tileflow validate
npx tileflow preview
```

Open the local URL printed by the CLI. Change the starting `zoom`, save, and reload the preview
to see the result. Stop the server with Ctrl+C.

Local authoring and preview need no Tileflow account or API key. Remote map tiles and assets
still need a network connection.

## Display a map without a framework

`createTileflowMap` from `@tileflow/core/maplibre` loads a prepared named map with the same browser
runtime as the React, Vue and Svelte adapters. It manages map resources and cleanup, and exposes
the MapLibre instance for application-owned layers, controls and events. See the
[JavaScript map reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/REFERENCE.md#display-a-map-with-javascript)
for worker setup, an example and lifecycle ownership.

This entry is unreleased in the current source change. An existing `@alpha` installation does not
establish its availability; check the exports, TypeScript declarations and `REFERENCE.md` in the
exact Core package you use. Existing framework applications keep their component APIs.

## Learn more

- [Map configuration](https://tileflow.dev/docs/map-design/map-configuration): create a map or extend an existing design.
- [Themes and tokens](https://tileflow.dev/docs/map-design/themes-and-tokens): customize colors and switch appearances.
- [Semantic modules](https://tileflow.dev/docs/map-design/modules): style roads, water, buildings, and labels.
- [React](https://tileflow.dev/docs/integrations/react), [Vue](https://tileflow.dev/docs/integrations/vue), and [Svelte](https://tileflow.dev/docs/integrations/svelte): use your map in an application.
- [Core reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/REFERENCE.md): inheritance, compilation, assets, and browser/runtime contracts.

`REFERENCE.md` is also included in the installed package. Use that copy and its TypeScript
declarations for version-specific behavior; GitHub `main` can contain unreleased changes.

## Support and license

[Report an issue](https://github.com/tileflow/tileflow-sdk/issues) or read the
[full documentation](https://tileflow.dev/docs). Licensed under
[Apache-2.0](https://github.com/tileflow/tileflow-sdk/blob/main/LICENSE); third-party assets retain
their own terms.
