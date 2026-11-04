import type {TileflowRenderSelector, TileflowRoadClass} from '@tileflow/core';

/** World's road `class` for the roads in service each Tileflow road class draws. */
export const worldRoadClasses = {
  motorway: ['motorway'],
  trunk: ['trunk'],
  primary: ['primary'],
  secondary: ['secondary'],
  tertiary: ['tertiary'],
  minor: ['street'],
  service: ['service', 'busway'],
  track: ['track', 'raceway'],
  pathway: ['path'],
  footway: ['path'],
  cycleway: ['path'],
  steps: ['path'],
  pedestrian: ['pedestrian'],
} as const satisfies Record<TileflowRoadClass, readonly string[]>;

/**
 * The `type` of a World road under construction (`class: construction`) that becomes each Tileflow
 * road class: World's class of the finished road, or the OSM value of its `construction` tag.
 */
export const worldConstructionTypes = {
  motorway: ['motorway', 'motorway_link'],
  trunk: ['trunk', 'trunk_link'],
  primary: ['primary', 'primary_link'],
  secondary: ['secondary', 'secondary_link'],
  tertiary: ['tertiary', 'tertiary_link'],
  minor: ['street', 'residential', 'unclassified', 'living_street', 'road'],
  service: ['service', 'busway'],
  track: ['track', 'raceway'],
  pathway: ['path', 'bridleway', 'corridor'],
  footway: ['footway'],
  cycleway: ['cycleway'],
  steps: ['steps'],
  pedestrian: ['pedestrian'],
} as const satisfies Record<TileflowRoadClass, readonly string[]>;

/** Roads under construction that become one of these road classes. */
export function worldConstructionSelector(
  ...roadClasses: readonly TileflowRoadClass[]
): TileflowRenderSelector {
  return {
    kind: 'all',
    selectors: [
      {kind: 'compare', field: 'class', operator: 'eq', value: 'construction'},
      {
        kind: 'in',
        field: 'type',
        values: [...new Set(roadClasses.flatMap((roadClass) => worldConstructionTypes[roadClass]))],
      },
    ],
  };
}

/** Roads of these classes, in service or, with `construction`, being built. */
export function worldRoadSelector(
  roadClasses: readonly TileflowRoadClass[],
  options: {construction?: boolean} = {},
): TileflowRenderSelector {
  const inService: TileflowRenderSelector = {
    kind: 'in',
    field: 'class',
    values: [...new Set(roadClasses.flatMap((roadClass) => worldRoadClasses[roadClass]))],
  };
  return options.construction
    ? {kind: 'any', selectors: [inService, worldConstructionSelector(...roadClasses)]}
    : inService;
}
