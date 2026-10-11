# Dynamic style images

Use `registerImage` on an existing `TileflowThemeController` from `@tileflow/core/browser` when an
application draws RGBA pixels that depend on a theme or style state. The controller owns the image's
registration, refresh and restoration. The application owns its drawing and prepares asynchronous
assets before registration. This browser API is tested with MapLibre GL JS 6.13; it is not a Native
or Static Maps image contract.

Start with the [Core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md)
and [theme controller setup](theme-transitions-and-blends.md#use-the-core-controller).
The map's symbol layer must already refer to the same image ID in every theme. Register before its
first placement. Choose an ID that does not exist in the sprite or belong to another application
resource. Registering an image does not create a layer or add points to a source.

## Draw an alert from state

This helper runs after browser mounting, with the controller for the existing map. The image is
64 physical pixels at pixel ratio 2, so it occupies 32 logical pixels before the layer's icon scale.

<!-- docs:check -->

```ts
import type {TileflowThemeController} from '@tileflow/core/browser';

export function registerAlert(controller: TileflowThemeController) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Canvas 2D is unavailable.');

  return controller.registerImage('live-alert', {
    width: 64,
    height: 64,
    pixelRatio: 2,
    states: ['alert'],
    render({theme, states}) {
      context.clearRect(0, 0, 64, 64);
      context.beginPath();
      context.arc(32, 32, 24, 0, Math.PI * 2);
      context.fillStyle = states.alert ? '#ee624e' : '#edbd53';
      context.fill();
      context.strokeStyle = theme === 'night' ? '#ffffff' : '#253b42';
      context.lineWidth = 4;
      context.stroke();
      return context.getImageData(0, 0, 64, 64).data;
    },
    onError(error) {
      console.error('Alert image could not refresh:', error);
    },
  });
}

export async function activateAlert(controller: TileflowThemeController) {
  await controller.setState('alert', true);
}
```

The resource receives the states listed in `states`, including intermediate values during numeric
state transitions. `theme` is the committed theme, or the nearest theme of a blend. `blend` exposes
its position and ordered theme names for continuous artwork interpolation. States not set through
this controller remain undefined; an explicit null is distinct from an unset state.

## Update and release

Theme changes and changes to declared states schedule a refresh. Identical inputs do no work;
several changes before the next animation frame coalesce. The `setState` promise describes the
state transition, not completion of the next image frame. There is no independent animation clock.
For camera values, new application data or another external input, call the returned handle's
`refresh()`. Read those values inside `render`, and return `undefined` when the existing pixels are
still correct. Undefined output on the first render creates a transparent image.

`render` is synchronous and returns exactly `width * height * 4` RGBA bytes as a `Uint8Array` or
`Uint8ClampedArray`. The controller copies the buffer. Width and height must be integers from 1
through 2048; pixel ratio must be positive and finite. All three remain fixed until disposal.
Changing pixel ratio while keeping physical size would change logical size and collision geometry,
so choose it at registration rather than following device pixel ratio changes automatically.

A style reload restores the last valid image before placement. WebGL context loss suspends image
work; restoration replays pixels and processes pending inputs. `handle.dispose()` removes only
that resource's image and cancels its pending work. `controller.dispose()` releases all of its
images. Map removal cancels work and releases listeners. Disposal is idempotent.

Invalid registration throws before claiming a resource. Later render failures keep the last valid
pixels and call `onError`, or `console.error` when omitted. A later refresh can retry. Another image
owner is never silently overwritten. The application must not call `addImage`, `updateImage` or
`removeImage` for a registered ID. Dynamic IDs must stay identical across blended themes; mixing
them with theme-specific atlas artwork is rejected before the blend replaces the style.

## Placement and scope

This API changes image pixels only. It does not resize icons, split layers, change padding,
anchors, sort order, overlap, filters or source features. Native symbol placement and collisions
remain governed by the authored style. Transparent pixels still occupy the image's existing
geometry: this API does not define separate visual and collision bounds.

All features using an ID share its pixels and state. Independent per-feature animation, SDF
generation, image loading, GPU composition and automatic framework props are outside this API.
Keep every selectable icon in the same symbol layer RGBA, including fallbacks; mixing these images
with SDF icons does not become supported through registration.
Profile the application's drawing cost and visible symbol rendering on its target devices.
