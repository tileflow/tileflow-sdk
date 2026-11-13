# Maps reference

Contracts of the official maps that do not fit their README.

## Streets labels and POIs

Streets labels default to English. A derived map can set `modules: {labels: refine({language: 'es'})}`
for Spanish, `auto` for the viewer's locale, or `local` for source names. Missing translations fall
back to the local name. The same selection applies to POIs and geographic labels.

Streets admits general POI ranks 3, 4 and 5 before zoom 16, from zoom 16 and from zoom 18.
Retail has one extra rank, lodging one fewer, and parks and transport admit all available ranks.
Bus stops and public toilets wait until zoom 17; bus stop names wait until zoom 18. Rail and metro
pictograms can enter at zoom 12, with names from zoom 13 (tram and ferry names from zoom 14).
Transit pictograms can also appear when the source supplies no name.
Source availability, the airport/garden quality
caps and symbol collisions still apply. Importance tiers 3–4 retain placement priority even when
their spatial density rank is lower.

## Streets colour knobs

Streets has more than 190 colour tokens. To recolour it without naming them, set a knob: a name
without a dot that stands for many tokens. `Map`'s `colors` prop and a theme controller's
`setColors` accept knobs beside tokens. Each knob has a reference token, and every other token it
governs moves by as much as the reference moves, so lighter and darker tokens stay lighter and
darker: major roads stay stronger than minor ones, and a park keeps its variants. A knob you do not
set leaves its tokens as the theme designed them, so water stays blue unless you give `water` a colour.
A token named in `colors` wins over the knob that governs it.

| Knob         | Colours                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `water`      | Oceans, lakes, rivers and their depth bands. Water labels take its hue.                |
| `greenspace` | Parks, grass, woods and other vegetation, flat and in 3D. Park labels take its hue.    |
| `land`       | The ground between everything else: the background and built-up land.                  |
| `buildings`  | Building fills and outlines, flat and extruded, and the surfaces of building models.   |
| `roads`      | Roads, their casings and tunnels. The color is for a minor road.                       |
| `labels`     | Place, road and neighborhood label text. The color is for ordinary labels.             |
| `labelHalo`  | The outline that keeps labels and icons readable over the map.                         |
| `accent`     | What an application adds: the route line and glow. Its edge and core keep their shade. |

Give each knob the color you want in the theme on screen, and give a dark theme its own colors.
A knob can only be set on a map that declares it; an unknown name is an error that lists the
knobs the map has. Derived maps inherit the knobs and may add or replace them with `colorKnobs`.

## Nautical data and colours

Nautical is not a navigation product. Its hybrid Bathymetry source uses cumulative depth bands,
native contours, available marine names and a continuous DEM with the same blue-shallow/white-deep
palette. Bathymetry supplies marine names through zoom 6, sized by class; World takes over at zoom 7.
Marine names, ferry routes and depth labels use bold, dark blue text with a pale halo to keep them
legible over relief and depth bands. Depth labels retain lowercase metre units.
Bands, native contours and depth labels remain visible when zooming beyond the source's
maximum zoom; this enlarges existing detail without increasing its resolution.
Its land colour stays warm sand. The separate Nautical tileset supplies marks and chart symbols
with a "Not for navigation" notice; other maps opt in with
`marine: 'nautical'` (see Core's Nautical marks guide). Both specialized products require
available releases and map-bound access. To preview coastlines without them, override
`marine: {bathymetry: false, nautical: false}`. The older World depth bands are not a substitute
for the dedicated Bathymetry product: they also include below-sea-level land and inland water.
