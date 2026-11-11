# Third-party notices

Except for the Streets POI pictograms documented below, the official Streets, Soundings, and Outdoors icon and pattern
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

## Streets relief

Streets requests Mapzen Terrain Tiles from the AWS Open Data elevation tiles bucket at runtime.
No DEM tile is packaged here. The compiled source credit links to the Tileflow map data credits
page, <https://tileflow.dev/copyright#streets-terrain>, which lists the credits required by the
upstream data attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.
The dataset is described at <https://registry.opendata.aws/terrain-tiles/>.

The upstream attribution catalog includes ArcticDEM (DigitalGlobe imagery, NSF awards 1043681,
1559691 and 1542736); © Commonwealth of Australia (Geoscience Australia) 2017;
© offene Daten Österreichs — Digitales Geländemodell (DGM) Österreich; Canadian information
licensed under the Open Government Licence – Canada; Copernicus EU-DEM data funded by the
European Union; ETOPO1 from U.S. NOAA; INEGI Continental relief data; New Zealand Crown/LINZ
data; © Kartverket; © Environment Agency; and USGS 3DEP, GMTED2010 and SRTM data.
Consult the linked catalog for each source's complete required attribution and license terms.

## Nautical-chart references

The `soundings` map and its twenty-seven SVG symbols and patterns are original Tileflow code and artwork.
Its visual grammar was informed by NOAA's
[Historical Map & Chart Collection](https://historicalcharts.noaa.gov/) and the IHO
[S-4 and INT 1 standards index](https://iho.int/standards-and-specifications) as cartographic
references. This package does not include or redistribute NOAA chart images, IHO publication
artwork, official symbol sheets, fonts, hydrographic surveys, or navigation data.

The map can visualize broad GEBCO-derived bathymetric bands and `nautical-v1` navigation marks
exposed by the selected data sources. Neither is packaged here; the bands are not navigation-grade
soundings, and the marks keep the attribution of their own source. Soundings is a general-purpose
visual map, not a nautical chart for navigation.

## Streets lettering

Streets includes unmodified DINish Medium and Bold TTF files from
[playbeing/dinish](https://github.com/playbeing/dinish/tree/a5f3b2a3b932336225815bf9005e3b72cc3de71c),
and unmodified Noto Sans Regular, Bold and Italic TTF files from
[notofonts/noto-fonts](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601).
Both families use the SIL Open Font License 1.1. Complete copyright and license notices are
included in `assets/streets/fonts/LICENSE-DINish.txt`, `LICENSE-NotoSans.txt`, and the combined
`LICENSE.txt`. DINish is an independent DIN-inspired font; DIN Pro is not redistributed.

## Historical climate context

Streets uses a smoothed colour proxy derived from Beck et al. (2023),
https://doi.org/10.1038/s41597-023-02549-6, under CC BY 4.0.
Source, attribution and adaptation details: assets/streets/climate/NOTICE.txt. The compiled source
credit links to <https://tileflow.dev/copyright#streets-climate>, which carries the same notice.
The image is historical context, not live vegetation.

## Outdoors elevation and shared artwork

Outdoors uses Mapterhorn elevation at runtime for its 3D surface, hillshade and contours. No DEM
tile is packaged here. Its source links to <https://mapterhorn.com/attribution/>. Outdoors shares
Streets lettering, POI pictograms, transport symbols and climate context, with the notices above.
The two summit symbols in `assets/outdoors/icons/` are original Tileflow artwork.
