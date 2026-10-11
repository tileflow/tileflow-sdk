# Style states

A theme can read a value that the application sets once for the whole style, such as whether
anything is selected. The theme reads it with `expr.globalState(name)`; the application sets it with
the theme controller's `setState(name, value)`. MapLibre calls these values global state (GL JS 5.6
or later).

## Read a state in a theme

A state reads `null` until the application sets it, so wrap it in a typed assertion with a fallback.
To let a value move smoothly, make the state a number and interpolate on it:

<!-- docs:check -->

```ts
import {expr} from '@tileflow/core';

// 0 shows the standing highlight, 1 the quiet plate; values between mix the two.
const selection = expr.toNumber(expr.globalState('selection'), 0);
export const captionPlate = expr.interpolate({kind: 'linear'}, selection, [
  [0, '#ef5f57'],
  [1, '#fff9ee'],
]);
```

A boolean works too, through `expr.case`, but it can only switch.

## Set a state from the application

This example assumes an existing MapLibre map named `map` that shows the `light` theme of a
published Tileflow map:

<!-- docs:check -->

```ts
import {createTileflowThemeController, type TileflowStyleSwitchMap} from '@tileflow/core/browser';

// A MapLibre map satisfies TileflowStyleSwitchMap.
export function selectionStates(map: TileflowStyleSwitchMap, styleUrl: string) {
  const controller = createTileflowThemeController({
    initial: {style: styleUrl, theme: 'light'},
    map,
  });
  void controller.setState('selection', 0);
  return {
    select: () => controller.setState('selection', 1, {transition: {duration: 300}}),
    clear: () => controller.setState('selection', 0, {transition: {duration: 300}}),
  };
}
```

A number eases from the value the map shows to the new one over the transition, so the plate mixes
smoothly from one colour to the other. Booleans, strings, `null`, and a number set for the first
time change at once, so set a starting value before easing it. A browser preference for
reduced motion changes at once. Each call supersedes an easing of the same state still in progress,
which resolves with `status: 'superseded'`; the new easing starts from where the old one stood.

States stay through `setTheme` and every `setBlend`: the controller writes them again after each
new style. `getState(name)` returns the value set last.

## Keep eased values free of feature data

Keep a value that eases on a state free of feature data and feature state. MapLibre evaluates such
a value for the whole layer at each frame. A value that also reads a feature's data or state is
evaluated per feature when its tiles are laid out, so each change of the state lays them out
again: the value follows late, in steps, and each frame costs far more. Put the per-feature choice
in another layer, or let the application draw the feature it marks.

## Cost

Each frame of an easing sets the state once, and MapLibre then evaluates again every paint value
that reads it. A state read by a few layers costs little; a state read by most layers of a map can
cost more per frame than the blend itself on slower devices.
