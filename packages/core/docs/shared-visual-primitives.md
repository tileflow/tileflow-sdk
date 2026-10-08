# Shared visual primitives

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

The same small visual language is reused across every geographic domain. This keeps an agent from
having to learn different spellings for the same MapLibre behavior:

- `BackgroundStyle`: color, opacity, pattern, visibility, and zoom range.
- `FillStyle`: color, opacity, pattern, antialiasing, visibility, and zoom range.
- `LineStyle`: color, width, opacity, dash, blur, gap, offset, pattern, caps, joins, and zoom range.
- `LineHatchStyle`: repeated diagonal detail with color, opacity, spacing, size, angle, and zoom
  range for a road structure.
- `TextStyle`: field, exact font face, exact fallback faces, size, color, halo, line-fitted
  background, spacing metrics, transform, collision policy, rotation, fixed/variable anchoring, line
  constraints, and zoom range.
- `IconStyle`: image, size, color, halo, rotation/alignment, collision policy, and zoom range.
- `CircleStyle`: radius, fill/stroke appearance, blur, opacity, pitch behavior, and zoom range.
- `ExtrusionStyle`: color, height, base, opacity, pattern, vertical gradient, and zoom range.

Compounds express common cartographic structures: `AreaStyle` has `fill` and `outline`,
`LineStackStyle` has `shadow`, `casing`, and `fill`, and `SymbolStyle` combines placement with
optional `text`, `icon`, and `marker`. Geographic selection remains owned by semantic modules;
ordinary visual styles intentionally do not accept raw source filters.

## Line-fitted text backgrounds

`text.background` draws one opaque strip behind each shaped line of a label, fitted to that line's
own width. Use it for captions whose lines differ in length, where a stretched icon plate
(`icon.textFit`) would cover the whole block.

<!-- docs:check -->

```ts
import {fixed, poi, zoom} from '@tileflow/core';

export const captions = poi({
  categories: ['arts-entertainment'],
  styles: {
    'arts-entertainment': {
      text: {
        background: {
          color: fixed('#080E11', {reason: 'Caption strip'}),
          fit: 'lines',
          padding: 0.33,
        },
        color: fixed('#ECEEE9', {reason: 'Caption text'}),
        font: fixed('Noto Sans Bold', {reason: 'Caption face'}),
        letterSpacing: fixed(0.08, {reason: 'Caption tracking'}),
        lineHeight: fixed(1.2, {reason: 'Caption leading'}),
        size: zoom.linear([
          [14, 11],
          [18, 14],
        ]),
      },
    },
  },
});
```

Tileflow lowers the background to MapLibre properties only. `text-font` becomes a derived stack,
such as `Noto Sans Bold lines-v1-t80-l1200-p330`. Its glyphs keep the source advances and shapes and
add a rectangular cell, which the text halo paints. The halo width tracks `text-size / 6`, including
zoom curves. Shaping, wrapping, collision, variable anchors, fading and right-to-left text therefore
stay native, and the compiled style needs no runtime extension.

- The colour must be opaque. Neighbouring cells overlap where they join.
- `font` must name one stack served by the map's `glyphs` provider, without `fallbacks`. Maps that
  use browser-rendered `fonts` reject backgrounds.
- `letterSpacing` and `lineHeight` must be constants. The derived stack encodes them in thousandths
  of an em, and the layer uses those rounded values. Tracking runs from 0 to 0.5em, leading from 0.8
  to 3 and padding from 0 to 1em.
- The background replaces the text halo. While a background is active, `haloWidth` and `haloBlur`
  are derived, and `haloColor` is the strip colour. Later refinements of size, tracking, leading or
  font re-derive the stack and halo.
- Collision still reserves the shaped block. Padding beyond it is drawn outside that box, so keep
  `padding` (text padding) at least as large as the strip padding in pixels.

The map's `glyphs` provider must serve derived stacks. `deriveTileflowLineBackgroundGlyphs`
computes any range from the source stack's range, and `parseTileflowLineBackgroundFontStack`
recognises derived requests. Local previews and captures derive ranges themselves; hosted and
self-hosted providers must do the same.
