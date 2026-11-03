import type {TileflowRoadClass} from '../../types';

export const tileflowPathRoadClasses = [
  'pathway',
  'footway',
  'cycleway',
  'steps',
  'pedestrian',
] as const satisfies readonly TileflowRoadClass[];

export const tileflowRoadClasses = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  ...tileflowPathRoadClasses,
] as const satisfies readonly TileflowRoadClass[];

const pathTypes: Record<(typeof tileflowPathRoadClasses)[number], readonly string[]> = {
  pathway: ['path', 'bridleway', 'corridor'],
  footway: ['footway'],
  cycleway: ['cycleway'],
  steps: ['steps'],
  pedestrian: ['pedestrian'],
};

// The road classes of World that draw as each Tileflow road class. World's vocabulary is larger:
// busways draw as service roads and raceways as tracks.
const roadClassValues: Record<TileflowRoadClass, readonly string[]> = {
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
};

// A road under construction has `class: construction` and the road it becomes as its `type`:
// a World class, or the OpenStreetMap value of its `construction` tag.
const constructionTypes: Record<TileflowRoadClass, readonly string[]> = {
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
};

/** World's class of roads under construction. */
export const tileflowRoadConstructionClasses = ['construction'] as const;

export function isTileflowPathRoadClass(
  roadClass: TileflowRoadClass,
): roadClass is (typeof tileflowPathRoadClasses)[number] {
  return (tileflowPathRoadClasses as readonly TileflowRoadClass[]).includes(roadClass);
}

export function tileflowRoadClassFilter(
  fields: {class: string; type: string},
  roadClass: TileflowRoadClass,
): unknown[] {
  const built =
    isTileflowPathRoadClass(roadClass) && roadClass !== 'pedestrian'
      ? [
          'all',
          ['==', ['get', fields.class], 'path'],
          ['match', ['get', fields.type], pathTypes[roadClass], true, false],
        ]
      : ['match', ['get', fields.class], roadClassValues[roadClass], true, false];
  return [
    'any',
    built,
    [
      'all',
      ['==', ['get', fields.class], 'construction'],
      ['match', ['get', fields.type], constructionTypes[roadClass], true, false],
    ],
  ];
}

/** A kind of feature a road class draws: its `class`, and the `type`s it can have when known. */
export type TileflowRoadKind = Readonly<{class: string; types?: readonly string[]}>;

/** Every kind of feature a road class draws: roads in service, and roads being built as it. */
export function tileflowRoadKinds(roadClass: TileflowRoadClass): TileflowRoadKind[] {
  const inService =
    isTileflowPathRoadClass(roadClass) && roadClass !== 'pedestrian'
      ? [{class: 'path', types: pathTypes[roadClass]}]
      : roadClassValues[roadClass].map((value) => ({class: value}));
  return [...inService, {class: 'construction', types: constructionTypes[roadClass]}];
}
