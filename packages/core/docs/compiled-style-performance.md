# Compiled-style performance

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

The semantic compiler resolves semantic modules and their owned contributions first, then compacts equivalent
physical MapLibre layers. At high-detail zooms, road classes become a small set of data-driven
cohorts; equivalent road labels and tunnel hatches share compatible buckets; and land-cover,
land-use, and waterway classes share compatible buckets. Compaction selects
cohorts from compiler-owned semantic targets, not by parsing physical IDs; its temporary
owner/slot/target provenance is stripped from the public Style JSON.

After physical planning, Core embeds a bounded private `tileflow:interaction-manifest` lookup for the
final POI representations. `@tileflow/interactions/maplibre` validates and consumes that metadata
so applications can bind to `domain: 'poi'` without depending on physical layer IDs. The lookup is
paired atomically with the exact style it describes; it is not a public style-authoring API.

Use the exported structural sweep to enforce budgets without loading tiles or a browser:

```ts
import {analyzeTileflowStylePerformance, createStyle} from '@tileflow/core';
import map from './tileflow.config';

const report = analyzeTileflowStylePerformance(createStyle(map));
console.log(report.zooms[16]);
```

The report covers z0–z22 by default and includes active layers, conservative bucket estimates,
symbols, and active layers per source-layer. It is intended for regression gates; browser traces
remain the source of truth for decode, upload, placement, and frame time.

A `SymbolStyle` root zoom range governs its text/icon layer and is inherited by its marker layer.
Because a marker is materialized as a separate circle layer, an explicit marker range may refine
that inherited default. Text and icon ranges must agree because MapLibre renders them together.

The road module distinguishes the path family semantically:

```ts
roads({
  extras: {paths: true},
  crossings: {image: token.image('roads.crosswalk')},
  sidewalks: {
    surface: {color: token.color('roads.city.casing'), minZoom: 17},
    pattern: {
      pattern: token.image('roads.sidewalkPattern'),
      minZoom: 17,
      opacity: fixed(0.6, {reason: 'Sidewalk texture strength is invariant'}),
    },
  },
  roundabouts: {
    casing: {strokeColor: token.color('roads.default.casing')},
    fill: {strokeColor: token.color('roads.default')},
  },
  areas: {
    pedestrian: {
      fill: {color: token.color('surface.land')},
      outline: {
        color: token.color('roads.default.casing'),
        width: fixed(1, {reason: 'Pedestrian-area outline weight is invariant'}),
      },
    },
  },
  classes: {
    primary: {
      tunnel: {
        casing: {
          color: token.color('roads.city.tunnelCasing'),
          width: fixed(10, {reason: 'Primary-tunnel hierarchy is invariant'}),
        },
        fill: {
          color: token.color('roads.city.tunnel'),
          width: fixed(8, {reason: 'Primary-tunnel hierarchy is invariant'}),
        },
        hatch: {
          color: token.color('roads.city.tunnelCasing'),
          opacity: fixed(0.25, {reason: 'Tunnel hatch strength is invariant'}),
          spacing: fixed(10, {reason: 'Tunnel hatch rhythm is invariant'}),
        },
      },
    },
    pedestrian: {
      surface: {
        fill: {
          color: token.color('roads.path.transition'),
          width: fixed(6, {reason: 'Pedestrian-road hierarchy is invariant'}),
        },
      },
    },
    footway: {
      surface: {
        fill: {
          color: token.color('roads.path'),
          width: fixed(1.2, {reason: 'Path hierarchy is invariant'}),
        },
      },
    },
    cycleway: {
      surface: {
        fill: {
          color: token.color('roads.cycleway'),
          width: fixed(1.5, {reason: 'Cycleway hierarchy is invariant'}),
        },
      },
    },
    steps: {
      surface: {
        fill: {
          color: token.color('roads.path.casing'),
          width: fixed(1.4, {reason: 'Step hierarchy is invariant'}),
        },
      },
    },
    pathway: {
      surface: {
        fill: {
          color: token.color('roads.path'),
          width: fixed(1.2, {reason: 'Path hierarchy is invariant'}),
        },
      },
    },
  },
  modifiers: {
    expressway: {widthScale: 1.06},
    ramp: {widthScale: 0.7},
    unpaved: {surface: {fill: {color: token.color('roads.path')}}},
    construction: {
      surface: {
        fill: {opacity: fixed(0.7, {reason: 'Construction emphasis is invariant'})},
      },
    },
    indoor: {
      surface: {fill: {opacity: fixed(0.4, {reason: 'Indoor-road emphasis is invariant'})}},
    },
  },
  restrictions: {
    access: {
      surface: {fill: {opacity: fixed(0.55, {reason: 'Restricted-road emphasis is invariant'})}},
    },
    toll: {
      surface: {
        casing: {color: fixed('#C5B7D8', {reason: 'Toll ink is regulatory and invariant'})},
      },
    },
  },
  serviceTypes: {
    driveway: {widthScale: 0.75},
    parkingAisle: {widthScale: 0.6},
  },
});
```

These targets are non-overlapping translations of the OpenMapTiles road class and subclass. The
same names are available under `labels().roadClasses` and `labels().styles.roads`. Surface, tunnel,
and bridge phases can be controlled independently for each target; each structure has
`shadow`/`casing`/`fill` and an optional `hatch`. Glyph hatch marks inherit the resolved fill width
when `size` is omitted and never participate in label collision. Setting `hatch.pattern` instead
emits a repeated sprite texture clipped to the resolved fill width. No raw source filter or generated
layer ID is needed. `hatch.patternWidths` can list intrinsic sprite heights named
`${pattern}-${width}`; the compiler selects the nearest height from the resolved road width so the
texture's marks remain approximately constant in screen pixels across classes, ramps, and zooms.

`classes.pedestrian` styles line-like pedestrian ways. Polygon pedestrian plazas are a distinct
geometry and use `areas.pedestrian`, including optional fill opacity, outline color, or sprite
pattern. This prevents plazas from degrading into a thin polygon outline.

Road treatments refine a class without creating another class or exposing source fields.
`construction`, `expressway`, `indoor`, `official`, `ramp`, and `unpaved` live under `modifiers`;
general, bicycle, foot, horse, and toll restrictions live under `restrictions`; `alley`,
`crossover`, `driveway`, `parkingAisle`, and `yard` live under `serviceTypes`; and exact
mountain-bike difficulty values live under `mountainBike`. Treatments reuse
surface/tunnel/bridge and casing/fill/shadow paint controls, plus a relative `widthScale`. The
compiler emits feature-driven paint expressions inside the existing stable class layers rather
than multiplying every possible combination.

Road names, shields, and motorway junctions remain label concerns:

```ts
labels({
  roads: 'all',
  shields: 'major',
  junctions: true,
  styles: {
    shields: {
      default: {
        icon: {
          image: token.image('roads.shield.rectangleNeutral'),
          optional: false,
          pitchAlignment: 'viewport',
          rotationAlignment: 'viewport',
          textFit: 'width',
          textFitPadding: [0, 4, 0, 4],
        },
        text: {
          color: token.color('labels.shieldDark'),
          font: token.font('places'),
          optional: false,
          pitchAlignment: 'viewport',
          rotationAlignment: 'viewport',
        },
      },
      overview: {minZoom: 6, maxZoom: 11, placement: 'point'},
      detail: {minZoom: 11, placement: 'line', spacing: 400},
      kinds: {
        'rectangle-neutral': {image: token.image('roads.shield.rectangleNeutral')},
        'rectangle-blue': {image: token.image('roads.shield.rectangleBlue')},
      },
      textColors: {
        dark: {color: token.color('labels.shieldDark')},
        light: {color: token.color('labels.shieldLight')},
      },
    },
    junctions: {
      text: {
        color: token.color('labels.strong'),
        haloColor: token.color('labels.halo'),
        haloWidth: fixed(2, {reason: 'Junction halo weight is invariant'}),
      },
    },
  },
});
```

`icon.textFit` and `icon.textFitPadding` let a symbol background grow with its text. Setting both
icon and text `optional: false` keeps a route shield atomic during collision placement: neither an
empty badge nor a detached reference can render alone. `overview` renders producer-selected points
at low zoom and `detail` switches to line placement at street zooms; exclusive `maxZoom: 11` and
inclusive `minZoom: 11` make that handoff atomic. Keeping both icon and text aligned to `viewport`
makes the badge horizontal regardless of road bearing.

`kinds` and `textColors` are closed presentation tables. The vector producer supplies semantic
`shield_kind`, `shield_text_color`, `shield_text`, and `shield_rank` values; Core only matches them
against the authored tables and falls back to `default`. Country, route-prefix, and network-shape
rules therefore stay in the data authority instead of leaking into a map theme or multiplying
runtime layers.

Tileflow World owns POI classification, editorial zoom eligibility, and cross-source ranking. Its
canonical `poi` layer exposes `category`, `type`, `icon`, `min_zoom`, `filter_rank`, and `size_rank`;
Core validates that complete contract and never reconstructs those decisions from OpenMapTiles
`class`, `subclass`, or `rank`. `filter_rank` is an
integer from 0 through 5, with lower values reserved for the strongest candidates. The numeric
`density` option is an inclusive threshold from 1 through 5 and defaults to 3. `size_rank` is an
integer from 0 through 16 used to order eligible candidates before MapLibre performs final
collision placement.

The closed category vocabulary is `arts-entertainment`, `education`, `food-drink`, `landmark`,
`lodging`, `medical`, `park-nature`, `public-services`, `religion`, `retail`, `sport-leisure`,
`transport`, and `visitor-amenity`. Producer `type` and `icon` values use stable snake_case names.
When an `icon` sprite exists it is used directly; an unknown or absent icon safely falls back to the
category's themed image role. `labels` and `icons` are booleans. Category styles control only
presentation and may hide or delay candidates, never promote them above the producer's selection.
`placement.coupleIconAndLabel` keeps a POI's icon and label atomic during collision placement.

```ts
poi({
  categories: ['food-drink', 'landmark', 'transport'],
  density: 3,
  icons: true,
  labels: true,
});
```

The same contract drives regular POI layers, custom HUD treatments, semantic interactions, and
feature inspection. There is intentionally no compatibility path for the former class mapping,
rank ceilings, or named density/detail presets.
