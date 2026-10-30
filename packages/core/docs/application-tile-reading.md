# Application tile reading

Some application features need the map's data themselves rather than what MapLibre draws: a route
over the streets, the name of the place under the camera, buildings for a custom 3D layer.
MapLibre answers `querySourceFeatures` only for the tiles it has loaded for the current view, at
the zoom it shows. `createTileflowTileReader` reads chosen layers of a vector source for any area
at a fixed zoom instead, with the map's own tile address and request rules.

## Read an area

This example assumes an existing MapLibre map named `map` whose style has loaded a vector source
named `tileflow`:

<!-- docs:check -->

```ts
import {
  createTileflowTileReader,
  readTileflowMapTileSource,
  tileflowTilePointToLngLat,
  type TileflowTileSourceMap,
} from '@tileflow/core/browser';

export async function streetNamesNear(map: TileflowTileSourceMap, lng: number, lat: number) {
  const source = readTileflowMapTileSource(map, 'tileflow');
  if (!source) return [];
  const reader = createTileflowTileReader({...source, layers: ['transportation_name']});
  const tiles = await reader.readArea({
    bounds: [lng - 0.005, lat - 0.005, lng + 0.005, lat + 0.005],
    zoom: 14,
  });
  const names = new Map<string, [number, number]>();
  for (const tile of tiles) {
    const layer = tile.layers.transportation_name;
    for (const feature of layer?.features ?? []) {
      const name = feature.properties.name;
      const [x, y] = feature.geometry[0] ?? [];
      if (typeof name === 'string' && x !== undefined && y !== undefined)
        names.set(name, tileflowTilePointToLngLat(tile, x, y, layer!.extent));
    }
  }
  return [...names];
}
```

`readArea` reads the tiles covering the bounds at the zoom, clamped to the source's `minzoom` and
`maxzoom`. Deeper zooms read the source's last zoom. It leaves out tiles the source does not have
and refuses an area of more than `maxTiles` tiles (64 by default). `readTile({z, x, y})` reads one
tile. Both take an `AbortSignal`.

## What the reader returns

Each tile holds the chosen layers. Each layer holds its `extent` (tile units across the tile,
usually 4096) and its features. A feature has `type` (`Point`, `LineString` or `Polygon`),
`properties`, an `id` when the tile gives one, and `geometry`: one flat `[x0, y0, x1, y1, …]` array
per point set, line or ring, in tile units. Rings are closed and keep the vector tile winding:
exterior rings run clockwise in tile units, holes anticlockwise. Coordinates in a tile's buffer
fall outside `0` to `extent`, and lines are cut at the buffer's edge, so a feature crossing tiles
comes in pieces. `tileflowTilePointToLngLat(tile, x, y, extent)` converts a point to longitude and
latitude.

Feature ids read as MapLibre reads them, including ids beyond 2^53, so they can address feature
state on the map.

## Requests and cache

- **One request per tile.** However many reads wait for a tile, it is requested once. A read whose
  signal aborts stops waiting. Once every read waiting for a request has stopped, a request still
  waiting its turn is dropped; one already sent finishes for the cache, or stops when `cacheSize`
  is 0.
- **Cache.** The reader keeps up to `cacheSize` decoded tiles (128 by default), the most recently
  read first. It remembers a tile the source does not have (404 or 204) as absent, and does not
  remember errors. `clear()` forgets everything.
- **Concurrency.** At most `concurrency` requests (6 by default) run at once; the rest wait their
  turn, lowest `priority` first (a read option, 0 by default). `readArea` reads the tiles nearest
  its centre first.
- **Requests.** `transformRequest` rewrites each request as a MapLibre map's option does. Pass the
  map's own so tile reads follow the same rules. The browser's HTTP cache applies as for any
  request.
- **Archives.** A source served from a Tileflow PMTiles archive (a `tileflow-pmtiles://` address)
  is read through Core's PMTiles protocol, sharing the archives the page's map has opened. A
  `fetch` of your own replaces both.

The reader has no DOM dependency, so it also runs in a module worker: post the tile address and
zooms to the worker and create the reader there. `decodeTileflowVectorTile(bytes, {layers})`
decodes tile bytes an application already has.
