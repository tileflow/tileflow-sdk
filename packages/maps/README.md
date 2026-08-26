# `@tileflow/maps`

Official Tileflow maps and the assets they own.

```ts
import {defineMap} from '@tileflow/core';
import {streetsDark} from '@tileflow/maps';

export default defineMap({
  id: 'main-dark',
  version: 1,
  extends: streetsDark,
});
```

Every export is an ordinary Tileflow map. Streets and Ferraris are complete first-party roots.
Streets Dark, Cyberpunk, and Verdant extend Streets using the same `extends` contract available to
application maps.

The five official map objects are deeply frozen package singletons so one consumer cannot mutate
the definition seen by another. This does not change Core authoring: `defineMap(...)` still returns
the application-owned object without freezing it, and an application extends an official map by
declaring its own modules or other atomic overrides.

```ts
import {
  cyberpunk,
  cyberpunkFonts,
  cyberpunkIcons,
  ferraris,
  ferrarisIcons,
  streets,
  streetsDark,
  streetsDarkIcons,
  streetsIcons,
  verdant,
  verdantIcons,
} from '@tileflow/maps';
```

`ferraris` is a self-contained printed-atlas design. It uses Core's semantic Streets compiler, but
it does not import or extend the `streets` map and it does not inherit Streets assets. It declares
only `[ferrarisIcons]`, which contains nine original seamless SVG patterns for paper, cultivated
land, vegetation, settlements, sand, wetlands, and water. Applications can import it directly or
extend it like any other root.

`streetsDark` is the coordinated night version of Streets. It preserves the same content, geometry,
zoom hierarchy, and typography while applying a deliberately authored dark palette and lighting.
Use it when the whole Streets map should be dark. Its icon directories are
`[streetsIcons, streetsDarkIcons]`: the later dark directory replaces `sidewalk-dot`, while the
remaining Streets icons stay shared.

`theme.mode` is not a global recoloring switch. It selects compiler defaults and variant metadata
for style fields that a map leaves unspecified; exact styles declared by an inherited curated map
still win. Consequently, extending `streets` with only `theme: {mode: 'dark'}` does not produce a
complete dark Streets map. Extend `streetsDark` instead, then override the semantic modules your
application owns.

The directory descriptors point into this installed package. A map inherits its parent's icon or
font list when the property is omitted. Declaring a list replaces the inherited list, a later
directory wins for an exact duplicate ID, and `[]` selects no directories.

`@tileflow/maps` has a peer dependency on `@tileflow/core`. Core owns the map language and compiler;
this package owns the official map definitions, icon and pattern sources, Cyberpunk fonts, and their
notices. Core never depends on this package.
