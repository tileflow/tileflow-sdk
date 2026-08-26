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

Every export is an ordinary Tileflow map. Streets, Ferraris, Härad, Siegfried, Verdant, and
Soundings are complete first-party roots. Streets Dark and Cyberpunk extend Streets, while Matrix
extends Cyberpunk using the same `extends` contract available to application maps.

The official map objects are deeply frozen package singletons so one consumer cannot mutate
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
  harad,
  haradIcons,
  matrix,
  matrixIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  soundings,
  soundingsIcons,
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

`harad` is a self-contained historical green-map design named “Härad”. It uses Core's semantic
Streets compiler ABI without importing or extending the `streets` map or reusing any Streets asset.
It declares only `[haradIcons]`, whose nine original Tileflow SVG patterns describe arable land,
coniferous and deciduous woodland, orchards, paper grain, sand, settlements, water lines, and
wetlands. The visual grammar is inspired by Lantmäteriet's CC0 Häradsekonomiska kartan series
(1859–1934) and official legend. The package redistributes no Lantmäteriet scan, source pixel, legend
artwork, font, or map data; the shipped style and SVG patterns are original Tileflow work.

`soundings` is a self-contained nautical-chart design with ivory land, depth-graded water,
bathymetric labels, maritime symbols, port structures, named ferry routes, and restrained technical
magenta. It selects the same public semantic compiler contract without importing or extending
`streets`, and it declares only `[soundingsIcons]`. That directory owns the ten harbor, light, buoy,
wreck, rock, paper, and water symbol/pattern IDs used by the map. GEBCO bathymetry provides broad
visual context rather than navigation-grade survey soundings: dashed outlines trace approximate
band edges and their labels describe depth ranges, not safety contours. The compiled map is not a
navigation product. Lateral buoy symbols remain ink-neutral because the current data contract does
not identify the applicable IALA region or carry authoritative buoy colours. Ferry lines and names
are transport context, not recommended tracks.

`siegfried` is a self-contained terrain atlas based on the visual grammar documented for
swisstopo's nineteenth-century Siegfried Map. It does not import or extend `streets`. It uses only
black, brown, blue, and an ivory paper substrate; client-derived 10/30-metre contour hierarchies
replace modern hillshade, while dedicated SVG engravings distinguish forest, rock, scree, glacier,
wetland, gravel, orchard, and water. `[siegfriedIcons]` owns those nine patterns and
`[siegfriedFonts]` owns the locally packaged Cormorant Garamond Regular, SemiBold, and Italic faces.

`verdant` is a self-contained contemporary field-atlas design. It combines a park-map information
hierarchy with a cool mineral substrate, clean blue hydrography, graphite buildings, and a
trail-forward accent; its original botanical textures appear only where detailed zooms make them
useful. It uses the same semantic compiler contract without importing or extending `streets`,
declares its own Noto Sans glyph provider, and owns its complete icon and pattern set through
`[verdantIcons]`.

`matrix` is a monochrome green-screen map derived from Cyberpunk's sparse HUD geometry. It replaces
every authored color with a reviewed phosphor-green ramp, gives every retained inherited effect a
Matrix-owned layer ID, drops the bright road centerline and building circuit texture, and replaces
the destination brackets with compact square nodes through `[matrixIcons]`. A translucent scanline
and dot pattern masks the cartographic linework so bright strokes break into the phosphor rows of an
old CRT without baking that texture into the map data; text layers render afterwards and stay
crisp. It reuses Cyberpunk's packaged Oxanium faces for uppercase labels while keeping roads,
building outlines, water edges, and landmarks readable against an almost-black substrate.

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
this package owns the official map definitions, icon and pattern sources, Cyberpunk and Siegfried
fonts, and their notices. Matrix reuses Cyberpunk's packaged Oxanium faces. Core never depends on
this package.
