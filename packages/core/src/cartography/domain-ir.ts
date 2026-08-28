import type {ResolvedTileflowData} from '../data';
import {
  createTileflowCompilerProvenance,
  readTileflowCompilerProvenance,
  tileflowCompilerProvenanceMetadataKey,
  type TileflowStyleInspectionContribution,
  type TileflowStyleInspectionRenderOperation,
} from './compiler-inspection';
import {
  tileflowCompilerMetadataKeys,
  type TileflowLayerContribution,
  type TileflowLayerSlot,
  type TileflowPhysicalFamilyDeclaration,
} from './contributions';
import type {TileflowCompiledDomains} from './domain-registry';
import type {TileflowLayerDomain} from './domains';
import type {TileflowCompiledRenderOperation} from './render-stack';
import {bindSemanticReferences} from './semantic-bindings';

export const tileflowDomainIRSchemaVersion = 2 as const;

export type TileflowLayerFeatureIR = Readonly<{
  dataLayer?: unknown;
  dataSource?: unknown;
}>;

export type TileflowLayerStyleIR = Readonly<{
  appearance?: Readonly<Record<string, unknown>>;
  placement?: Readonly<Record<string, unknown>>;
}>;

export type TileflowLayerRangeIR = Readonly<{
  maxZoom?: number;
  minZoom?: number;
}>;

/** A closed planner hint. Planning never infers families from IDs or targets. */
export type TileflowPhysicalFamilyIR = TileflowPhysicalFamilyDeclaration;

/** Renderer template shared by domain contributions and owner-local passes. */
export type TileflowLayerTemplateIR = Readonly<{
  annotations?: Readonly<Record<string, unknown>>;
  feature?: TileflowLayerFeatureIR;
  key: string;
  properties?: Readonly<Record<string, unknown>>;
  range?: TileflowLayerRangeIR;
  renderer: string;
  selector?: unknown;
  style: TileflowLayerStyleIR;
}>;

/**
 * Semantic layer-family IR consumed by assembly, render stacks, and the
 * physical planner. It deliberately has no MapLibre id/type/source-layer,
 * filter/paint/layout, or compiler-metadata carrier.
 */
export type TileflowLayerFamilyIR = TileflowLayerTemplateIR &
  Readonly<{
    family?: TileflowPhysicalFamilyIR;
    kind: 'tileflow-layer-family';
    order: number;
    origins: readonly TileflowStyleInspectionContribution[];
    owner: TileflowLayerDomain;
    slot: TileflowLayerSlot;
    target: string;
  }>;

export type TileflowLayerPatchIR = Readonly<{
  annotations?: Readonly<Record<string, unknown>>;
  feature?: TileflowLayerFeatureIR;
  properties?: Readonly<Record<string, unknown>>;
  range?: TileflowLayerRangeIR;
  selector?: unknown;
  style?: TileflowLayerStyleIR;
}>;

/** The compiler's pre-lowering boundary. No physical Style layer exists here. */
export type TileflowDomainIR = Readonly<{
  domains: TileflowCompiledDomains['domains'];
  families: readonly TileflowLayerFamilyIR[];
  kind: 'tileflow-domain-ir';
  renderOperations: readonly TileflowCompiledRenderOperation[];
  schemaVersion: typeof tileflowDomainIRSchemaVersion;
  semanticReferences: Readonly<{fields: number; layers: number; sources: number}>;
}>;

export type TileflowLoweredDomainIR = Readonly<{
  layers: readonly (Record<string, unknown> & {id: string; type: string})[];
}>;

export type TileflowPhysicalIdResolver = (semanticKey: string) => string;

export function createTileflowDomainIR(input: {
  readonly compiledDomains: TileflowCompiledDomains;
  readonly data: ResolvedTileflowData;
  readonly renderOperations: readonly TileflowCompiledRenderOperation[];
}): TileflowDomainIR {
  const families = input.compiledDomains.contributions.map(createTileflowLayerFamilyIR);
  for (const family of families) {
    if (
      family.feature?.dataSource === input.data.sourceId &&
      family.renderer !== 'background' &&
      !isSemanticLayerReference(family.feature.dataLayer)
    ) {
      throw new TileflowDomainIRError(
        'TILEFLOW_DOMAIN_IR_PHYSICAL_LAYER',
        `Domain target ${family.target} lowered its primary source layer too early.`,
        family.target,
      );
    }
  }

  const semanticReferences = {fields: 0, layers: 0, sources: 0};
  visitReferences([families, input.renderOperations], semanticReferences);
  return Object.freeze({
    domains: input.compiledDomains.domains,
    families: Object.freeze(families),
    kind: 'tileflow-domain-ir' as const,
    renderOperations: Object.freeze([...input.renderOperations]),
    schemaVersion: tileflowDomainIRSchemaVersion,
    semanticReferences: Object.freeze(semanticReferences),
  });
}

/** Convert the domain-compiler frontend value into the closed semantic IR. */
export function createTileflowLayerFamilyIR(
  contribution: TileflowLayerContribution,
): TileflowLayerFamilyIR {
  const template = createTileflowLayerTemplateIR(contribution.layer, contribution.target);
  const existingOrigins = readTileflowCompilerProvenance(contribution.layer);
  return Object.freeze({
    ...template,
    ...(contribution.family ? {family: cloneJson(contribution.family)} : {}),
    kind: 'tileflow-layer-family' as const,
    order: contribution.localOrder,
    origins: Object.freeze(
      existingOrigins.length > 0
        ? existingOrigins.map(cloneJson)
        : [
            ...createTileflowCompilerProvenance(
              contribution.owner,
              contribution.slot,
              contribution.target,
            ),
          ],
    ),
    owner: contribution.owner,
    slot: contribution.slot,
    target: contribution.target,
  });
}

/** Parse a renderer template without retaining physical Style keys. */
export function createTileflowLayerTemplateIR(
  layer: Record<string, unknown> & {id: string; type: string},
  semanticKey: string,
): TileflowLayerTemplateIR {
  const {
    filter,
    id,
    layout,
    maxzoom,
    metadata,
    minzoom,
    paint,
    source,
    'source-layer': sourceLayer,
    type,
    ...properties
  } = layer;
  if (typeof id !== 'string' || !id.trim()) {
    throw new TileflowDomainIRError(
      'TILEFLOW_DOMAIN_IR_INVALID_KEY',
      'Layer key must not be empty.',
    );
  }
  if (typeof semanticKey !== 'string' || !semanticKey.trim()) {
    throw new TileflowDomainIRError(
      'TILEFLOW_DOMAIN_IR_INVALID_SEMANTIC_KEY',
      'Semantic layer-family key must not be empty.',
    );
  }
  if (typeof type !== 'string' || !type.trim()) {
    throw new TileflowDomainIRError(
      'TILEFLOW_DOMAIN_IR_INVALID_RENDERER',
      `Layer family ${id} requires a renderer.`,
    );
  }
  const annotations = publicMetadata(metadata);
  const range: TileflowLayerRangeIR | undefined =
    minzoom !== undefined || maxzoom !== undefined
      ? {
          ...(maxzoom === undefined ? {} : {maxZoom: maxzoom as number}),
          ...(minzoom === undefined ? {} : {minZoom: minzoom as number}),
        }
      : undefined;
  return Object.freeze({
    ...(annotations ? {annotations: Object.freeze(annotations)} : {}),
    ...(source !== undefined || sourceLayer !== undefined
      ? {
          feature: Object.freeze({
            ...(source === undefined ? {} : {dataSource: source}),
            ...(sourceLayer === undefined ? {} : {dataLayer: sourceLayer}),
          }),
        }
      : {}),
    key: semanticKey,
    ...(Object.keys(properties).length > 0
      ? {properties: Object.freeze(cloneJson(properties))}
      : {}),
    ...(range ? {range: Object.freeze(range)} : {}),
    renderer: type,
    ...(filter === undefined ? {} : {selector: cloneJson(filter)}),
    style: Object.freeze({
      ...(isRecord(layout) ? {placement: Object.freeze(cloneJson(layout))} : {}),
      ...(isRecord(paint) ? {appearance: Object.freeze(cloneJson(paint))} : {}),
    }),
  });
}

export function materializeTileflowLayerFamilyIR(
  template: TileflowLayerTemplateIR,
  semantics: {
    readonly operations?: readonly TileflowStyleInspectionRenderOperation[];
    readonly order?: number;
    readonly owner: TileflowLayerDomain;
    readonly slot: TileflowLayerSlot;
    readonly target: string;
  },
): TileflowLayerFamilyIR {
  return Object.freeze({
    ...cloneJson(template),
    kind: 'tileflow-layer-family' as const,
    order: semantics.order ?? 0,
    origins: Object.freeze([
      {
        operations: Object.freeze([...(semantics.operations ?? [])].map(cloneJson)),
        owner: semantics.owner,
        slot: semantics.slot,
        target: semantics.target,
      },
    ]),
    owner: semantics.owner,
    slot: semantics.slot,
    target: semantics.target,
  });
}

/** The sole MapLibre emission and semantic-data binding boundary. */
export function lowerTileflowDomainIR(
  families: readonly TileflowLayerFamilyIR[],
  data: ResolvedTileflowData,
  resolvePhysicalId: TileflowPhysicalIdResolver = physicalLayerIdForSemanticKey,
): TileflowLoweredDomainIR {
  const layers = families.map((family) =>
    bindSemanticReferences(emitLayer(family, resolvePhysicalId), data),
  );
  assertNoSemanticReferences(layers);
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) {
      throw new TileflowDomainIRError(
        'TILEFLOW_DOMAIN_IR_DUPLICATE_PHYSICAL_ID',
        `Final lowering generated duplicate physical layer ID: ${layer.id}.`,
      );
    }
    ids.add(layer.id);
  }
  return Object.freeze({layers: Object.freeze(layers)});
}

export class TileflowDomainIRError extends Error {
  readonly code: string;
  readonly target?: string;

  constructor(code: string, message: string, target?: string) {
    super(message);
    this.code = code;
    this.name = 'TileflowDomainIRError';
    this.target = target;
  }
}

function emitLayer(
  family: TileflowLayerFamilyIR,
  resolvePhysicalId: TileflowPhysicalIdResolver,
): Record<string, unknown> & {id: string; type: string} {
  const metadata = {
    ...(family.annotations ?? {}),
    [tileflowCompilerMetadataKeys.owner]: family.owner,
    [tileflowCompilerMetadataKeys.slot]: family.slot,
    [tileflowCompilerMetadataKeys.target]: family.target,
    [tileflowCompilerProvenanceMetadataKey]: family.origins,
  };
  return {
    id: resolvePhysicalId(family.key),
    type: family.renderer,
    ...(family.feature?.dataSource === undefined ? {} : {source: family.feature.dataSource}),
    ...(family.feature?.dataLayer === undefined ? {} : {'source-layer': family.feature.dataLayer}),
    ...(family.selector === undefined ? {} : {filter: family.selector}),
    ...(family.range?.minZoom === undefined ? {} : {minzoom: family.range.minZoom}),
    ...(family.range?.maxZoom === undefined ? {} : {maxzoom: family.range.maxZoom}),
    ...(family.style.placement === undefined ? {} : {layout: family.style.placement}),
    ...(family.style.appearance === undefined ? {} : {paint: family.style.appearance}),
    ...(family.properties ?? {}),
    metadata,
  };
}

/**
 * Closed semantic-key to Style-layer binding. No physical identifier is
 * carried through DomainIR or inspected by the planner.
 */
export function physicalLayerIdForSemanticKey(semanticKey: string): string {
  const exact = exactPhysicalLayerIds[semanticKey];
  if (exact) return exact;

  let match = /^([A-Za-z0-9_-]+)\.render\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/u.exec(
    semanticKey,
  );
  if (match) return `tileflow-${match[1]}-render-${match[2]!.replaceAll('.', '-')}`;

  match = /^roads\.classes\.([^.]+)\.(tunnel|surface|bridge)\.(shadow|casing|fill|hatch)$/u.exec(
    semanticKey,
  );
  if (match) return `tileflow-road-${match[2]}-${match[1]}-${match[3]}`;

  match = /^roads\.cohorts\.(tunnel|surface|bridge)\.([^.]+)\.(shadow|casing|fill)$/u.exec(
    semanticKey,
  );
  if (match) return `tileflow-road-${match[1]}-highzoom-${match[2]}-${match[3]}`;

  match = /^roads\.cohorts\.(tunnel|surface|bridge)\.hatch$/u.exec(semanticKey);
  if (match) return `tileflow-road-${match[1]}-hatch`;

  match = /^roads\.areas\.(road|pedestrian|pier)\.(fill|outline)$/u.exec(semanticKey);
  if (match) {
    const base = match[1] === 'road' ? 'tileflow-road-area' : `tileflow-road-${match[1]}-area`;
    return match[2] === 'fill' ? base : `${base}-outline`;
  }

  match = /^land\.(landcover|landuse)\.([^.]+)\.(fill|outline)$/u.exec(semanticKey);
  if (match) {
    const base = `tileflow-${match[1]}-${match[2]}`;
    return match[3] === 'fill' ? base : `${base}-outline`;
  }

  match = /^land\.compatibility\.legacyPark\.(fill|outline)$/u.exec(semanticKey);
  if (match) {
    return match[1] === 'fill'
      ? 'tileflow-landcover-legacy-park'
      : 'tileflow-landcover-legacy-park-outline';
  }

  match = /^land\.cohorts\.(landcover|landuse)(?:\.cohort(\d+))?$/u.exec(semanticKey);
  if (match) return `tileflow-${match[1]}${match[2] === undefined ? '' : `-${match[2]}`}`;

  match = /^water\.(intermittent\.)?bodies\.(fill|outline)$/u.exec(semanticKey);
  if (match) {
    const base = `tileflow-water${match[1] ? '-intermittent' : ''}`;
    return match[2] === 'fill' ? base : `${base}-outline`;
  }

  match = /^water\.(intermittent\.)?waterways\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-waterway-${match[2]}${match[1] ? '-intermittent' : ''}`;

  match = /^buildings\.(businessCorridor|flat)\.(fill|outline)$/u.exec(semanticKey);
  if (match) {
    const base =
      match[1] === 'businessCorridor' ? 'tileflow-business-corridor' : 'tileflow-buildings-fill';
    return match[2] === 'fill' ? base : `${base}-outline`;
  }

  match = /^aeroways\.area\.(fill|outline)$/u.exec(semanticKey);
  if (match) return match[1] === 'fill' ? 'tileflow-aeroway-area' : 'tileflow-aeroway-area-outline';

  match = /^aeroways\.(taxiway|runway)\.(shadow|casing|fill)$/u.exec(semanticKey);
  if (match) return `tileflow-aeroway-${match[1]}-${match[2]}`;

  match = /^transit\.([A-Za-z0-9_-]+)(?:\.(tunnel|surface|bridge))?$/u.exec(semanticKey);
  if (match) return `tileflow-transit-${match[1]}${match[2] ? `-${match[2]}` : ''}`;

  match = /^boundaries\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/u.exec(semanticKey);
  if (match) return `tileflow-boundary-${match[1]!.replaceAll('.', '-')}`;

  match = /^labels\.places\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-label-place-${match[1]}`;

  match = /^labels\.roads\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-label-road-${match[1]}`;

  match = /^labels\.shields\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-label-road-shield-${match[1]}`;

  match = /^labels\.water\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-label-water-${match[1]}`;

  match = /^labels\.cohorts\.roads\.(major|local)$/u.exec(semanticKey);
  if (match) return `tileflow-label-road-${match[1]}`;

  match = /^labels\.cohorts\.roads\.cohort(\d+)$/u.exec(semanticKey);
  if (match) return `tileflow-label-road-cohort-${match[1]}`;

  match = /^landforms\.classes\.([^.]+)$/u.exec(semanticKey);
  if (match) return `tileflow-landform-${match[1]}`;

  match = /^poi\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/u.exec(semanticKey);
  if (match) return `tileflow-poi-${match[1]!.replaceAll('.', '-')}`;

  const nautical = nauticalPhysicalLayerId(semanticKey);
  if (nautical) return nautical;

  throw new TileflowDomainIRError(
    'TILEFLOW_DOMAIN_IR_UNKNOWN_PHYSICAL_KEY',
    `No physical Style-layer binding is registered for semantic key ${semanticKey}.`,
    semanticKey,
  );
}

const exactPhysicalLayerIds: Readonly<Record<string, string>> = Object.freeze({
  'addresses.labels': 'tileflow-addresses-labels',
  'aeroways.runwayRef': 'tileflow-aeroway-runway-ref',
  'buildings.extrusion': 'tileflow-buildings-3d',
  'labels.aerodrome': 'tileflow-label-aerodrome',
  'labels.junctions': 'tileflow-label-road-junction',
  'land.background': 'tileflow-background',
  'land.globalLandcover': 'tileflow-global-landcover',
  'landforms.classes': 'tileflow-landforms',
  'roads.crossings': 'tileflow-road-crossing',
  'roads.oneWayMarkers': 'tileflow-road-oneway',
  'roads.roundabouts.casing': 'tileflow-road-circular-casing',
  'roads.roundabouts.fill': 'tileflow-road-circular-fill',
  'roads.sidewalks.outline': 'tileflow-sidewalk-outline',
  'roads.sidewalks.pattern': 'tileflow-sidewalk-pattern',
  'roads.sidewalks.surface': 'tileflow-sidewalk-surface',
  'terrain.contours.index': 'tileflow-terrain-contour-index',
  'terrain.contours.labels': 'tileflow-terrain-contour-labels',
  'terrain.contours.minor': 'tileflow-terrain-contour-minor',
  'terrain.hillshade': 'tileflow-terrain-hillshade',
  'vegetation.trees': 'tileflow-vegetation-trees',
  'water.bathymetry': 'tileflow-bathymetry',
  'water.bathymetryContours': 'tileflow-bathymetry-contours',
  'water.bathymetryLabels': 'tileflow-bathymetry-labels',
  'water.bathymetryRelief.color': 'tileflow-bathymetry-color-relief',
  'water.bathymetryRelief.hillshade': 'tileflow-bathymetry-relief',
});

const nauticalPhysicalBases: Readonly<Record<string, string>> = Object.freeze({
  'nautical.aids': 'tileflow-nautical-aids',
  'nautical.coverage': 'tileflow-nautical-coverage',
  'nautical.hazardAreas': 'tileflow-nautical-hazard-areas',
  'nautical.hazards': 'tileflow-nautical-hazards',
  'nautical.labels.coverage': 'tileflow-nautical-coverage-labels',
  'nautical.labels.hazards': 'tileflow-nautical-hazard-area-labels',
  'nautical.labels.navigationAreas': 'tileflow-nautical-navigation-area-labels',
  'nautical.labels.reefs': 'tileflow-nautical-reef-labels',
  'nautical.labels.wrecks': 'tileflow-nautical-wreck-area-labels',
  'nautical.lighthouses': 'tileflow-nautical-lighthouses',
  'nautical.lights': 'tileflow-nautical-lights',
  'nautical.navigationAreas': 'tileflow-nautical-navigation-areas',
  'nautical.reefs': 'tileflow-nautical-reefs',
  'nautical.soundings': 'tileflow-nautical-soundings',
  'nautical.wreckAreas': 'tileflow-nautical-wreck-areas',
  'nautical.wrecks': 'tileflow-nautical-wrecks',
});

function nauticalPhysicalLayerId(semanticKey: string): string | undefined {
  const direct = nauticalPhysicalBases[semanticKey];
  if (direct) return direct;
  const match = /^(nautical\.[A-Za-z0-9_.-]+)\.(fill|outline|marker|symbol)$/u.exec(semanticKey);
  if (!match) return undefined;
  const base = nauticalPhysicalBases[match[1]!];
  if (!base) return undefined;
  if (match[2] === 'fill' || match[2] === 'symbol') return base;
  return `${base}-${match[2]}`;
}

function publicMetadata(value: unknown): Record<string, unknown> | undefined {
  const metadata = {...asRecord(value)};
  delete metadata[tileflowCompilerProvenanceMetadataKey];
  for (const key of Object.values(tileflowCompilerMetadataKeys)) delete metadata[key];
  return Object.keys(metadata).length > 0 ? cloneJson(metadata) : undefined;
}

function assertNoSemanticReferences(value: unknown): void {
  const references = {fields: 0, layers: 0, sources: 0};
  visitReferences(value, references);
  if (references.fields > 0 || references.layers > 0 || references.sources > 0) {
    throw new TileflowDomainIRError(
      'TILEFLOW_DOMAIN_IR_UNLOWERED_REFERENCE',
      `Domain IR lowering left ${references.fields} field, ${references.layers} layer, and ${references.sources} source references.`,
    );
  }
}

function visitReferences(
  value: unknown,
  counts: {fields: number; layers: number; sources: number},
  visited = new WeakSet<object>(),
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);
  if (isSemanticFieldReference(value)) {
    counts.fields += 1;
    return;
  }
  if (isSemanticLayerReference(value)) {
    counts.layers += 1;
    return;
  }
  if (isSemanticSourceReference(value)) {
    counts.sources += 1;
    return;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    visitReferences(child, counts, visited);
  }
}

function isSemanticFieldReference(value: unknown): value is {kind: 'tileflow-data-field'} {
  return isRecord(value) && value.kind === 'tileflow-data-field';
}

function isSemanticLayerReference(value: unknown): value is {kind: 'tileflow-data-layer'} {
  return isRecord(value) && value.kind === 'tileflow-data-layer';
}

function isSemanticSourceReference(value: unknown): value is {kind: 'tileflow-data-source'} {
  return isRecord(value) && value.kind === 'tileflow-data-source';
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
