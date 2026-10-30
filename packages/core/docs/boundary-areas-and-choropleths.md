# Boundary areas and choropleths

Tileflow's Boundaries tileset holds administrative and neighbourhood areas worldwide, from
countries down to districts and neighbourhoods. A map declares it with `boundaryAreas`, and
`boundaryChoropleth()` colors its areas from an application's values: unemployment by
municipality, sales by county, election results by district.

Boundaries is a separate product from World. World's border lines stay in the `boundaries` module;
`boundaryAreas` adds the areas themselves, each with a stable ID and official codes to join data
to.

## What the tileset contains

The `boundaries` family comes from OpenStreetMap under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). Its source carries the
attribution `© OpenStreetMap contributors`, which MapLibre shows whenever a layer drawn from it is
on screen. The attribution is fixed by the family and cannot be replaced.

It has two layers, from zoom 0 to 12:

- `boundary_area`: one polygon per area and class. Its outline is the boundary line.
- `boundary_label`: one point per area and class, with `name` and `name:<language>`.

Polygons carry the properties needed to filter and join them:

| Property      | Content                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| feature ID    | The area's registry ID. It survives releases while the area exists.                                                               |
| `class`       | `country`, `dependency`, `region`, `province_or_county`, `municipality`, `district` or `neighbourhood`.                           |
| `class_tier`  | `primary` for the level that covers a country with that class, otherwise `secondary`.                                             |
| `admin_level` | OpenStreetMap's `admin_level`.                                                                                                    |
| `admin_depth` | Depth in the country's administrative chain, from 0 for the country. Neighbourhoods have none.                                    |
| `ref`         | The official code with its scheme, such as `ES:INE:28079` or `US:GEOID:36061`; otherwise ISO 3166-2, or ISO 3166-1 for countries. |
| `iso_3166_1`  | The country's ISO 3166-1 alpha-2 code.                                                                                            |

Labels and the release's lookup table also carry `iso_3166_2`, `nuts`, `wikidata` and names.

One area can serve several classes. Berlin, for example, is a region, a district and a
municipality: the tileset draws it once per class, with the same ID and the `ref` of each class.
Filter a choropleth by class so that only one of those features is visible.

Each class appears from a fixed zoom: countries and dependencies from 0, regions from 3, provinces
and counties from 6 (secondary ones from 7), municipalities from 8, districts from 10 and
neighbourhoods from 11. `tileflowBoundaryAreasV1Schema.classMinzoom` lists them.

## Declare the source

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'municipal-indicators',
  version: 1,
  extends: streets,
  boundaryAreas: {family: 'boundaries'},
});
```

The compiled style gains the vector source `tileflow-boundaries`, which reads
`https://api.tileflow.dev/tiles/boundaries/tiles.json` (or the same path under the API base URL
passed to the compiler). `url` replaces it with a compatible TileJSON or a `pmtiles://` archive,
such as a local copy for offline development; the attribution stays the same. `false` removes
Boundaries inherited from a parent map.

## Color areas from values in the style

`values` compiles rows into the style. Rows join by `id` (the registry ID), `ref` or `iso_3166_1`,
the keys the polygons carry. This example colors municipalities in the Community of Madrid by
their INE code, the code Spanish statistics publish:

<!-- docs:check -->

```ts
import {boundaryChoropleth, choroplethScale, defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

// Rows as a statistics office publishes them: an INE municipality code and a rate.
const unemployment = [
  {ine: '28079', rate: 9.8},
  {ine: '28005', rate: 12.4},
  {ine: '28006', rate: 6.1},
  {ine: '28058', rate: 13.7},
];

export default defineMap({
  id: 'madrid-unemployment',
  version: 1,
  extends: streets,
  boundaryAreas: {family: 'boundaries'},
  overlays: {
    unemployment: boundaryChoropleth({
      id: 'unemployment',
      classes: ['municipality'],
      countries: ['ES'],
      scale: choroplethScale.step('#fef0d9', [
        [8, '#fdcc8a'],
        [10, '#fc8d59'],
        [12, '#d7301f'],
      ]),
      missingColor: '#d9d9d9',
      outline: {color: '#ffffff', width: 0.75},
      values: {
        joinBy: 'ref',
        rows: unemployment.map(({ine, rate}) => ({key: `ES:INE:${ine}`, value: rate})),
      },
    }),
  },
});
```

Municipalities under 8 % are pale, those from 12 % dark red, and municipalities without a row
gray. The overlay adds the layers `unemployment-fill` and `unemployment-outline` below the
basemap's labels. Their minimum zoom defaults to the first zoom of the selected classes, here 8.

A choropleth accepts these options:

- `classes` (required), `tiers` and `countries` filter the areas;
- `minzoom` and `maxzoom` limit the zooms;
- `scale` sets the colors, `missingColor` the color of areas without a value (transparent by
  default) and `opacity` the fill opacity (0.8 by default);
- `outline` draws the boundary lines;
- `placement` positions the layers among the basemap's like any overlay (`below-labels` by
  default).

## Choose a color scale

`choroplethScale` builds validated scales:

- `step(base, stops)`: `base` below the first threshold, then one color from each threshold on;
- `linear(stops)`: colors interpolated between stops and clamped beyond them;
- `categories({value: color})`: one color per string value.

Stops are `[value, color]` pairs in increasing order, at most 64. A numeric scale gives
`missingColor` to any area whose value is not a number; a category scale gives it to unknown
categories. `choroplethColorExpression(scale, input, missingColor)` returns the same MapLibre
expression for any input, for use in layers of your own.

## Update values at run time with feature-state

Omit `values` and the choropleth reads the feature-state key `value` (or `state`). Set it from the
application with `createBoundaryFeatureState` from `@tileflow/core/browser` and the map instance:

<!-- docs:check -->

```ts
import {createBoundaryFeatureState, type TileflowFeatureStateMap} from '@tileflow/core/browser';

// A MapLibre map, such as the one `<Map onLoad>` passes in React.
export function showRates(map: TileflowFeatureStateMap, rates: ReadonlyMap<number, number>) {
  const state = createBoundaryFeatureState(map);
  state.set({joinBy: 'id', rows: [...rates].map(([key, value]) => ({key, value}))});
  return state;
}
```

`set` replaces the previous values and removes those no longer present. Values survive a style
reload, such as a theme change: the controller sets them again once the source is back. `clear`
removes them, and `dispose` also stops following the map. `labels: true` also sets the values on
`boundary_label`, for labels styled by value.

Feature-state is keyed by the source's feature ID, the registry ID by default. To key it by
official code instead, declare `boundaryAreas: {family: 'boundaries', promoteId: 'ref'}` and set
rows with `joinBy: 'ref'`. A map that promotes `ref` cannot also join values by `id`; compilation
fails with `TF_BOUNDARY_CHOROPLETH_JOIN`.

In React, `useBoundaryFeatureState(map, values, options)` from `@tileflow/react` keeps
feature-state equal to `values`; see the
[React README](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react/README.md). In
React Native, the `Map` prop `boundaryFeatureState={{values, labels, state}}` does the same with
the same rows and options; see the
[React Native README](https://github.com/tileflow/tileflow-sdk/blob/main/packages/react-native/README.md).

## Join by codes the polygons do not carry

Rows keyed by `iso_3166_1` or `ref` need no table: the polygons carry both codes, and a map that
promotes `ref` can set feature-state by official code directly. Rows keyed by `iso_3166_2`, `nuts`
or `wikidata`, or keyed by `ref` while feature-state uses registry IDs, go through the release's
lookup table.

The table is split by class, one gzip CSV per class with one row per area of that class:
`boundaries-lookup-country.csv.gz`, `boundaries-lookup-region.csv.gz`, and so on for every class.
The Boundaries TileJSON lists their URLs under `tileflow.boundaries.lookup.classes`, by class, and
the description of the table under `tileflow.boundaries.lookup.manifest`. Fine classes cover many
areas worldwide, so join where the data is prepared, on a server or at build time, and send the
application the joined rows, keyed by `id` or `ref`. Parse a file with `parseBoundaryLookupCsv`;
`joinBoundaryRows` then re-keys the rows:

<!-- docs:check -->

```ts
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createBoundaryLookup, joinBoundaryRows, parseBoundaryLookupCsv} from '@tileflow/core';

// A downloaded `boundaries-lookup-region.csv.gz`, read where the data is prepared.
export async function regionsByNuts(lookupFile: string, rows: {nuts: string; value: number}[]) {
  const text = gunzipSync(await readFile(lookupFile)).toString('utf8');
  const lookup = createBoundaryLookup(parseBoundaryLookupCsv(text));
  const joined = joinBoundaryRows(
    rows.map(({nuts, value}) => ({key: nuts, value})),
    {joinBy: 'nuts', lookup, classes: ['region']},
  );
  if (joined.unmatched.length > 0) console.warn('Unmatched NUTS codes', joined.unmatched);
  return joined;
}
```

Rows from several classes join against one lookup built from the rows of each class file. Lookup
downloads are web delivery, counted like stored tiles; a native app does not download them.

The result has the same `{joinBy, rows}` shape that `values` and `set` accept, keyed by `id` or,
with `to: 'ref'`, by `ref`. It also lists the keys it could not use:

- `unmatched`: keys no area has;
- `ambiguous`: keys shared by more than one area, which are left out;
- `duplicates`: keys repeated in the rows, where the last row wins.

ISO 3166, NUTS and Wikidata codes are compared upper-cased; `ref` is compared as written, so a
customer's bare INE code needs its `ES:INE:` prefix.

## Limits

- Values compiled into the style grow it with every row. Use feature-state for large or changing
  data.
- The `boundaries-official` family, with one official source per country and level, is not yet
  available.
- Tile URLs and the lookup table do not establish redistribution rights beyond the ODbL.
