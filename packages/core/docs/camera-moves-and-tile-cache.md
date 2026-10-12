# Camera moves and the tile cache

A long camera move outruns the network: the new view's tiles take longer to arrive than the move
takes. Some examples are a flight from a street to a region and back, a guided tour, or a scripted
opening. MapLibre keeps the tiles it no longer shows in an out-of-view cache, so a camera that
comes back finds them ready. This guide covers what keeps that cache useful and what empties it,
as MapLibre GL JS 6 behaves.

## What the cache keeps

The out-of-view cache holds about five views' worth of tiles per source:

- **Size.** It is the tiles across the map times `maxTileCacheZoomLevels`, 5 by default.
  `maxTileCacheSize` caps it.
- **Too small for a flight.** A move that crosses many zooms (a street, the region, the street
  again) needs more. Raise `maxTileCacheZoomLevels` on the map, for example to 12, so tiles
  loaded early in a sequence are still there at its end.
- **Exact tiles only.** While a tile the camera needs is loading, MapLibre falls back on its loaded
  parents or children only among the tiles it shows. It does not fall back on tiles it keeps out
  of view. A cached tile helps only when it is the very tile a frame needs.

## What empties it

Changes that make MapLibre lay a source's tiles out again also empty that source's out-of-view
cache. The tiles in view are parsed again; the cached ones are dropped and come back from the
network when the camera returns.

**Changes that lay tiles out:**

- Any layout property, `visibility` included, through `setLayoutProperty`.
- A filter, through `setFilter`.
- A new value, through `setPaintProperty`, for a paint property whose value reads feature data,
  such as `['get', ...]` or `['feature-state', ...]`.
- `setStyle` with layers that differ. A style that is not diffed starts every source afresh.
- In a theme blend, a change of the nearest theme over values like these. See
  [theme transitions and blends](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/theme-transitions-and-blends.md).

**Changes that keep the cache:**

- A constant paint value, or one that reads only the zoom.
- `setFeatureState`, which rewrites the paint of the features it names.
- Global state read by values that read no feature data.

During a camera move, change only what keeps the cache. Make layout changes, filters and theme
crossings before the move starts or after it ends. To mark features during a move, prefer feature
state over a filter.

## Warm cameras before a move

MapLibre GL JS 6 has no public way to load a camera's tiles without showing it. Until it does,
warm cameras while something covers the map, such as a title card or a loading screen. Visit each
camera with `jumpTo`, wait until its tiles are in, then go on to the next:

<!-- docs:check -->

```ts
type WarmableMap = {
  jumpTo(options: {
    center: [number, number];
    zoom: number;
    bearing?: number;
    pitch?: number;
  }): unknown;
  loaded(): boolean;
  on(event: 'render', listener: () => void): unknown;
  off(event: 'render', listener: () => void): unknown;
  triggerRepaint(): void;
};

type Camera = {center: [number, number]; zoom: number; bearing?: number; pitch?: number};

/** Resolves once the tiles of the camera on screen are in, or false after `ms`. */
function tilesIn(map: WarmableMap, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => {
      if (map.loaded()) done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      map.off('render', check);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    map.on('render', check);
    map.triggerRepaint();
  });
}

export async function warmCameras(map: WarmableMap, cameras: readonly Camera[], rest: Camera) {
  for (const camera of cameras) {
    map.jumpTo(camera);
    await tilesIn(map, 1500);
  }
  map.jumpTo(rest);
}
```

Four details matter:

- **Check after a frame.** `map.loaded()` can read false on the frame in which the last tile
  arrived. So check it after a frame, on `render`, not once right after `jumpTo`.
- **Do not wait for `idle`.** `idle` also waits for labels to fade in, which adds time and loads
  nothing.
- **Visit every zoom the move crosses.** A cached tile helps only when it is the exact tile a frame
  needs, so warm each zoom, not just the destination.
- **Make cache-emptying changes first.** Make the changes listed above before the first visit.
  Otherwise the warm-up is lost.

Mapbox GL JS offers `preloadOnly` on `jumpTo`, `easeTo` and `flyTo`, which loads a move's tiles
without showing it. A MapLibre release with an equivalent would replace the visits above with one
call per move.
