import type {
  TileflowLabelDetail,
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowLabelsModuleOptions,
  TileflowRoadClass,
  TileflowRoadLabelDetail,
} from '../../types';
import {type ResolvedRoadsModuleOptions, roadClassesWithPaths, visibleRoadClasses} from '../roads';
import {tileflowRoadClasses} from '../roads/semantics';

export type ResolvedLabelsModuleOptions = {
  language: TileflowLabelLanguage;
  places: TileflowLabelDetail;
  roadClasses?: readonly TileflowRoadClass[];
  roads: TileflowRoadLabelDetail;
  water: TileflowLabelDetail;
};

const defaults = {
  language: 'auto',
  places: 'major',
  roads: 'major',
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
    places: request?.places ?? defaults.places,
    ...(request?.roadClasses ? {roadClasses: [...request.roadClasses]} : {}),
    roads: request?.roads ?? defaults.roads,
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
