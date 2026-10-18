import type {TileflowBoundaryValues} from './join';
import {
  isTileflowBoundaryFamily,
  tileflowBoundaryAreasV1Schema,
  tileflowBoundaryFamilies,
  type TileflowBoundaryFamily,
} from './schema';

type FeatureTarget = {id?: number | string; source: string; sourceLayer?: string};

/** The part of a MapLibre map the controller uses. */
export type TileflowFeatureStateMap = {
  getSource(id: string): unknown;
  getStyle?(): {sources?: Record<string, unknown>} | undefined;
  off(type: 'styledata', listener: () => void): unknown;
  on(type: 'styledata', listener: () => void): unknown;
  removeFeatureState(target: FeatureTarget, key?: string): void;
  setFeatureState(
    target: FeatureTarget & {id: number | string},
    state: Record<string, unknown>,
  ): void;
};

export type CreateBoundaryFeatureStateOptions = Readonly<{
  /** Defaults to `boundaries`. */
  family?: TileflowBoundaryFamily;
  /** Also set the values on `boundary_label` points, for labels styled by value. */
  labels?: boolean;
  /** Feature-state key; it must match the choropleth's `state`. Defaults to `value`. */
  state?: string;
}>;

export type TileflowBoundaryFeatureState = Readonly<{
  /** Remove every value this controller set. */
  clear: () => void;
  /** Remove the values and stop following style reloads. */
  dispose: () => void;
  /**
   * Replace the values. Rows must be keyed by the source's feature ID: `id` by default, or `ref`
   * when the map declares `promoteId: 'ref'`. Rows with a `null` value are removed.
   */
  set: (values: TileflowBoundaryValues) => void;
}>;

/**
 * Keep Boundaries feature-state in sync with application rows. Values survive a style reload: the
 * controller sets them again once the source is back.
 */
export function createBoundaryFeatureState(
  map: TileflowFeatureStateMap,
  options: CreateBoundaryFeatureStateOptions = {},
): TileflowBoundaryFeatureState {
  const family = options.family ?? 'boundaries';
  if (!isTileflowBoundaryFamily(family)) {
    throw new Error(`Unknown Tileflow Boundaries family: ${String(family)}.`);
  }
  const source = tileflowBoundaryFamilies[family].sourceId;
  const stateKey = options.state?.trim() || 'value';
  const sourceLayers = [
    tileflowBoundaryAreasV1Schema.layers.areas,
    ...(options.labels ? [tileflowBoundaryAreasV1Schema.layers.labels] : []),
  ];
  let applied = new Map<number | string, number | string>();
  let disposed = false;

  const write = (id: number | string, value: number | string) => {
    for (const sourceLayer of sourceLayers) {
      map.setFeatureState({id, source, sourceLayer}, {[stateKey]: value});
    }
  };
  const erase = (id: number | string) => {
    for (const sourceLayer of sourceLayers) {
      map.removeFeatureState({id, source, sourceLayer}, stateKey);
    }
  };
  const sourceReady = () => map.getSource(source) !== undefined;

  // A style reload drops the source and its feature-state; set the values again once it returns.
  let pendingReload = false;
  const onStyleData = () => {
    if (!sourceReady()) {
      pendingReload = true;
      return;
    }
    if (!pendingReload) return;
    pendingReload = false;
    for (const [id, value] of applied) write(id, value);
  };
  map.on('styledata', onStyleData);

  const assertOpen = () => {
    if (disposed) throw new Error('This Boundaries feature-state controller was disposed.');
  };

  return Object.freeze({
    clear() {
      assertOpen();
      if (sourceReady()) for (const id of applied.keys()) erase(id);
      applied = new Map();
    },
    dispose() {
      if (disposed) return;
      if (sourceReady()) for (const id of applied.keys()) erase(id);
      applied = new Map();
      map.off('styledata', onStyleData);
      disposed = true;
    },
    set(values) {
      assertOpen();
      const featureKey = promotedKey(map, source) ?? 'id';
      if (values.joinBy !== featureKey) {
        throw new Error(
          `Boundaries feature-state is keyed by ${featureKey}; join the rows to ${featureKey} first with joinBoundaryRows.`,
        );
      }
      const next = new Map<number | string, number | string>();
      for (const row of values.rows) {
        if (row.value === null) continue;
        if (featureKey === 'id') {
          if (typeof row.key !== 'number' || !Number.isSafeInteger(row.key) || row.key < 0) {
            throw new Error('Boundaries feature-state rows keyed by id need integer keys.');
          }
        } else if (typeof row.key !== 'string' || !row.key) {
          throw new Error('Boundaries feature-state rows keyed by ref need string keys.');
        }
        next.set(row.key, row.value);
      }
      if (sourceReady()) {
        for (const id of applied.keys()) if (!next.has(id)) erase(id);
        for (const [id, value] of next) if (applied.get(id) !== value) write(id, value);
      } else {
        pendingReload = true;
      }
      applied = next;
    },
  });
}

function promotedKey(map: TileflowFeatureStateMap, source: string): 'id' | 'ref' | undefined {
  const definition = map.getStyle?.()?.sources?.[source] as {promoteId?: unknown} | undefined;
  const promoteId = definition?.promoteId;
  if (promoteId === undefined) return undefined;
  const value =
    typeof promoteId === 'string'
      ? promoteId
      : (promoteId as Record<string, unknown>)[tileflowBoundaryAreasV1Schema.layers.areas];
  return value === 'ref' ? 'ref' : undefined;
}
