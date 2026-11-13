# Third-party notices

Except for the Streets POI pictograms documented below, the official Streets, Nautical, and Outdoors icon and pattern
artwork published under `assets/` is original Tileflow artwork.

This file is shipped with `@tileflow/maps` so future third-party assets have a stable place for
their required notices. The repository's Apache-2.0 license is
authoritative for the original Tileflow artwork.

## Maki POI pictograms

The 85 Streets POI discs under `assets/streets/icons/`, each with a light `<id>.svg` and a night
`<id>-dark.svg` variant, contain pictograms adapted from the `aerialway`, `airport`,
`amusement-park`, `aquarium`, `art-gallery`, `bank`, `bar`, `beach`, `building`, `bus`, `cafe`,
`campsite`, `car`, `car-repair`, `casino`, `castle`, `cemetery`, `charging-station`, `cinema`,
`clothing-store`, `college`, `convenience`, `dentist`, `doctor`, `dog-park`, `drinking-water`,
`embassy`, `fast-food`, `ferry`, `fire-station`, `fitness-centre`, `florist`, `fuel`, `garden`,
`golf`, `grocery`, `hairdresser`, `harbor`, `hardware`, `historic`, `hospital`, `information`,
`landmark`, `laundry`, `library`, `lodging`, `mobile-phone`, `monument`, `mountain`, `museum`,
`music`, `natural`, `nightclub`, `paint`, `park`, `parking`, `parking-garage`, `pharmacy`,
`place-of-worship`, `playground`, `police`, `post`, `prison`, `rail`, `rail-light`, `rail-metro`,
`religious-buddhist`, `religious-christian`, `religious-jewish`, `religious-muslim`, `restaurant`,
`shop`, `soccer`, `stadium`, `star`, `swimming`, `theatre`, `toilet`, `town-hall`, `viewpoint`,
`waterfall`, and `zoo` icons in `@mapbox/maki` 8.2.0, upstream commit
`6ab50f392294aeb20b3af83e8a10067151876eb9`. Each SVG names its source icon in its description;
`src/official/streets-poi.ts` maps every disc to its source.

Maki is dedicated to the public domain under CC0-1.0. Tileflow authored the circular containers,
color system, sizing, composition, and SVG simplifications around those pictograms. The complete
upstream license is included at `assets/streets/LICENSE-MAKI.txt`.

POI discs occupy 20px inside a 24px cell. The 15px Maki source geometry is scaled to a centered
12px box before rasterization, keeping space between the pictograms and the circular border.

## Streets transit network symbols

The three `assets/streets/icons/transit-madrid-*.svg` files identify transport networks on map
points. Each source is centered, proportionally scaled, and given accessible metadata inside a
24px SVG cell. Geometry and identity colors are retained; all themes share the same asset.

- `transit-madrid-metro.svg`: [MetroMadridLogoSimplified.svg](https://commons.wikimedia.org/wiki/File:MetroMadridLogoSimplified.svg),
  by Przemysław Sakrajda, simplified by Kizar, with the current vector revision by Teo.raff.
  Licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
  This adapted SVG is distributed under the same license; the full text is in
  `assets/streets/icons/LICENSE-CC-BY-SA-3.0.txt`.
- `transit-madrid-cercanias.svg`: [Cercanias Logo.svg](https://commons.wikimedia.org/wiki/File:Cercanias_Logo.svg),
  by WikiNight2, with revisions by Alkari and Borjaguado. The source is dedicated to the public
  domain by its author and marked PD-textlogo on Wikimedia Commons.
- `transit-madrid-emt.svg`: [Símbolo de EMT Madrid.svg](https://commons.wikimedia.org/wiki/File:S%C3%ADmbolo_de_EMT_Madrid.svg),
  by Andreuvv, with a vector revision by Teo.raff. Licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This adapted SVG is distributed
  under the same license; the full text is in `assets/streets/icons/LICENSE-CC-BY-SA-4.0.txt`.

`assets/streets/icons/tileflow.icons.json` declares the credit, source and license of each
attributed symbol. When a build places one of them in a sprite, it writes that credit and the
complete license text beside the sprite as `icons/<map>/licenses/<icon>.txt`.

The transport identities remain the marks of their respective owners. Their inclusion identifies
the mapped services and does not imply affiliation or endorsement. These asset-specific terms
are separate from the package's source-code license.

## Relief

Streets hillshade and the Outdoors 3D surface, hillshade and contours request hosted Tileflow
Terrain at runtime. No DEM tile is packaged here. Terrain is derived from
[Mapterhorn](https://mapterhorn.com/attribution/), which combines public elevation data from many
producers. Each Terrain release declares its credit in its TileJSON, which the map shows as the
source attribution. The Tileflow map data credits page, <https://tileflow.dev/copyright#terrain>,
lists the producers and the licence statements their terms require.

## Nautical-chart references

The `nautical` map (formerly `soundings`) and its twenty-seven SVG symbols and patterns are original Tileflow code and artwork.
Its visual grammar was informed by NOAA's
[Historical Map & Chart Collection](https://historicalcharts.noaa.gov/) and the IHO
[S-4 and INT 1 standards index](https://iho.int/standards-and-specifications) as cartographic
references. This package does not include or redistribute NOAA chart images, IHO publication
artwork, official symbol sheets, fonts, hydrographic surveys, or navigation data.

The map can visualize broad GEBCO-derived bathymetric bands and `nautical-v1` navigation marks
exposed by the selected data sources. Neither is packaged here; the bands are not navigation-grade
soundings, and the marks keep the attribution of their own source. Nautical is a general-purpose
visual map, not a nautical chart for navigation.

## Official map lettering

Official maps draw DINish Medium and Bold, from
[playbeing/dinish](https://github.com/playbeing/dinish/tree/a5f3b2a3b932336225815bf9005e3b72cc3de71c),
and Noto Sans Regular, Bold and Italic as glyph ranges served by Tileflow. This package contains no
font files. Both families use the SIL Open Font License 1.1; each font's complete license is served
beside its glyphs as `glyphs/<font>/LICENSE.md`. DINish is an independent DIN-inspired font; DIN Pro
is not used.

## Historical climate context

Streets uses a smoothed colour proxy derived from Beck et al. (2023),
https://doi.org/10.1038/s41597-023-02549-6, under CC BY 4.0.
Source, attribution and adaptation details: assets/streets/climate/NOTICE.txt. The compiled source
credit links to <https://tileflow.dev/copyright#streets-climate>, which carries the same notice.
The image is historical context, not live vegetation.

## Outdoors elevation and shared artwork

Outdoors reads its elevation from hosted Tileflow Terrain, with the notice under Relief above.
Outdoors shares Streets lettering, POI pictograms, transport symbols and climate context, with the notices above.
The two summit symbols in `assets/outdoors/icons/` are original Tileflow artwork.
