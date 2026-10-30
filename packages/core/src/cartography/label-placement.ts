/** Shared paint-order tiers. MapLibre offers higher layers first for symbol collisions. */
export const labelOrder = {
  address: 100,
  road: 200,
  poi: 1000,
  majorRoad: 1100,
  navigationRoad: 1200,
  shield: 1250,
  place: 1300,
  prominentPoi: 1400,
} as const;

export const roadLabelPlacementKey = 'tileflow:road-label-placement';
export const groundRoadLabelMetadata = {[roadLabelPlacementKey]: {version: 1, mode: 'ground'}};

export function isGroundRoadLabel(layer: {metadata?: unknown}): boolean {
  const policy = (layer.metadata as Record<string, unknown> | undefined)?.[
    roadLabelPlacementKey
  ] as {version?: unknown; mode?: unknown} | undefined;
  return policy?.version === 1 && policy.mode === 'ground';
}
