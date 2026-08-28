import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {resolveTileflowData, type TileflowDataConfig} from '../data';
import {inferTileflowSourceRequirements} from '../data/requirements';
import {type ResolvedTileflowMap, resolveMap, type TileflowMap} from '../maps';
import {resolveMarine} from '../marine';
import {parseResolvedTileflowMap} from '../resolved-map-schema';
import {compileTerrainContributions, resolveTerrain} from '../terrain';
import {
  auditTileflowMapThemeValues,
  resolveThemeColors,
  resolveThemeImages,
  resolveThemeSelection,
  resolveThemeValues,
  resolveTileflowTheme,
  TileflowThemeAuditError,
} from '../themes';
import type {MapLibreStyle} from '../types';
import {
  createTileflowCompilationFailure,
  type TileflowCompilationDiagnostic,
  type TileflowCompilationDomainReport,
  type TileflowCompilationPhase,
  type TileflowCompilationPlannerDecision,
  type TileflowCompilationReport,
  tileflowCompilationReportSchemaVersion,
  type TileflowCompilationResult,
} from './compilation-report';
import {
  createTileflowStyleInspection,
  readTileflowCompilerProvenance,
  tileflowCompilerProvenanceMetadataKey,
  type TileflowInspectedStyle,
  type TileflowStyleInspection,
} from './compiler-inspection';
import {tileflowCompilerMetadataKeys} from './contributions';
import {
  createTileflowDomainIR,
  createTileflowLayerFamilyIR,
  lowerTileflowDomainIR,
} from './domain-ir';
import {
  compileSemanticDomains,
  resolveSemanticModules,
  type TileflowSemanticModules,
} from './domain-registry';
import {assembleTileflowLayerFamilies} from './graph';
import {
  assertTileflowInteractionManifestLayers,
  createTileflowInteractionManifest,
  tileflowInteractionManifestMetadataKey,
} from './interaction-manifest';
import {planTileflowLayerFamilies} from './physical-planner';
import {
  applyCompiledRenderStacks,
  compileRenderStacks,
  type TileflowRenderStackModule,
} from './render-stack';
import {createSemanticDataView} from './semantic-bindings';
import {tileflowSemanticCompilerIdentity} from './semantic-compiler';

export type TileflowSemanticMapConfig = ResolvedTileflowMap;

export type TileflowPreparedMapAssets = {
  icons?: {
    ids: readonly string[];
    sprite: string;
  };
};

export type TileflowSemanticCompileOptions = {
  apiBaseUrl?: string;
  /** Resolved authoring identity. Internal build orchestration supplies this. */
  map?: {
    id: string;
    lineage?: readonly string[];
    version: number;
  };
  /** Build-owned assets prepared from the authoring directories. */
  preparedAssets?: TileflowPreparedMapAssets;
  /** Concrete named theme. Omission deterministically selects map.defaultTheme. */
  theme?: string;
};

export type TileflowSemanticCompilationOptions = TileflowSemanticCompileOptions & {
  /** Include opt-in read-only physical diagnostics; emitted IDs are not authoring targets. */
  inspection?: boolean;
};

export function createSemanticStyle(
  config: TileflowMap,
  options: TileflowSemanticCompileOptions = {},
): MapLibreStyle {
  const parsed = parseResolvedTileflowMap(resolveMap(config));
  return compileSemanticStyle(parsed, options);
}

/** Compile a public semantic map without throwing, preserving a stable machine-readable report. */
export function createSemanticStyleResult(
  config: TileflowMap,
  options: TileflowSemanticCompilationOptions = {},
): TileflowCompilationResult {
  try {
    const parsed = parseResolvedTileflowMap(resolveMap(config));
    return compileSemanticStyleResult(parsed, options);
  } catch (error) {
    return createTileflowCompilationFailure({
      error,
      map: typeof config.id === 'string' ? config.id : '<unresolved>',
      phase: 'input',
      theme: options.theme,
    });
  }
}

/** Compile an already validated semantic map. Internal orchestration should use this entry point. */
export function compileSemanticStyle(
  input: TileflowSemanticMapConfig,
  options: TileflowSemanticCompileOptions = {},
): MapLibreStyle {
  return compileSemanticStyleInternal(input, options, false).style;
}

/** Compile an already validated map to a structured success/failure result. */
export function compileSemanticStyleResult(
  input: TileflowSemanticMapConfig,
  options: TileflowSemanticCompilationOptions = {},
): TileflowCompilationResult {
  const {inspection = false, ...compileOptions} = options;
  let partialReport: TileflowCompilationReport | undefined;
  try {
    const compiled = compileSemanticStyleInternal(input, compileOptions, inspection, (report) => {
      partialReport = report;
    });
    return {
      diagnostics: compiled.diagnostics,
      ok: true,
      report: compiled.report,
      style: compiled.style,
    };
  } catch (error) {
    return createTileflowCompilationFailure({
      error,
      map: input.id,
      phase: 'validation',
      ...(partialReport ? {report: partialReport} : {}),
      theme: options.theme,
    });
  }
}

/** Compile Style JSON plus a separate read-only physical-output diagnostic sidecar. */
export function compileSemanticStyleWithInspection(
  input: TileflowSemanticMapConfig,
  options: TileflowSemanticCompileOptions = {},
): TileflowInspectedStyle {
  const compiled = compileSemanticStyleInternal(input, options, true);
  return {style: compiled.style, inspection: compiled.inspection!};
}

function compileSemanticStyleInternal(
  input: TileflowSemanticMapConfig,
  options: TileflowSemanticCompileOptions,
  inspect: boolean,
  onReport?: (report: TileflowCompilationReport) => void,
): {
  diagnostics: readonly TileflowCompilationDiagnostic[];
  inspection?: TileflowStyleInspection;
  report: TileflowCompilationReport;
  style: MapLibreStyle;
} {
  const themeAudit = runCompilationPhase('theme-audit', () => auditTileflowMapThemeValues(input));
  const blockingThemeDiagnostics = themeAudit.filter(({severity}) => severity === 'error');
  if (blockingThemeDiagnostics.length > 0) {
    throw new TileflowThemeAuditError(blockingThemeDiagnostics);
  }
  const diagnostics: readonly TileflowCompilationDiagnostic[] = themeAudit
    .filter(({severity}) => severity === 'warning')
    .map(({code, message, owner, path, phase, severity, suggestion, target}) => ({
      code,
      ...(owner ? {domain: owner as TileflowCompilationDiagnostic['domain']} : {}),
      message,
      path,
      phase,
      severity,
      suggestion,
      ...(target ? {target} : {}),
    }));
  const selected = runCompilationPhase('theme', () => resolveThemeSelection(input, options.theme));
  const resolvedTheme = runCompilationPhase('theme', () => resolveTileflowTheme(selected.theme));
  const {themes: _themes, ...themeableConfig} = input;
  const resolvedThemeConfig = runCompilationPhase('theme', () =>
    resolveThemeValues(themeableConfig, selected.theme, `map.${input.id}`),
  );
  const config = runCompilationPhase('config-validation', () =>
    parseResolvedTileflowMap({
      ...resolvedThemeConfig,
      themes: input.themes,
    } as TileflowSemanticMapConfig),
  );
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const data = runCompilationPhase('data', () => resolveTileflowData(config.data, {apiBaseUrl}));
  const marine = runCompilationPhase('data', () => resolveMarine(config.marine, apiBaseUrl));
  const terrain = runCompilationPhase('data', () => resolveTerrain(config.terrain, apiBaseUrl));
  const terrainSources = [terrain?.raster, terrain?.contours].filter(
    (source): source is NonNullable<typeof source> => source !== undefined,
  );
  const marineSources = [
    marine?.bathymetry?.vector,
    marine?.bathymetry?.relief,
    marine?.nautical,
  ].filter((source): source is NonNullable<typeof source> => source !== undefined);
  runCompilationPhase('data', () => {
    const terrainSourceIds = new Set<string>();
    for (const source of terrainSources) {
      if (source.sourceId === data.sourceId) {
        throw new Error(
          `Terrain source ID "${source.sourceId}" conflicts with the primary vector source.`,
        );
      }
      if (terrainSourceIds.has(source.sourceId)) {
        throw new Error(
          `Terrain source ID "${source.sourceId}" conflicts with another terrain source.`,
        );
      }
      terrainSourceIds.add(source.sourceId);
    }
    const marineSourceIds = new Set<string>();
    for (const source of marineSources) {
      if (source.sourceId === data.sourceId) {
        throw new Error(
          `Marine source ID "${source.sourceId}" conflicts with the primary vector source.`,
        );
      }
      if (terrainSourceIds.has(source.sourceId)) {
        throw new Error(`Marine source ID "${source.sourceId}" conflicts with a terrain source.`);
      }
      if (marineSourceIds.has(source.sourceId)) {
        throw new Error(
          `Marine source ID "${source.sourceId}" conflicts with another marine source.`,
        );
      }
      marineSourceIds.add(source.sourceId);
    }
  });
  const semanticData = marine?.bathymetry?.vector
    ? {
        ...data,
        schema: {
          ...data.schema,
          fields: {
            ...data.schema.fields,
            bathymetryMinDepth: 'min_depth',
            bathymetrySortKey: 'sort_key',
          },
          layers: {...data.schema.layers, bathymetry: 'bathymetry'},
        },
      }
    : data;
  const semanticCompilerData = runCompilationPhase('data', () =>
    createSemanticDataView(semanticData),
  );
  const colors = runCompilationPhase('theme', () => resolveThemeColors(selected.theme));
  const images = runCompilationPhase('theme', () => resolveThemeImages(selected.theme));
  const typography = resolvedTheme.typography;
  const context = {
    colors,
    data: semanticCompilerData,
    images,
    ...(marine === undefined ? {} : {marine}),
    typography,
  };
  const modules = runCompilationPhase('domains', () => resolveSemanticModules(config.modules));
  const compiledDomains = runCompilationPhase('domains', () =>
    compileSemanticDomains(modules, context),
  );
  const renderStackModules = Object.values(modules).filter(
    (module): module is typeof module & TileflowRenderStackModule =>
      isRecord(module) &&
      module.enabled !== false &&
      'renderStack' in module &&
      isRecord(module.renderStack),
  );
  const renderOperations = runCompilationPhase('render-stack', () =>
    compileRenderStacks(renderStackModules, semanticCompilerData),
  );
  const domainIR = runCompilationPhase('domain-ir', () =>
    createTileflowDomainIR({
      compiledDomains,
      data: semanticCompilerData,
      renderOperations,
    }),
  );
  const terrainFamilies = terrain
    ? runCompilationPhase('domains', () =>
        compileTerrainContributions(terrain, context).map(createTileflowLayerFamilyIR),
      )
    : [];
  const families = [...domainIR.families, ...terrainFamilies];
  const assembledFamilies = runCompilationPhase('assembly', () =>
    assembleTileflowLayerFamilies(families),
  );
  const requestedRenderOperations = domainIR.renderOperations;
  const stackedFamilies = runCompilationPhase('render-stack', () =>
    applyCompiledRenderStacks(assembledFamilies, requestedRenderOperations),
  );
  const plannedFamilies = runCompilationPhase('physical-planner', () =>
    planTileflowLayerFamilies(stackedFamilies),
  );
  // This is the sole MapLibre emission and semantic-data binding boundary.
  const loweredDomainIR = runCompilationPhase('lowering', () =>
    lowerTileflowDomainIR(plannedFamilies, semanticData),
  );
  const plannedLayers = [...loweredDomainIR.layers];
  const emittedProvenance = plannedLayers.flatMap((layer) => readTileflowCompilerProvenance(layer));
  const emittedContributionKeys = new Set(
    emittedProvenance.map(({owner, target}) => semanticReportKey(owner, target)),
  );
  const emittedOperationKeys = new Set(
    emittedProvenance.flatMap(({operations}) =>
      operations.map(({kind, owner, target}) => semanticReportKey(owner, kind, target)),
    ),
  );
  const emittedRenderOperations = requestedRenderOperations.filter((operation) =>
    emittedOperationKeys.has(
      semanticReportKey(
        operation.owner,
        operation.kind === 'layer' ? 'pass' : 'refinement',
        operation.target,
      ),
    ),
  );
  const plannerDecisions: readonly TileflowCompilationPlannerDecision[] = [
    {
      inputCount: domainIR.families.length + domainIR.renderOperations.length,
      outputCount: domainIR.families.length + domainIR.renderOperations.length,
      stage: 'domain-ir',
    },
    {
      inputCount: families.length,
      outputCount: assembledFamilies.length,
      stage: 'assembly',
    },
    {
      candidateCount: requestedRenderOperations.length,
      inputCount: assembledFamilies.length,
      outputCount: stackedFamilies.length,
      selectedCount: emittedRenderOperations.length,
      stage: 'render-stack',
    },
    {
      inputCount: stackedFamilies.length,
      outputCount: plannedFamilies.length,
      stage: 'physical-planner',
    },
    {
      inputCount: plannedFamilies.length,
      outputCount: plannedLayers.length,
      stage: 'lowering',
    },
  ];
  const inspection = inspect
    ? runCompilationPhase('finalization', () =>
        createTileflowStyleInspection(options.map?.id ?? config.id, selected.name, plannedLayers),
      )
    : undefined;
  const renderOperationsByOwner = new Map<string, {count: number; targets: Set<string>}>();
  for (const operation of emittedRenderOperations) {
    const ownerOperations = renderOperationsByOwner.get(operation.owner) ?? {
      count: 0,
      targets: new Set<string>(),
    };
    ownerOperations.count += 1;
    ownerOperations.targets.add(operation.target);
    renderOperationsByOwner.set(operation.owner, ownerOperations);
  }
  const domainReports: readonly TileflowCompilationDomainReport[] = compiledDomains.domains.map(
    (domain) => {
      const emittedContributions = domain.contributions.filter(({owner, target}) =>
        emittedContributionKeys.has(semanticReportKey(owner, target)),
      );
      const renderOperations = renderOperationsByOwner.get(domain.name);
      const renderOperationCount = renderOperations?.count ?? 0;
      const emitted = emittedContributions.length > 0 || renderOperationCount > 0;
      return {
        contributionCount: emittedContributions.length,
        name: domain.name,
        renderOperationCount,
        status: emitted ? 'emitted' : 'suppressed',
        ...(!emitted ? {suppressionReason: domain.suppressionReason ?? 'no-contributions'} : {}),
        targets: [
          ...new Set([
            ...emittedContributions.map(({target}) => target),
            ...(renderOperations?.targets ?? []),
          ]),
        ].sort(compareCodeUnits),
      };
    },
  );
  const targets = [...new Set(domainReports.flatMap((domain) => domain.targets))].sort(
    compareCodeUnits,
  );
  const partialReport: TileflowCompilationReport = {
    domains: domainReports,
    map: options.map?.id ?? config.id,
    planner: plannerDecisions,
    ...(inspection ? {provenance: inspection} : {}),
    schemaVersion: tileflowCompilationReportSchemaVersion,
    targets,
    theme: selected.name,
  };
  onReport?.(partialReport);
  const interactionManifest = runCompilationPhase('finalization', () =>
    createTileflowInteractionManifest(plannedLayers, {
      category: data.schema.fields.poiCategory,
      filterRank: data.schema.fields.poiFilterRank,
      icon: data.schema.fields.poiIcon,
      name: data.schema.fields.name,
      sizeRank: data.schema.fields.poiSizeRank,
      type: data.schema.fields.poiType,
    }),
  );
  const layers = runCompilationPhase('finalization', () => finalizeTileflowLayers(plannedLayers));
  runCompilationPhase('finalization', () =>
    assertTileflowInteractionManifestLayers(interactionManifest, layers),
  );
  const glyphs = runCompilationPhase('assets', () => resolveGlyphs(config));
  const sprite = options.preparedAssets?.icons?.sprite;

  const primarySource: Record<string, unknown> = {
    type: 'vector',
    ...(data.url !== undefined ? {url: data.url} : {tiles: data.tiles}),
    attribution: data.attribution,
    ...(data.bounds ? {bounds: data.bounds} : {}),
    ...(data.maxzoom === undefined ? {} : {maxzoom: data.maxzoom}),
    ...(data.minzoom === undefined ? {} : {minzoom: data.minzoom}),
  };

  const mapMetadata = options.map ?? {
    id: config.id,
    version: config.version,
  };

  const sources: MapLibreStyle['sources'] = {
    [data.sourceId]: primarySource,
    ...(marine?.bathymetry?.vector
      ? {[marine.bathymetry.vector.sourceId]: marine.bathymetry.vector.source}
      : {}),
    ...(marine?.bathymetry?.relief
      ? {[marine.bathymetry.relief.sourceId]: marine.bathymetry.relief.source}
      : {}),
    ...(marine?.nautical ? {[marine.nautical.sourceId]: marine.nautical.source} : {}),
    ...(terrain?.raster ? {[terrain.raster.sourceId]: terrain.raster.source} : {}),
    ...(terrain?.contours ? {[terrain.contours.sourceId]: terrain.contours.source} : {}),
  };
  const sourceIdentities = {
    [data.sourceId]: data.identity,
    ...(marine?.bathymetry?.vector
      ? {[marine.bathymetry.vector.sourceId]: marine.bathymetry.vector.identity}
      : {}),
    ...(marine?.bathymetry?.relief
      ? {[marine.bathymetry.relief.sourceId]: marine.bathymetry.relief.identity}
      : {}),
    ...(marine?.nautical ? {[marine.nautical.sourceId]: marine.nautical.identity} : {}),
  };
  const sourceRequirements = runCompilationPhase('data', () =>
    inferTileflowSourceRequirements({
      version: 8,
      name: config.name ?? 'Streets',
      sources,
      layers,
    }),
  );

  const style: MapLibreStyle = {
    version: 8,
    name: config.name ?? 'Streets',
    ...(glyphs ? {glyphs} : {}),
    ...(Object.keys(resolvedTheme.lighting).length > 0 ? {light: resolvedTheme.lighting} : {}),
    ...(config.projection ? {projection: {type: config.projection}} : {}),
    ...(sprite ? {sprite} : {}),
    sources,
    layers,
    ...(terrain?.mode === '3d' && terrain.raster
      ? {terrain: {exaggeration: terrain.exaggeration, source: terrain.raster.sourceId}}
      : {}),
    metadata: {
      ...(mapMetadata
        ? {
            'tileflow:map': mapMetadata.id,
            'tileflow:mapVersion': mapMetadata.version,
            'tileflow:compiler': tileflowSemanticCompilerIdentity.name,
            'tileflow:compilerVersion': tileflowSemanticCompilerIdentity.version,
            ...(mapMetadata.lineage && mapMetadata.lineage.length > 1
              ? {'tileflow:extends': mapMetadata.lineage.slice(1)}
              : {}),
          }
        : {}),
      'tileflow:theme': selected.name,
      'tileflow:colorScheme': resolvedTheme.colorScheme,
      'tileflow:data': data.identity,
      'tileflow:sources': sourceIdentities,
      'tileflow:sourceRequirements': sourceRequirements,
      ...(interactionManifest
        ? {[tileflowInteractionManifestMetadataKey]: interactionManifest}
        : {}),
      'tileflow:modules': Object.entries(modules)
        .filter(([, module]) => !isRecord(module) || module.enabled !== false)
        .map(([name]) => name)
        .sort(),
      ...(config.view ? {'tileflow:view': config.view} : {}),
    },
  };
  const report: TileflowCompilationReport = {
    ...partialReport,
    requirements: sourceRequirements,
  };
  onReport?.(report);
  runCompilationPhase('assets', () =>
    assertPreparedIconReferences(style, config, options.preparedAssets),
  );
  runCompilationPhase('assets', () => assertTextAssets(style, config));
  runCompilationPhase('assets', () => assertGlyphFontStacks(style, config));
  runCompilationPhase('validation', () => assertMapLibreStyle(style, config.id));
  return {diagnostics, report, style, ...(inspection ? {inspection} : {})};
}

function finalizeTileflowLayers(
  input: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const ids = new Set<string>();
  return input
    .map((layer, index) => {
      const id = typeof layer.id === 'string' ? layer.id : '';
      if (!id) throw new Error(`Compiled Tileflow layer at index ${index} has no ID.`);
      if (ids.has(id)) throw new Error(`Duplicate compiled Tileflow layer ID: ${id}`);
      ids.add(id);

      const minimum = layer.minzoom;
      const maximum = layer.maxzoom;
      for (const [name, value] of [
        ['minzoom', minimum],
        ['maxzoom', maximum],
      ] as const) {
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) {
          throw new Error(`Compiled Tileflow layer ${id} has invalid ${name}: ${String(value)}`);
        }
      }
      if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
        throw new Error(`Compiled Tileflow layer ${id} requires minzoom <= maxzoom.`);
      }

      const metadata = isRecord(layer.metadata) ? {...layer.metadata} : undefined;
      if (metadata) {
        delete metadata[tileflowCompilerProvenanceMetadataKey];
        for (const key of Object.values(tileflowCompilerMetadataKeys)) delete metadata[key];
      }
      return {
        ...layer,
        ...(metadata && Object.keys(metadata).length > 0 ? {metadata} : {}),
        ...(metadata && Object.keys(metadata).length === 0 ? {metadata: undefined} : {}),
      };
    })
    .map((layer) => {
      if (layer.metadata !== undefined) return layer;
      const {metadata: _metadata, ...withoutMetadata} = layer;
      return withoutMetadata;
    });
}

function assertMapLibreStyle(style: MapLibreStyle, mapId: string): void {
  const errors = validateStyleMin(style as never);
  if (errors.length === 0) return;
  const details = errors
    .slice(0, 8)
    .map((error) => error.message)
    .join('; ');
  const remaining = errors.length > 8 ? `; ${errors.length - 8} more` : '';
  throw new Error(`Compiled Tileflow map "${mapId}" is not MapLibre-valid: ${details}${remaining}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveGlyphs(config: ResolvedTileflowMap): string | undefined {
  if (config.fonts !== undefined) return undefined;
  return config.glyphs?.url;
}

function assertPreparedIconReferences(
  style: MapLibreStyle,
  config: ResolvedTileflowMap,
  prepared: TileflowPreparedMapAssets | undefined,
): void {
  const references = collectStyleImageReferences(style);
  if (references.size === 0) return;
  const available = new Set(prepared?.icons?.ids ?? []);
  const missing = [...references].filter((id) => !available.has(id)).sort();
  if (missing.length === 0 && prepared?.icons?.sprite) return;
  const authoring = config.icons?.length
    ? 'Run the Node build so map.icons directories are prepared.'
    : 'Declare map.icons with directories containing those canonical filenames.';
  throw new Error(
    `Tileflow map "${config.id}" references missing images: ${missing.join(', ') || '<sprite>'}. ${authoring}`,
  );
}

function collectStyleImageReferences(style: MapLibreStyle): Set<string> {
  const result = new Set<string>();
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : {};
    const paint = isRecord(layer.paint) ? layer.paint : {};
    const layerId = typeof layer.id === 'string' ? layer.id : '<unknown>';
    for (const [property, value] of [
      ['icon-image', layout['icon-image']],
      ['background-pattern', paint['background-pattern']],
      ['fill-pattern', paint['fill-pattern']],
      ['line-pattern', paint['line-pattern']],
      ['fill-extrusion-pattern', paint['fill-extrusion-pattern']],
    ] as const) {
      if (value !== undefined) collectStaticImageOutputs(value, result, `${layerId}.${property}`);
    }
  }
  return result;
}

function collectStaticImageOutputs(value: unknown, result: Set<string>, path: string): void {
  if (typeof value === 'string') {
    result.add(value);
    return;
  }
  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    throw new Error(`Tileflow image reference ${path} must resolve to enumerable sprite IDs.`);
  }

  const operator = value[0];
  switch (operator) {
    case 'image': {
      if (value.length !== 2 || typeof value[1] !== 'string') {
        throw dynamicImageExpression(path, operator);
      }
      result.add(value[1]);
      return;
    }
    case 'coalesce': {
      const outputs = value.slice(1);
      const staticOutputs = outputs.filter((output) => !isOptionalSpriteLookup(output));
      if (staticOutputs.length === 0) throw dynamicImageExpression(path, operator);
      for (const output of staticOutputs) collectStaticImageOutputs(output, result, path);
      return;
    }
    case 'case': {
      for (let index = 2; index < value.length - 1; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      collectStaticImageOutputs(value.at(-1), result, path);
      return;
    }
    case 'match': {
      for (let index = 3; index < value.length - 1; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      collectStaticImageOutputs(value.at(-1), result, path);
      return;
    }
    case 'step': {
      collectStaticImageOutputs(value[2], result, path);
      for (let index = 4; index < value.length; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      return;
    }
    case 'interpolate': {
      for (let index = 4; index < value.length; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      return;
    }
    case 'literal': {
      if (value.length !== 2 || typeof value[1] !== 'string') {
        throw dynamicImageExpression(path, operator);
      }
      result.add(value[1]);
      return;
    }
    default:
      throw dynamicImageExpression(path, operator);
  }
}

function isOptionalSpriteLookup(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === 'image' &&
    Array.isArray(value[1]) &&
    value[1].length === 2 &&
    value[1][0] === 'get' &&
    typeof value[1][1] === 'string'
  );
}

function dynamicImageExpression(path: string, operator: string): Error {
  return new Error(
    `Tileflow image reference ${path} uses dynamic ${JSON.stringify(operator)} output; every possible sprite ID must be statically enumerable with literal, image, case, match, step, interpolate, or coalesce outputs.`,
  );
}

function assertGlyphFontStacks(style: MapLibreStyle, config: ResolvedTileflowMap): void {
  if (!config.glyphs) return;
  const declared = new Set(config.glyphs.fontStacks);
  const missing = new Set<string>();
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : undefined;
    const font = layout?.['text-font'];
    if (!Array.isArray(font) || !font.every((entry) => typeof entry === 'string')) continue;
    const stack = font.join(',');
    if (stack && !declared.has(stack)) missing.add(stack);
  }
  if (missing.size > 0) {
    throw new Error(
      `Tileflow map "${config.id}" uses undeclared glyph font stacks: ${[...missing].sort().join(', ')}.`,
    );
  }
}

function assertTextAssets(style: MapLibreStyle, config: ResolvedTileflowMap): void {
  const textLayers: string[] = [];
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : undefined;
    if (layout?.['text-field'] === undefined) continue;
    textLayers.push(typeof layer.id === 'string' ? layer.id : '<unknown>');
    const font = layout['text-font'];
    if (
      !Array.isArray(font) ||
      font.length === 0 ||
      font.some((entry) => typeof entry !== 'string' || entry.length === 0)
    ) {
      throw new Error(
        `Tileflow map "${config.id}" text layer "${typeof layer.id === 'string' ? layer.id : '<unknown>'}" requires a static non-empty text-font array of exact face names.`,
      );
    }
  }
  if (textLayers.length === 0) return;
  if (config.fonts !== undefined) {
    if (config.fonts.length > 0) return;
    throw new Error(
      `Tileflow map "${config.id}" contains text but declares an empty fonts directory array.`,
    );
  }
  if (config.glyphs !== undefined && style.glyphs) return;
  throw new Error(
    `Tileflow map "${config.id}" contains text but declares neither fonts nor glyphs.`,
  );
}

function runCompilationPhase<T>(phase: TileflowCompilationPhase, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw withCompilationPhase(error, phase);
  }
}

function withCompilationPhase(error: unknown, phase: TileflowCompilationPhase): unknown {
  const record = isRecord(error) ? error : {};
  if (typeof record.phase === 'string') return error;
  if (error instanceof Error && Object.isExtensible(error)) {
    Object.defineProperty(error, 'phase', {configurable: true, enumerable: true, value: phase});
    return error;
  }
  const wrapped = new Error(error instanceof Error ? error.message : String(error));
  for (const key of [
    'code',
    'diagnostics',
    'domain',
    'messages',
    'owner',
    'path',
    'severity',
    'target',
  ]) {
    if (record[key] !== undefined) Object.assign(wrapped, {[key]: record[key]});
  }
  Object.assign(wrapped, {phase});
  return wrapped;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? 'https://api.tileflow.dev').replace(/\/+$/, '');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticReportKey(...parts: readonly string[]): string {
  return parts.join('\u0000');
}
