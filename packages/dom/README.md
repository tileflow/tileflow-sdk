# @tileflow/dom

Mount an interactive Tileflow map in any DOM element, without a framework. One function creates
the map, loads its manifest and style, keeps its theme, colours, camera, annotations and
interactions current, and takes everything down again. It draws nothing of its own around the map:
marker, popup and tooltip views, loading and error states belong to your page.

Use it for plain pages and web components. The React, Vue and Svelte packages are the easier way in
those frameworks.

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
shows, and configure MapLibre's worker once before the first map. With Vite:

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/dom';

configureTileflowMapLibre({workerUrl});
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

## Next steps

- [Show a popup on click](https://tileflow.dev/docs/examples/show-a-popup-on-click)
- [Themes and tokens](https://tileflow.dev/docs/map-design/themes-and-tokens)
- [Capture a map](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/README.md)
