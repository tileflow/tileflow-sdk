import {field, renderPass, token, zoom} from '@tileflow/core';
import type {
  TileflowLineStyle,
  TileflowNamedRenderStack,
  TileflowRoadsModuleConfig,
} from '@tileflow/core';

export const streetsNetworkDayColors = {
  'roads.city.primary': '#B1C4CB',
  'roads.city.secondary': '#C3CFD3',
  'roads.city.tertiary': '#CCD6D9',
  'roads.city.minor': '#D2DADC',
  'roads.overview.major': '#8DB3C0',
  'roads.overview.majorClose': '#85A9B5',
  'roads.overview.casing': '#668D9A',
  'roads.overview.casingClose': '#658B97',
} as const;

// Retain authored ramp/one-way expressions and the exact z15+ street profile.
// Only widen intermediate overview stops, without changing the regional entry.
function overviewWidth(width: TileflowLineStyle['width'], local: boolean) {
  if (!width || typeof width !== 'object' || width.kind !== 'expression') {
    throw new Error('Expected an authored road-width expression');
  }
  const value = structuredClone(width.value) as unknown[];
  if (value[0] !== 'interpolate') throw new Error('Expected interpolated road widths');
  for (let i = 3; i < value.length; i += 2) {
    const factor =
      value[i] === 10
        ? 1.12
        : value[i] === 12
          ? local
            ? 1.125
            : 1.25
          : value[i] === 14
            ? 1.08
            : 1;
    if (factor !== 1) {
      const authored = value[i + 1];
      value[i + 1] = ['case', ['==', ['get', field('ramp')], 1], authored, ['*', authored, factor]];
    }
  }
  return {...width, value} as typeof width;
}

export function streetsOverviewRoads(roads: TileflowRoadsModuleConfig | undefined) {
  if (!roads) throw new Error('The Streets overview requires the roads module');
  const renderStack = 'renderStack' in roads ? (roads.renderStack as TileflowNamedRenderStack) : {};
  const classes = {...roads.classes};
  for (const name of ['motorway', 'trunk'] as const) {
    const road = classes[name]!;
    const color = zoom.linear([
      [3, token.color(`roads.${name}`)],
      [6, token.color('roads.overview.major')],
      [12, token.color('roads.overview.major')],
      [14, token.color('roads.overview.majorClose')],
      [14.25, token.color('roads.overview.majorClose')],
      [15, token.color(`roads.${name}`)],
    ]);
    classes[name] = {
      ...road,
      surface: {...road.surface, fill: {...road.surface!.fill, color}},
      bridge: {
        ...road.bridge,
        fill: {...road.bridge!.fill, color},
        casing: {
          ...road.bridge!.casing,
          color: zoom.linear([
            [12, token.color('roads.overview.casing')],
            [14, token.color('roads.overview.casingClose')],
            [14.25, token.color('roads.overview.casingClose')],
            [15, token.color('roads.detail.casing')],
          ]),
        },
      },
    };
  }
  for (const name of ['primary', 'secondary', 'tertiary', 'minor'] as const) {
    const road = classes[name]!;
    const local = name === 'minor';
    classes[name] = {...road};
    for (const structure of ['surface', 'bridge', 'tunnel'] as const) {
      const base = road[structure]!;
      classes[name]![structure] = {
        ...base,
        fill: {
          ...base.fill,
          width: overviewWidth(base.fill!.width, local),
          // The tile source first provides local geometry at z12. Make it readable
          // on arrival, then converge to the detailed opacity by z13.
          ...(local
            ? {
                opacity: zoom.linear([
                  [12, structure === 'tunnel' ? 0.55 : 0.8],
                  [13, structure === 'tunnel' ? 0.8 : 1],
                ]),
              }
            : {}),
        },
      };
    }
  }

  return {
    ...roads,
    classes,
    renderStack: {
      ...renderStack,
      overviewMajorCasing: renderPass({
        // Keep the casing below every road fill, including trunk and ramp fills.
        // Drawing it above those fills exposes round segment caps as small rings.
        placement: {below: 'roads.classes.minor.surface.casing'},
        feature: 'road',
        renderer: 'line',
        selector: {
          kind: 'all',
          selectors: [
            {kind: 'geometry', geometry: 'line'},
            {kind: 'in', field: 'class', values: ['motorway', 'trunk']},
            {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'tunnel'},
          ],
        },
        style: {
          minZoom: 6,
          maxZoom: 15,
          cap: 'round',
          join: 'round',
          color: zoom.linear([
            [12, token.color('roads.overview.casing')],
            [14, token.color('roads.overview.casingClose')],
            [14.25, token.color('roads.overview.casingClose')],
            [15, token.color('roads.detail.casing')],
          ]),
          gapWidth: roads.classes!.motorway!.surface!.fill!.width,
          width: zoom.linear([
            [6, 0.2],
            [8, 0.4],
            [10, 0.65],
            [12, 0.8],
            [14, 0.95],
            [15, 1.0203013481363996],
          ]),
          opacity: zoom.linear([
            [6, 0.3],
            [8, 0.8],
            [10, 1],
          ]),
        },
      }),
    },
  };
}
