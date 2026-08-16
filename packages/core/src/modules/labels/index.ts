import type {
  TileflowLabelDetail,
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowLabelsModuleOptions,
  TileflowRoadClass,
  TileflowRoadLabelDetail,
  TileflowRoadShieldDetail,
} from '../../types';
import {type ResolvedRoadsModuleOptions, roadClassesWithPaths, visibleRoadClasses} from '../roads';
import {tileflowRoadClasses} from '../roads/semantics';

export type ResolvedLabelsModuleOptions = {
  language: TileflowLabelLanguage;
  junctions: boolean;
  places: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads: TileflowRoadLabelDetail;
  shields: TileflowRoadShieldDetail;
  water: TileflowLabelDetail;
};

const defaults = {
  language: 'auto',
  junctions: true,
  places: 'major',
  roads: 'major',
  shields: 'major',
  water: 'major',
} as const satisfies ResolvedLabelsModuleOptions;

export function labels(options: TileflowLabelsModuleOptions = {}): TileflowLabelsModuleConfig {
  return {type: 'labels', ...cloneJson(options)};
}

export function resolveLabels(
  request: TileflowLabelsModuleConfig | undefined,
): ResolvedLabelsModuleOptions {
  return {
    language: request?.language ?? defaults.language,
    junctions: request?.junctions ?? defaults.junctions,
    places: request?.places ?? defaults.places,
    ...(request?.roadClasses ? {roadClasses: [...request.roadClasses]} : {}),
    roads: request?.roads ?? defaults.roads,
    shields: request?.shields ?? defaults.shields,
    water: request?.water ?? defaults.water,
  };
}

export function visibleRoadLabelClasses(
  detail: TileflowRoadLabelDetail,
  roads: ResolvedRoadsModuleOptions,
  explicitClasses?: readonly TileflowRoadClass[],
): string[] {
  const visibleGeometry = new Set(visibleRoadClasses(roads));
  const explicit = explicitClasses ? new Set(explicitClasses) : undefined;
  const eligible = explicit
    ? tileflowRoadClasses.filter((roadClass) => explicit.has(roadClass))
    : roadClassesWithPaths(detail, detail === 'all' && roads.extras.paths);
  return eligible.filter((roadClass) => visibleGeometry.has(roadClass));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
