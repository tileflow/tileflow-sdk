import type {TileflowBuildings3DDesign} from '../buildings-3d-design';
import type {ResolvedTileflowMap} from '../maps';
import {resolveLabels} from '../modules/labels';
import {resolveRoads} from '../modules/roads';
import type {TileflowThemeColorDecision} from '../themes';
import type {TileflowCompilationDesignDecision} from './compilation-report';
import type {TileflowResolvedSemanticModules} from './domain-registry';

/** Read the same resolved values used by compilation; never duplicate renderer defaults. */
export function describeTileflowDesignDecisions(input: {
  map: ResolvedTileflowMap;
  modules: TileflowResolvedSemanticModules;
  theme: string;
  colors: readonly TileflowThemeColorDecision[];
  buildings?: TileflowBuildings3DDesign;
}): TileflowCompilationDesignDecision[] {
  const {map, modules, theme, buildings} = input;
  const decisions: TileflowCompilationDesignDecision[] = input.colors.map(
    ({role, source, value}) => ({
      path: `themes.${theme}.tokens.color.${role}`,
      source,
      value,
      reason:
        source === 'theme'
          ? 'The selected theme defines this role, including any authored token expression.'
          : 'The compiler derives this optional role from the selected theme color roles.',
      override: `Set tokens.color[${JSON.stringify(role)}] in defineTheme(); an explicit role replaces this derivation.`,
    }),
  );
  const policy = (
    domain: 'roads' | 'labels' | 'buildings',
    key: string,
    value: unknown,
    reason: string,
  ) => {
    const path = `modules.${domain}.${key}`;
    const authored = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        map.modules?.[domain],
      );
    decisions.push({
      path,
      value,
      source: authored === undefined ? 'default' : 'map',
      reason,
      override: `Set ${path} with ${domain}(...) or refine(...); reset() restores the SDK default. Render-stack refinements apply after module policies.`,
    });
  };
  if (modules.roads.enabled !== false) {
    const roads = resolveRoads(modules.roads);
    policy(
      'roads',
      'rampOrder',
      roads.rampOrder,
      'Below-roads draws ramp fills before receiving carriageways; by-class keeps each fill with its road class.',
    );
    policy(
      'roads',
      'detail',
      roads.detail,
      'Road detail selects the initial classes; explicit class settings and disabled classes refine that selection.',
    );
  }
  if (modules.labels.enabled !== false) {
    const labels = resolveLabels(modules.labels);
    policy(
      'labels',
      'roadPlacement',
      labels.roadPlacement,
      'Ground names draw below buildings and yield in collisions to foreground symbols; foreground names draw above buildings.',
    );
    policy(
      'labels',
      'collisionPriority',
      labels.collisionPriority,
      'Navigation prioritizes structural road classes within their drawing stack; it does not decouple collision priority from depth.',
    );
  }
  if (buildings) {
    policy(
      'buildings',
      'threeDimensional.edgeRadius',
      buildings.edgeRadius,
      'Radius in metres rounds building corners; zero retains sharp corners.',
    );
    policy(
      'buildings',
      'threeDimensional.lighting',
      buildings.lighting,
      'Sun lighting shares scene illumination; style lighting uses the alternate building shading mode.',
    );
    policy(
      'buildings',
      'threeDimensional.shadows',
      buildings.shadows,
      'Cast shadows follow scene light; false disables them independently of contact occlusion.',
    );
    policy(
      'buildings',
      'threeDimensional.occlusion',
      buildings.occlusion,
      'Contact occlusion separates buildings from the ground and shades lower walls; false disables it independently.',
    );
  }
  return decisions;
}
