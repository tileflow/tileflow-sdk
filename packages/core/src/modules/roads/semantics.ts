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
      ['==', ['get', fields.class], 'path'],
      ['match', ['get', fields.subclass], pathSubclasses[roadClass], true, false],
    ];
  }

  const classes =
    roadClass === 'minor'
      ? ['minor', 'residential', 'unclassified']
      : roadClass === 'service'
        ? ['service']
        : [roadClass];
  return ['match', ['get', fields.class], classes, true, false];
}
