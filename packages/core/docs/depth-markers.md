# Depth markers

DOM markers float above the map: in a 3D scene a pin behind a tower still shows in front of it.
`createTileflowDepthMarkers` draws markers in the map's 3D scene instead. A MapLibre custom layer
draws them against the depth the map's extrusions write, so nearer buildings hide them as the camera
moves.

## Add markers

This example assumes an existing MapLibre map named `map` with 3D buildings, and two pictures drawn
by the application:

<!-- docs:check -->

```ts
import {createTileflowDepthMarkers, type TileflowDepthMarkerMap} from '@tileflow/core/browser';

export function pinDestination(
  map: TileflowDepthMarkerMap,
  at: [number, number],
  pin: HTMLCanvasElement,
  ring: HTMLCanvasElement,
) {
  const markers = createTileflowDepthMarkers(map);
  // A pin facing the viewer, 28 × 40 CSS pixels, standing on the position.
  markers.add({lngLat: at, image: pin, size: [28, 40], anchor: 'bottom'});
  // A ring lying on the ground, 60 metres across.
  const halo = markers.add({lngLat: at, image: ring, size: [60, 60], alignment: 'ground'});
  return {
    pulse: (opacity: number) => halo.update({opacity}),
    dispose: () => markers.dispose(),
  };
}
```

A marker has:

- **Position.** `lngLat`, and `altitude` in metres above the ground.
- **Picture.** `image`: an image, an image bitmap, a canvas or image data. After drawing into a
  canvas again, pass it to `update({image})` so the marker uploads it once more. Markers that share
  a picture share its upload.
- **Alignment.** `screen` (the default) faces the viewer at `size` in CSS pixels, like a pin.
  `ground` lies flat on the ground at `size` in metres, in the camera's perspective, like a ring or
  an arrow painted on the street.
- **Anchor and placement.** `anchor` (`center` or `bottom`), `offset` in CSS pixels for screen
  markers, and `rotation` in degrees clockwise: from the screen's up for screen markers, from north
  for ground markers.
- **Opacity.** From 0 to 1.
- **`occlude`.** Defaults to true: nearer 3D content hides the marker. Set it to false for a marker
  that must always show.

Markers test against the scene's depth without writing to it, so they never hide one another. A
screen marker takes the depth of its position: a tower in front of the position hides the whole
pin, a tower in front of part of it hides that part.

## Layer and lifecycle

The markers share one custom layer, `tileflow-depth-markers` unless `id` names another, added with
the first marker. `beforeId` places it under a layer, given as an id or as a function that finds the
layer again after a style change. After a style change the layer puts itself back, and pictures
are uploaded again. `dispose()` removes the layer and releases its GPU resources.

Depth markers need MapLibre GL JS on WebGL 2 (GL JS 5 or later). They work on globe and Mercator
projections. They draw pictures only: draw text and effects into the picture, or keep DOM markers
for interactive content.
