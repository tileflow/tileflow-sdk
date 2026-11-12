# @tileflow/dom reference

## `createTileflowMap(container, options, createOptions?)`

Mounts a map in `container` and returns a controller at once. MapLibre loads lazily, after the
manifest and style are ready. Throws a `TypeError` for an invalid `source`, `theme`, `timeOfDay`,
`themeBlend` or `themeTransition`, and when both `views` and `renderTargets` are given.

### Options

Every option except `source` is optional and can change after mount through `update` or a setter.

| Option                                           | Meaning                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `source`                                         | `{map, manifestUrl?}`: the map by name, from the default manifest or `manifestUrl`.                       |
| `theme`, `timeOfDay`                             | A concrete theme or `"system"`, which follows the page's colour scheme; an optional artistic preset.      |
| `themeBlend`                                     | `{themes, position, hold?}`: a continuous blend of two to eight themes instead of `theme`.                |
| `themeTransition`                                | `{duration}` in milliseconds, used for theme, blend, colour and emphasis changes.                         |
| `colors`, `emphasis`                             | Colour token or knob overrides (CSS variables are read where the map sits); modules that recede.          |
| `vegetation`, `viewMode`                         | 3D scene inputs; `viewMode` defaults to `"3d"`.                                                           |
| `center`, `zoom`                                 | The view until `bounds` or `fitAnnotations` is given; a change moves the camera at once.                  |
| `bounds`, `fitBoundsOptions`, `fitAnnotations`   | Bounds to show, how they are fitted, or a fit to all annotations. The first fit is immediate.             |
| `interactive`, `navigationControl`               | Whether the map takes input; zoom and compass buttons, none unless asked.                                 |
| `mapOptions`                                     | MapLibre options apart from `container` and `style`. A structurally different value recreates the map.    |
| `analytics`                                      | Analytics fields merged with the style's own.                                                             |
| `annotations`, `annotationClusters`              | Portable annotations and optional clustering.                                                             |
| `dataSources`, `dataOverlays`                    | Application GeoJSON and the overlays drawn over it, keyed as in `defineMap`.                              |
| `interactions`                                   | Semantic interaction bindings on map features.                                                            |
| `interactionState` or `defaultInteractionState`  | The open popup, controlled or initial. Which of the two is used is fixed when the map is created.         |
| `views`                                          | `{marker?, popup?, tooltip?}` renderers that fill a plain element.                                        |
| `renderTargets`                                  | `{marker?, popup?, tooltip?, onChange}` for a framework that draws views itself; replaces `views`.        |
| `onLoad`, `onError`, `onThemeChange`             | The loaded MapLibre map; `{code, error}` failures (`console.error` without a handler); theme transitions. |
| `onInteractionEvent`, `onInteractionStateChange` | Pointer and popup events; requested popup state.                                                          |
| `onInteractionDiagnostic`                        | Each distinct interaction diagnostic, once.                                                               |
| `onStatusChange`                                 | Every change to the status `getStatus` returns.                                                           |
| `mode`, `imageUrl`, `alt`, `imageLoading`        | `"image"` shows a static image instead of a map: `imageUrl`, or one the map's style resolves.             |
| `image`                                          | In image mode, an `<img>` your page renders (or `null` until it does); otherwise the map adds its own.    |

### Image mode

With `mode: "image"` no MapLibre loads. The map shows `imageUrl`, or an image of the style at the
view and container size, and is `idle` once that image has loaded and decoded. Annotations,
interactions, interaction state, interaction callbacks and views are unavailable there and report
`UNSUPPORTED_MODE`. A framework that renders on the server passes its own `<img>` as `image` and
sets its `src` from `status.imageUrl`.

### Create options

Read once: `captureId` (written as `data-tileflow-capture-id`), `sessionSource` (names the
integration in session analytics) and `statusElement` (the element that receives the capture
attributes; the container unless given, none when `null`).

### Views

A renderer is `(element, context) => void | {update?, destroy?}`. It runs when the view appears,
and again on an emptied element when its context changes, unless it returned `update`. `destroy`
runs when the view leaves the map. A marker context has `state: {hovered, focused, selected}`;
popup and tooltip contexts belong to an annotation or to a map feature and carry `close`. A kind
with no renderer keeps the default view.

## Controller

| Member                                                   | Meaning                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                                                  | Settles with the MapLibre map on its first load (`null` once an image shows); rejects when it cannot start or is destroyed first.                  |
| `update(options)`                                        | Applies changed options; left-out keys keep their value, `undefined` clears one.                                                                   |
| `setTheme`, `setThemeBlend`, `setColors`, `setEmphasis`  | One option each.                                                                                                                                   |
| `setView({center, zoom})`, `setBounds(bounds, options?)` | Camera options.                                                                                                                                    |
| `setAnnotations`, `setInteractions`, `setViews`          | Content options.                                                                                                                                   |
| `setInteractionState(state)`                             | Opens or closes a popup; on a controlled map the same as passing `interactionState`.                                                               |
| `getStatus()`                                            | `{readiness, theme, diagnostics, imageUrl}`: `loading`, `idle` or `error`, the theme shown, interaction diagnostics and, in image mode, the image. |
| `getMap()`, `getThemeController()`                       | The MapLibre map and theme controller, `null` until the map exists and after it is taken down.                                                     |
| `getInteractionState()`, `getRenderTargets()`            | The open popup; the view elements the map handed out.                                                                                              |
| `destroy()`                                              | Takes the map down, removes the capture attributes and stops every listener. Later calls do nothing.                                               |

Runtime edits use `addSource`, `removeSource`, `addLayer`, `moveLayer` and `removeLayer`.
They return promises, wait for the style, and survive theme changes. A new source or renderer
rejects pending edits from the previous one. Image mode rejects these operations.
Layer positions use `slot`, `slotIndex`, `aboveLayerId` or `belowLayerId`.
React, Vue and Svelte expose these methods alongside `getMap` and `getThemeController`.

## `getTileflowMapInitialStatus(options, controlledInteractionState?)`

The status a map with these options has before it mounts: its declarative diagnostics, `error` or
`loading`, the theme it names and, in image mode, `imageUrl`. It touches no DOM, so a framework can
render capture attributes on the server and before the controller exists.
