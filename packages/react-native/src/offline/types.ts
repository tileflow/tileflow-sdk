import type {Position} from '../services/types';

// Offline regions as the native store reports them, after Mapbox's tile regions. Dates are
// milliseconds since the epoch.

type GeoJSONPositions = readonly Position[];

/** A GeoJSON geometry, as Mapbox's tile region load options take. Altitudes are not kept. */
export type OfflineGeoJSONGeometry =
  | {type: 'Point'; coordinates: Position}
  | {type: 'MultiPoint'; coordinates: GeoJSONPositions}
  | {type: 'LineString'; coordinates: GeoJSONPositions}
  | {type: 'MultiLineString'; coordinates: readonly GeoJSONPositions[]}
  /** The first ring is the outline and the others are holes; rings may be open or closed. */
  | {type: 'Polygon'; coordinates: readonly GeoJSONPositions[]}
  | {type: 'MultiPolygon'; coordinates: readonly (readonly GeoJSONPositions[])[]};

/**
 * The area of a region: a box (west greater than east crosses the antimeridian), a GeoJSON
 * geometry or collection, or the area within half of `width` meters of a line.
 */
export type OfflineGeometry =
  | {type: 'boundingBox'; west: number; south: number; east: number; north: number}
  | OfflineGeoJSONGeometry
  | {type: 'GeometryCollection'; geometries: readonly OfflineGeoJSONGeometry[]}
  | {type: 'corridor'; line: readonly Position[]; width: number};

export type OfflineTileSource = {
  /** The source's name in the style. */
  id: string;
  /** The tile URL template with `{z}`, `{x}` and `{y}`, exactly as the style requests tiles. */
  template: string;
  minZoom?: number;
  maxZoom: number;
};

export type OfflineContent =
  /** Themes of a Hosted Map, downloaded with the configured map credential. */
  | {type: 'hosted'; mapId: string; themes: readonly string[]}
  /** A map of a versioned manifest you serve, with the tiles of `sources` inside the region. */
  | {type: 'manifest'; url: string; map: string; sources: readonly OfflineTileSource[]};

export type OfflineNetworkRestriction = 'none' | 'disallowExpensive';

export type OfflineRegionLoadOptions = {
  geometry: OfflineGeometry;
  content: OfflineContent;
  /** 0 by default. */
  minZoom?: number;
  /** 15 by default. */
  maxZoom?: number;
  /** 12 by default; 13 or 14 hold most of a pack's bytes. */
  terrainMaxZoom?: number;
  networkRestriction?: OfflineNetworkRestriction;
  /** Application data kept with the region, such as a display name. */
  metadata?: Readonly<Record<string, string>>;
};

export type OfflineRegionDownloadState =
  'downloading' | 'waiting' | 'paused' | 'failed' | 'complete';

export type OfflineRegionUpdateState =
  | {type: 'current'}
  | {type: 'updateAvailable'}
  /** Access ended for the service's reason, such as `credential_revoked` or `map_unavailable`. */
  | {type: 'notUpdatable'; reason: string};

export type OfflineRegionExpiryState =
  {type: 'valid'} | {type: 'gracePeriod'; endsAt: number} | {type: 'expired'};

/** A native offline error: `code` is one of `TileflowOfflineError.Code`, such as `network` or `deviceLimitExceeded`. */
export type OfflineErrorInfo = {
  code: string;
  /** The store continues by itself, or trying again can succeed without other changes. */
  recoverable: boolean;
  reason?: string;
  status?: number;
  limit?: number;
  /** Milliseconds to wait, when the service asked for it. */
  retryAfter?: number;
};

export type OfflineRegion = {
  id: string;
  options: OfflineRegionLoadOptions;
  state: OfflineRegionDownloadState;
  /** A complete version is stored and maps use it without a network. */
  isAvailable: boolean;
  requiredPackCount: number;
  completedPackCount: number;
  requiredResourceCount: number;
  completedResourceCount: number;
  /** Absent for self-hosted content, whose sizes are unknown until downloaded. */
  requiredResourceBytes?: number;
  completedResourceBytes: number;
  loadedResourceCount: number;
  loadedResourceBytes: number;
  billableResourceCount: number;
  error?: OfflineErrorInfo;
  retryDate?: number;
  completedAt?: number;
  updateState?: OfflineRegionUpdateState;
  checkedAt?: number;
  expiresAt?: number;
  expiryState?: OfflineRegionExpiryState;
};

/** What downloading a region costs, after Mapbox's tile region estimates. */
export type OfflineRegionEstimate = {
  packCount: number;
  /** Every resource, including free public ones. Self-hosted estimates count tiles only. */
  resourceCount: number;
  /** Resources counted toward map views and the plan's limits. */
  billableResourceCount: number;
  publicResourceCount: number;
  /** Exact bytes for Hosted content; absent when sizes are unknown. */
  bytes?: number;
  /** Tiles per source. */
  tileCounts: Record<string, number>;
  /** Map views the download is billed. */
  mapViews: number;
};

/**
 * Why downloads run differently than an app expects; downloads continue. iOS reports
 * `backgroundTransferUnavailable` once when the system's background transfer service never starts
 * a download, as in unsigned builds: downloads then run in the foreground and stop while the app is
 * suspended.
 */
export type OfflineWarningCode = 'backgroundTransferUnavailable';

export type OfflineRegionEvent =
  | {type: 'changed'; region: OfflineRegion}
  | {type: 'removed'; id: string}
  /** A developer-facing warning in English, reported once; not for display to people. */
  | {type: 'warning'; code: OfflineWarningCode; message: string};
