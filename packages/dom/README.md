# @tileflow/dom

Mount an interactive Tileflow map in any DOM element, without a framework. One function creates
the map, loads its manifest and style, keeps its theme, colours, camera, annotations and
interactions current, and takes everything down again. It draws nothing of its own around the map:
marker, popup and tooltip views, loading and error states belong to your page.

Use it for plain pages and web components. The React, Vue and Svelte packages run on it and are the
easier way in those frameworks.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Supported peers are MapLibre GL JS `>=6.4.1 <7`. The local build workflow below requires
Node.js 22 or newer.

```sh
npm install @tileflow/dom@alpha @tileflow/core@alpha @tileflow/maps@alpha "maplibre-gl@^6.4.1"
npm install --save-dev --save-exact tileflow@alpha
```

Build a map into `public/tileflow` with `npx tileflow build --out public/tileflow`, as the
[React guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md#prepare-a-map)
shows.

With Vite, the plugin from `@tileflow/vite` gives every map MapLibre's worker, in development and
in production builds, so the application configures nothing. `tileflow()` prepares maps and adds
the worker. When the CLI build or a hosted manifest provides the maps, add only the worker
(`npm install --save-dev @tileflow/vite@alpha`):

```ts
import {defineConfig} from 'vite';
import {tileflowMapLibreWorker} from '@tileflow/vite';

export default defineConfig({plugins: [tileflowMapLibreWorker()]});
```

The worker comes from the same installed MapLibre as the map's main module.

With another bundler, configure the worker once before the first map, with the URL at which the
page serves `maplibre-gl/dist/maplibre-gl-worker.mjs`. An explicit configuration wins over the
Vite plugin's:

```ts
import {configureTileflowMapLibre} from '@tileflow/dom';

configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});
```

## Mount a map

The container needs a size; the map fills it and follows its resizes.

<!-- docs:check -->

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import {createTileflowMap} from '@tileflow/dom';

const container = document.querySelector<HTMLElement>('#map')!;
const map = createTileflowMap(container, {
  source: {map: 'madrid'},
  theme: 'system',
  annotations: [
    {
      ariaLabel: 'Prado Museum',
      coordinate: [-3.6921, 40.4138],
      id: 'prado',
      kind: 'marker',
      popup: {content: {kind: 'view', name: 'museum'}},
    },
  ],
  views: {
    popup(element, {close}) {
      const button = document.createElement('button');
      button.textContent = 'Close';
      button.addEventListener('click', close);
      element.append(button);
    },
  },
  onError: ({code, error}) => console.warn(code, error),
});

await map.ready;
map.setTheme('dark');
map.setColors({water: 'var(--brand)'});
map.destroy();
```

`createTileflowMap` returns at once. `ready` settles with the MapLibre map when it first loads.
Each setter applies one option; `update` applies several and does no work for values that did not
change, so an adapter can hand over all of its props on every render. The container carries
`data-tileflow-state` (`loading`, `idle` or `error`) for capture, and `getStatus` with
`onStatusChange` give the same readiness, the theme shown and interaction diagnostics to your own
loading or error view.

A view renderer fills the element it receives. It runs again on an emptied element when its context
changes, unless it returns `update`; `destroy` runs when the view leaves the map. A marker view
receives hover, focus and whether its popup is open in `state`.

`mode: "image"` shows a static image of the map instead, without loading MapLibre; `ready` then
settles with `null` once the image has loaded.

See [REFERENCE.md](REFERENCE.md) for every option and controller method.

## Extend the map

The map is a real MapLibre map: `ready` and `onLoad` give it, and `getMap()` returns it while it
exists. Add your own layers, sources, controls, events and MapLibre libraries to it.

<!-- docs:check -->

```ts
import {createTileflowMap} from '@tileflow/dom';

const map = createTileflowMap(document.querySelector<HTMLElement>('#map')!, {
  source: {map: 'madrid'},
  onLoad(mapLibreMap) {
    mapLibreMap.on('style.load', () => addRoute(mapLibreMap));
    addRoute(mapLibreMap);
  },
});

function addRoute(mapLibreMap: NonNullable<ReturnType<typeof map.getMap>>) {
  if (mapLibreMap.getSource('route')) return;
  mapLibreMap.addSource('route', {
    type: 'geojson',
    data: {
      type: 'LineString',
      coordinates: [
        [-3.7038, 40.4168],
        [-3.6921, 40.4138],
      ],
    },
  });
  mapLibreMap.addLayer({id: 'route', type: 'line', source: 'route', paint: {'line-width': 4}});
}
```

Tileflow owns the style it applied, its protocols, its hosted requests and session, and the
controls it adds. A theme change may replace the style while keeping the camera, so add your own
layers and sources again on `style.load`, as above, or pass them as `dataSources` and `dataOverlays`,
which the map puts back after every theme change. Keep the map's lifetime with the controller:
`destroy()` takes everything down, and `getMap().remove()` stops the controller too.

## Next steps

- [Show a popup on click](https://tileflow.dev/docs/examples/show-a-popup-on-click)
- [Themes and tokens](https://tileflow.dev/docs/map-design/themes-and-tokens)
- [Capture a map](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/README.md)
