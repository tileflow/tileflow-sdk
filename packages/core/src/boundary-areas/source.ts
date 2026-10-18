import {validatePublicVectorUrl} from '../data';
import {
  isTileflowBoundaryFamily,
  tileflowBoundaryAreasV1Schema,
  tileflowBoundaryFamilies,
  type TileflowBoundaryFamily,
} from './schema';

/**
 * Tileflow's Boundaries tileset as a map source. It is a separate product from World: World's
 * border lines belong to the `boundaries` module, while this source holds the areas themselves.
 */
export type TileflowBoundaryAreasConfig = Readonly<{
  /** The licensed family to draw. Its attribution is always shown with its layers. */
  family: TileflowBoundaryFamily;
  /**
   * The property MapLibre uses as feature ID for feature-state. By default it is the registry ID,
   * which survives releases; `ref` keys feature-state by official code instead.
   */
  promoteId?: 'ref';
  /**
   * A schema-compatible vector TileJSON or `pmtiles://` archive, such as a local copy for offline
   * development. Defaults to the family's TileJSON under the Tileflow API.
   */
  url?: string;
}>;

/** `false` removes Boundaries inherited from a parent map. */
export type TileflowBoundaryAreas = false | TileflowBoundaryAreasConfig;

export type TileflowBoundaryAreasSourceIdentity = Readonly<{
  family: TileflowBoundaryFamily;
  kind: 'tileflow-boundaries';
  product: typeof tileflowBoundaryAreasV1Schema.product;
  promoteId?: 'ref';
  schemaVersion: typeof tileflowBoundaryAreasV1Schema.schemaVersion;
  sourceId: string;
  url: string;
}>;

export type ResolvedBoundaryAreas = Readonly<{
  identity: TileflowBoundaryAreasSourceIdentity;
  source: Readonly<{
    attribution: string;
    promoteId?: Readonly<Record<string, string>>;
    type: 'vector';
    url: string;
  }>;
  sourceId: string;
}>;

/** Resolve a map's Boundaries declaration into its style source without fetching its TileJSON. */
export function resolveBoundaryAreas(
  config: TileflowBoundaryAreas | undefined,
  apiBaseUrl = 'https://api.tileflow.dev',
): ResolvedBoundaryAreas | undefined {
  if (config === undefined || config === false) return undefined;
  if (!isTileflowBoundaryFamily(config.family)) {
    throw new Error(
      `Unknown Tileflow Boundaries family: ${String(config.family)}. Expected one of: ${Object.keys(
        tileflowBoundaryFamilies,
      ).join(', ')}.`,
    );
  }
  if (config.promoteId !== undefined && config.promoteId !== 'ref') {
    throw new Error('Tileflow Boundaries promoteId must be "ref" when set.');
  }
  const family = tileflowBoundaryFamilies[config.family];
  const url = validatePublicVectorUrl(
    config.url ?? new URL(family.path, normalizeApiBaseUrl(apiBaseUrl)).toString(),
  );
  const {areas, labels} = tileflowBoundaryAreasV1Schema.layers;
  return Object.freeze({
    identity: Object.freeze({
      family: config.family,
      kind: 'tileflow-boundaries',
      product: tileflowBoundaryAreasV1Schema.product,
      ...(config.promoteId ? {promoteId: config.promoteId} : {}),
      schemaVersion: tileflowBoundaryAreasV1Schema.schemaVersion,
      sourceId: family.sourceId,
      url,
    }),
    source: Object.freeze({
      attribution: family.attribution,
      ...(config.promoteId
        ? {promoteId: Object.freeze({[areas]: config.promoteId, [labels]: config.promoteId})}
        : {}),
      type: 'vector',
      url,
    }),
    sourceId: family.sourceId,
  });
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error('Tileflow API base URL must not contain user information.');
  }
  return url.toString();
}
