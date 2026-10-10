# Theme transitions and blends

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

A Tileflow map can change theme with a cross-fade, or show any point between two or more of its
themes. Use a transition when people switch between appearances, such as light and dark. Use a
blend when the application controls the appearance continuously, such as a slider or a day that
passes from night to day.

Both work on the one MapLibre map the application already has. They create no second map, add no
map views, and request the same tiles as a map that does not change theme. The React, Vue, and
Svelte maps offer them with MapLibre GL JS, and the React Native map with MapLibre Native on iOS
and Android; see [React Native](#react-native) for what differs there.

## Cross-fade a theme change

Pass `themeTransition` to the React, Vue, or Svelte map. This React example assumes a map named
`city` with `light` and `dark` themes in the published manifest:

```tsx
import {Map} from '@tileflow/react';
import {useState} from 'react';

export function CityMap() {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  return (
    <>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Switch theme</button>
      <Map source={{map: 'city'}} theme={theme} themeTransition={{duration: 450}} />
    </>
  );
}
```

When the theme changes, a snapshot of the current frame covers the map. The snapshot follows the
camera while people pan, zoom, rotate, or tilt, and fades out once the new theme is drawn. The map
stays interactive throughout. `onThemeChange` reports `preloading`, `applying`, and finally `ready`
after the fade. A `theme="system"` change, entering a blend, and leaving one use the same
transition.

`duration` is in milliseconds, from 0 to 5000. It defaults to 0, which changes the theme at once.
When the browser asks for reduced motion, every change happens at once.

## Blend themes

Pass `themeBlend` with the themes to blend, in order, and a `position` between them. Position 0
shows the first theme, 1 the second, and 1.25 a quarter of the way from the second to the third:

```tsx
import {Map} from '@tileflow/react';
import {useState} from 'react';

export function DayMap() {
  const [position, setPosition] = useState(0);
  return (
    <>
      <input
        aria-label="Time of day"
        max={2}
        min={0}
        onChange={(event) => setPosition(Number(event.target.value))}
        step={0.01}
        type="range"
        value={position}
      />
      <Map source={{map: 'city'}} themeBlend={{position, themes: ['night', 'dusk', 'day']}} />
    </>
  );
}
```

The first blend of a set of themes loads each theme's style and fonts, prepares one style that
holds every theme, and replaces the map's style once, with `themeTransition` if set. Until then the
map shows the theme nearest to the position. After that, changing `position` updates the map at
once without loading anything, so it can follow a slider, a clock, or an animation frame by frame.
Changing `themes` prepares a new blend. Removing `themeBlend` returns to `theme`.

While a blend is shown, `data-tileflow-theme` names the theme nearest to the position.
`onThemeChange` reports the preparation of a blend; moving its position reports nothing.

### What follows the position

- Colours and numbers of the ground, such as land, water, roads, buildings, and their widths and
  opacities, follow the position continuously. Colours mix in the OKLab colour space, so halfway
  between two themes looks halfway to the eye.
- Patterns, the sky, and light follow the position too. Pattern artwork is mixed in its pixels.
- Labels, icons, and other symbols change when the nearest theme changes, with a short cross-fade.
  Light lettering on a dark plate and dark lettering on a light plate would meet in the same grey
  halfway, so symbols do not follow the position.
- A value that depends on feature state, such as a caption that changes colour when highlighted,
  changes with the nearest theme. MapLibre lays its source out again for that change; a cross-fade
  covers it.

### Which themes can be blended

Blend themes of the same map. Every theme of a map exposes the same token keys, so its compiled
styles share sources, layers, filters, and expressions, and differ only in colours, numbers, and
image names. Up to eight themes can be blended. A blend fails, and the map keeps its current
appearance, when the styles differ in structure, sources, sprite, or glyphs.

Icon and pattern artwork is mixed in place of the first theme's image when every theme's version
has the same size. Otherwise that image changes with the nearest theme instead.

### Cost

The prepared style holds every theme. A value that depends on feature data, such as a land-use
colour chosen by class, becomes one layer per class while the blend is shown, so the prepared
style has more layers than one theme. Physical layer IDs are diagnostic, not stable; semantic
interactions are not affected.

Entering a blend replaces the map's style once. MapLibre then takes about as long as it takes to
load the map: for a detailed city map, around half a second on a desktop computer and longer on a
phone, while the transition snapshot, if any, covers the map. Start a blend before people need it
to move, for example when the map loads.

Each position change after that sets the map's themed values directly, without expression parsing.
For a detailed city map this takes a few milliseconds on a mid-range phone. Positions closer than a
four-hundredth of a theme are not applied, so a slowly moving position leaves the map at rest
between changes.

## React Native

The `Map` of `@tileflow/react-native` accepts the same `themeTransition` and `themeBlend` props:

```tsx
import {Map} from '@tileflow/react-native';

export function DayMap({position}: {position: number}) {
  return (
    <Map
      source={{map: 'city', manifestUrl: 'https://maps.example.com/tileflow/manifest.json'}}
      themeTransition={{duration: 450}}
      themeBlend={{position, themes: ['night', 'dusk', 'day']}}
      style={{flex: 1}}
    />
  );
}
```

A transition covers the drawn map with a snapshot of its current frame, below markers and map
controls. The snapshot follows the camera and fades out once the new style is drawn.
`onReadinessChange` and `onThemeChange` report `ready` after the fade. The device's reduce-motion
setting (iOS) or removed animations (Android) change at once.

A blend loads every blended theme's style once and replaces the map's style once. Position changes
then apply in batches on the main thread, at most one at a time, and later positions replace any
that are still waiting. MapLibre Native's style transition smooths values between batches.

What follows the position differs from the browser in a few ways:

- Ground colours and numbers, pattern artwork, and light follow the position. Native maps have no
  sky.
- Labels, icons, and switched values change at the nearest theme under a short cross-fade of the
  whole map. Icon artwork changes by image name instead of mixing pixels, so stretchable images
  keep their stretch and content areas.
- A value that depends on feature data and cannot be split by class, such as a road casing chosen
  by access and zoom together, is drawn once per theme. Only the nearest theme's copy is shown.
  The map has a few more layers while the blend is shown.

If the application's native build predates these props, for example after an over-the-air
JavaScript update, themes change at once and a blend shows its nearest theme.

## Use the core controller

Framework adapters use `createTileflowThemeController` from `@tileflow/core/browser`. A direct
MapLibre integration can use it too. Resolve runtime styles from the published manifest with
`resolveTileflowRuntimeStyle` and `resolveTileflowRuntimeThemeBlend` from `@tileflow/core/runtime`:

```ts
import type {Map as MapLibreMap} from 'maplibre-gl';
import {createTileflowThemeController} from '@tileflow/core/browser';
import {
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeThemeBlend,
} from '@tileflow/core/runtime';
import type {TileflowRuntimeManifestMap} from '@tileflow/core/runtime';

export async function moveThroughTheDay(map: MapLibreMap, manifestMap: TileflowRuntimeManifestMap) {
  const source = {map: 'city'};
  const styleOf = (theme: string) => {
    const style = resolveTileflowRuntimeStyle({manifestMap, source, theme});
    if (!style) throw new Error(`The manifest has no ${theme} theme for ${source.map}.`);
    return style;
  };
  // `initial` is the runtime style the map was created with.
  const controller = createTileflowThemeController({initial: styleOf('day'), map});

  await controller.setTheme(styleOf('night'), {transition: {duration: 450}});

  const themes = resolveTileflowRuntimeThemeBlend({
    blend: {position: 0, themes: ['night', 'dusk', 'day']},
    manifestMap,
    source,
  });
  await controller.setBlend({position: 0.5, themes});
  // The same themes: the position applies at once.
  await controller.setBlend({position: 0.6, themes});
  return controller.getBlend(); // {position: 0.6, themes: ['night', 'dusk', 'day']}
}
```

`setTheme` and `setBlend` accept `{transition: {duration}}`;
`createTileflowThemeController({transition})` sets a default. Requests are serialized and the
latest wins. A failed change restores the previous appearance and reports `failed` with its error.

The controller loads blended themes' style documents with the same request policy it uses for
style font metadata: same-origin credentials, no redirects, and a bounded size. Pass `loadStyle`
when styles need another loader.

The controller also shows [map emphasis](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/map-emphasis.md),
which stays through theme changes and follows every blend position.

## Fast sweeps on slower devices

Each position change makes MapLibre evaluate the paint of every layer whose value changed. A clock
that moves slowly changes few values per frame, and positions closer than a four-hundredth of a
theme are skipped. A sweep that crosses a whole theme in a few seconds while the camera also moves
changes most ground layers on every frame. Measured in Chromium on Apple silicon at 1440 × 900 for
a detailed city map, such a sweep kept 76 frames a second; with the processor slowed four times, as
on a mid-range phone, it fell to about 11, against 28 for the same camera move without the sweep.
On slower devices, prefer short sweeps or move the position less often.
