import type {
  TileflowLabelDetail,
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowLabelsModuleOptions,
  TileflowRoadClass,
  TileflowRoadLabelDetail,
} from '../../types';
import {type ResolvedRoadsModuleOptions, roadClassesForDetail} from '../roads';

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
  const visibleGeometry = new Set(roadClassesForDetail(roads.detail));
  if (roads.extras.paths) visibleGeometry.add('path');
  const eligible = new Set(roadClassesForDetail(detail));
  if (detail === 'all' && roads.extras.paths) eligible.add('path');
  const explicit = explicitClasses ? new Set(explicitClasses) : undefined;
  return [...eligible].filter(
    (roadClass) =>
      visibleGeometry.has(roadClass) && (!explicit || explicit.has(roadClass as never)),
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
