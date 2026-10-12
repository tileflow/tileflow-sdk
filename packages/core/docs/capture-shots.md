# Capture shots

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

A shot is a short, timed camera move committed on the singular exported map. Capture renders it
frame by frame into a WebM video or a directory of numbered PNG frames. Like
[capture scenes](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/capture-scenes.md),
shots implicitly target their map, do not inherit, and are removed before cartographic compilation;
they affect visual evidence, not style or manifest identity.

## Commit a shot

This shot moves from central Madrid toward the east over four seconds while the map passes from
the `light` theme to the `dark` theme:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  version: 1,
  extends: streets,
  shots: {
    'dusk-flyover': {
      theme: 'light',
      viewport: {width: 1280, height: 720, dpr: 1},
      fps: 30,
      keyframes: [
        {
          at: 0,
          camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
          blend: {themes: ['light', 'dark'], position: 0},
        },
        {
          at: 4000,
          camera: {type: 'center', center: [-3.68, 40.42], zoom: 14, bearing: 30, pitch: 45},
          blend: {themes: ['light', 'dark'], position: 1},
        },
      ],
    },
  },
});
```

A shot has these fields:

- `theme`: a concrete theme of the map; `system` is invalid. The map loads this theme first, and a
  shot without a blend shows it throughout.
- `viewport`: CSS pixels and a `dpr` of 1 or 2, with the same limits as a scene viewport.
- `fps`: 24, 25, 30, 50, or 60 frames per second. The default is 30.
- `easing`: `smooth` (the default) eases into and out of each keyframe; `linear` moves at a constant
  rate between keyframes.
- `keyframes`: 2 to 64 entries. `at` is the whole number of milliseconds from the start of the
  shot. The first keyframe is at 0, every later keyframe is later than the one before it, and the
  last is at most 60000.

Keyframe cameras use the scene `center` form: `[longitude, latitude]`, zoom, and optional bearing
and pitch. The `bounds` form is not accepted, because the camera that fits bounds depends on the
renderer's viewport and projection, and a shot interpolates between exact cameras.

## Timing and interpolation

A shot renders one frame at the start and one every `1 / fps` seconds up to its last keyframe:
`floor(lastKeyframe.at × fps / 1000) + 1` frames, at most 3600. Frame `i` shows the shot at
`i × 1000 / fps` milliseconds, so the last keyframe is itself a frame when its time is a whole
number of frame intervals, as 4000 ms is at 30 frames per second.

Between two keyframes the center moves in Web Mercator coordinates, along the shorter way around
the world when it crosses the antimeridian. Zoom and pitch change linearly, and bearing turns along
the shorter arc. Easing applies to every value in the same way. A frame exactly at a keyframe shows
that keyframe's camera.

`tileflowCaptureShotFrames` returns the camera and blend position of every frame without rendering
anything, so tools can inspect a shot before capture:

<!-- docs:check -->

```ts
import {type TileflowMapShot, tileflowCaptureShotFrames} from '@tileflow/core';

const shot = {
  theme: 'light',
  viewport: {width: 640, height: 360},
  keyframes: [
    {at: 0, camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12}},
    {at: 1000, camera: {type: 'center', center: [-3.68, 40.42], zoom: 13}},
  ],
} satisfies TileflowMapShot;

const frames = tileflowCaptureShotFrames(shot);
console.log(frames.length); // 31
console.log(frames[15]?.camera.zoom); // 12.5
```

## Blend themes along a shot

Add `blend` to every keyframe, or to none. Each blend lists the same two to eight concrete themes in
the same order, and a `position` from 0 to one less than the number of themes, as in a
[theme blend](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/theme-transitions-and-blends.md).
The position moves between keyframes with the same easing as the camera.

Capture prepares the blend once with Core's theme controller and moves its position on every frame.
The controller applies a new position once it differs by at least a four-hundredth of a theme, so a
very slow blend changes the ground colours every few frames. Labels and icons change at the nearest
theme, without a cross-fade, because capture renders with reduced motion.

## Render a shot

Render committed shots with the CLI. The first command writes
`.tileflow/captures/shots/dusk-flyover.webm` and its receipt; the second writes numbered PNG frames
instead:

```sh
npx tileflow capture --shot dusk-flyover --json
npx tileflow capture --shot dusk-flyover --format frames --json
```

Each frame waits until MapLibre has loaded the tiles and resources it needs, so a slow machine or
network makes the render take longer but never drops or repeats frames. See the
[capture guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/README.md) for
the Node API and the
[capture contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/local-visual-capture.md)
for output paths, encoding, and the shot receipt.
