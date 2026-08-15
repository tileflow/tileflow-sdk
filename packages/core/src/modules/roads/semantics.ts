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

const pathSubclasses: Record<(typeof tileflowPathRoadClasses)[number], readonly string[]> = {
  pathway: ['path', 'bridleway', 'corridor'],
  footway: ['footway'],
  cycleway: ['cycleway'],
  steps: ['steps'],
  pedestrian: ['pedestrian'],
};

const constructionClasses: Record<TileflowRoadClass, readonly string[]> = {
  motorway: ['motorway_construction'],
  trunk: ['trunk_construction'],
  primary: ['primary_construction'],
  secondary: ['secondary_construction'],
  tertiary: ['tertiary_construction'],
  minor: ['minor_construction'],
  service: ['service_construction'],
  track: ['track_construction'],
  pathway: ['path_construction'],
  footway: ['path_construction'],
  cycleway: ['path_construction'],
  steps: ['path_construction'],
  pedestrian: ['path_construction'],
};

export const tileflowRoadConstructionClasses = [
  ...new Set(Object.values(constructionClasses).flat()),
] as readonly string[];

export function isTileflowPathRoadClass(
  roadClass: TileflowRoadClass,
): roadClass is (typeof tileflowPathRoadClasses)[number] {
  return (tileflowPathRoadClasses as readonly TileflowRoadClass[]).includes(roadClass);
}

export function tileflowRoadClassFilter(
  fields: {class: string; subclass: string},
  roadClass: TileflowRoadClass,
): unknown[] {
  if (isTileflowPathRoadClass(roadClass)) {
    return [
      'all',
      ['match', ['get', fields.class], ['path', ...constructionClasses[roadClass]], true, false],
      ['match', ['get', fields.subclass], pathSubclasses[roadClass], true, false],
    ];
  }

  const classes =
    roadClass === 'minor'
      ? ['minor', 'residential', 'unclassified', ...constructionClasses[roadClass]]
      : roadClass === 'service'
        ? ['service', ...constructionClasses[roadClass]]
        : [roadClass, ...constructionClasses[roadClass]];
  return ['match', ['get', fields.class], classes, true, false];
}
