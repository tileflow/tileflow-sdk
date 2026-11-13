import {dirname} from 'node:path';
import {
  getTileflowStyleFontFaces,
  type MapLibreStyle,
  parseResolvedTileflowMap,
  serializeCanonicalJson,
  type TileflowViewConfig,
} from '@tileflow/core';
import {
  compactTileflowDeploymentArtifact,
  createTileflowMapBuildManifest,
  splitTileflowRendererDeployment,
  type TileflowBuildCatalog,
  type TileflowMapBuildManifestV1,
  type TileflowRendererDeploymentArtifact,
  type TileflowRendererDeploymentResponse,
} from '@tileflow/core/build';
import {
  parseTileflowRuntimeManifest,
  type TileflowRuntimeManifest,
  type TileflowRuntimeManifestMapEntry,
} from '@tileflow/core/manifest';
import {
  type TileflowNativeCapability,
  type TileflowNativeFamily,
} from '@tileflow/core/native-profile';
import {
  createTileflowBuildProvenance,
  createTileflowStyles,
  prepareTileflowHostedNativeDeployment,
  prepareTileflowLocalTilesets,
} from '@tileflow/dev/artifacts';
import {
  bindTileflowStyleFontBundle,
  type CompiledTileflowFontBundle,
  prepareTileflowStyleFonts,
} from '@tileflow/dev/fonts';
import {
  type CompiledTileflowIconPackage,
  compileTileflowIconPackages,
  type TileflowIconResolutionOptions,
} from '@tileflow/dev/icons';
import {normalizeApiOrigin} from './account-session';
import type {DeploySource} from './deploy-source';
import {
  type HostedApi,
  HostedDeploymentError,
  type HostedRendererDeploymentEvent,
  type HostedRequestOptions,
  publishHostedRendererDeployment,
  publishHostedWebDeployment,
  uploadHostedFontBundle,
  uploadHostedIconPackage,
} from './hosted-client';
import {
  inspectTileflowHostedCompatibility,
  prepareTileflowHostedThemeFamily,
} from './hosted-preflight';
import {
  compiledMapAssets,
  hostedModelSourceIdentities,
  mapAssetsWithBuildingModels,
  prepareModelAssets,
  teamModelSources,
} from './model-assets';

export {HostedDeploymentError} from './hosted-client';

type IconCompilation = Awaited<ReturnType<typeof compileTileflowIconPackages>>;
type TeamModelSources = NonNullable<ReturnType<typeof teamModelSources>>;

/** Hosted publication could not start: the local config is not Hosted-compatible. */
export class HostedCompatibilityError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super('Tileflow config is not Hosted-compatible.');
    this.name = 'HostedCompatibilityError';
    this.issues = issues;
  }
}

/** True for an API origin a Hosted deploy may publish to: HTTPS, or HTTP on a loopback host. */
export function isHostedDeployOrigin(origin: string): boolean {
  const url = new URL(origin);
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  );
}

export type HostedDeployPreparationInput = Readonly<{
  project: TileflowBuildCatalog;
  configFile: string;
  mapName: string;
  /** The normalized API origin; preflight asset addresses use it. */
  apiUrl: string;
  icons?: TileflowIconResolutionOptions;
}>;

type HostedWebArtifact = Readonly<{
  kind: 'tileflow-map-deployment';
  schemaVersion: 1;
  mapId: string;
  buildManifest: TileflowMapBuildManifestV1;
  styles: Record<string, MapLibreStyle>;
  teamSources: Readonly<Record<string, {tileset: string; type: 'raster' | 'vector'}>>;
  view?: TileflowViewConfig;
}>;
type HostedArtifact = HostedWebArtifact | TileflowRendererDeploymentArtifact;
const webArtifact = (artifact: HostedArtifact) =>
  artifact.schemaVersion === 1 ? artifact : artifact.renderers.web;

/** Everything a Hosted deploy prepares before any credential or network request. */
export type PreparedHostedDeploy = Readonly<{
  mapName: string;
  /** The selected renderer families with preflight asset addresses. */
  preflight: HostedArtifact;
  packages: readonly CompiledTileflowIconPackage[];
  iconBinding?: IconCompilation['bindings'][number];
  iconComposition?: IconCompilation['compositions'][string];
  fontBundle?: CompiledTileflowFontBundle;
  /** The glTF binaries each placed building model was prepared from, for the server to compare. */
  teamModelSources?: TeamModelSources;
  /**
   * The selected renderer families bound to the hosted sprite and font files. The frozen compiled styles
   * are reused: the config is not evaluated again and only these asset addresses change.
   */
  retarget(assets: Readonly<{sprite?: string; fontBaseUrl?: string}>): Promise<HostedArtifact>;
  dispose(): Promise<void>;
}>;

/**
 * Compile one map for Hosted publication. Prepare the web family and, when selected, the
 * native family for MapLibre Native. Native preparation leaves
 * out and records what native maps cannot draw; it fails only for a theme it cannot prepare at all.
 * Nothing here authenticates or touches the network.
 */
export async function prepareHostedDeploy(
  input: HostedDeployPreparationInput,
): Promise<PreparedHostedDeploy> {
  const {mapName, apiUrl} = input;
  const map = input.project.maps[mapName];
  if (!map) throw new Error(`Unknown Tileflow map: ${mapName}.`);
  const project: TileflowBuildCatalog = {...input.project, maps: {[mapName]: map}};
  const baseDirectory = dirname(input.configFile);
  const cwd = process.cwd();
  const compiledIcons = await compileTileflowIconPackages(project, {
    baseDirectory,
    cwd,
    target: 'hosted',
    ...(input.icons ? {icons: input.icons} : {}),
  });
  const binding = compiledIcons.bindings.find((entry) => entry.mapName === mapName);
  const iconPackage = binding
    ? compiledIcons.packages.find((entry) => entry.contentHash === binding.packageHash)
    : undefined;
  const preflightSprite = (packageHash: string) =>
    `${apiUrl}/sprites/preflight/${packageHash}/sprite`;
  const modelAssets = await prepareModelAssets(project, {baseDirectory, target: 'hosted'});
  const styles = createTileflowStyles(project, {
    apiBaseUrl: apiUrl,
    mapAssets: compiledMapAssets(
      compiledIcons,
      (entry) => preflightSprite(entry.packageHash),
      mapAssetsWithBuildingModels(modelAssets, {hosted: true}),
    ),
    // Both renderers share compilation; native preparation drops the web colour bindings.
    runtimeColors: true,
  });
  const local = await prepareTileflowLocalTilesets(project, styles, {
    assetBaseUrl: apiUrl,
    baseDirectory,
    cwd,
  });
  try {
    const fonts = await prepareTileflowStyleFonts(project, local.styles, {
      apiBaseUrl: apiUrl,
      assetBaseUrl: `${apiUrl}/font-bundles/preflight`,
      baseDirectory,
      cwd,
      target: 'hosted',
    });
    const issues = inspectTileflowHostedCompatibility(project, fonts.styles);
    if (issues.length) throw new HostedCompatibilityError(issues.map(({message}) => message));
    const fontBundle = fonts.bundles[mapName];
    const assets = [
      ...(iconPackage?.files ?? []).map((file) => ({
        contentType: file.contentType,
        fileName: `icons/${mapName}/${file.fileName}`,
        source: file.source,
      })),
      ...(fontBundle?.files ?? []),
    ];
    const models = hostedModelSourceIdentities(modelAssets, mapName);
    const provenance = await createTileflowBuildProvenance(cwd);
    const resolved = parseResolvedTileflowMap(map);
    const compiled: Record<string, MapLibreStyle> = JSON.parse(
      serializeCanonicalJson(fonts.styles[mapName]!),
    );
    const sprite = binding ? preflightSprite(binding.packageHash) : undefined;
    const createArtifact = async (selected: Readonly<{sprite?: string; fontBaseUrl?: string}>) => {
      const themeStyles: Record<string, MapLibreStyle> = {};
      for (const [theme, source] of Object.entries(compiled)) {
        let style: MapLibreStyle = JSON.parse(serializeCanonicalJson(source));
        if (binding) {
          if (!selected.sprite || style.sprite !== sprite)
            throw new HostedDeploymentError('The compiled sprite changed before publication.');
          style.sprite = selected.sprite;
        }
        if (fontBundle && selected.fontBaseUrl)
          style = bindTileflowStyleFontBundle(style, fontBundle, selected.fontBaseUrl);
        themeStyles[theme] = style;
      }
      const family = prepareTileflowHostedThemeFamily(mapName, map, themeStyles);
      const buildManifest = await createTileflowMapBuildManifest(
        {
          [mapName]: {
            assets,
            lineage: project.mapMetadata?.[mapName]?.lineage ?? [
              {id: map.id, mapVersion: map.version},
            ],
            map,
            sourceAssets: {
              fonts: fonts.sourceIdentities[mapName] ?? [],
              icons: compiledIcons.sourceIdentities[mapName] ?? [],
              ...(compiledIcons.compositions[mapName]
                ? {iconComposition: compiledIcons.compositions[mapName]}
                : {}),
              ...(models ? {models} : {}),
            },
            styles: family.styles,
          },
        },
        {provenance},
      );
      if (!resolved.platforms?.some((platform) => platform === 'native')) {
        return {
          kind: 'tileflow-map-deployment' as const,
          schemaVersion: 1 as const,
          mapId: mapName,
          buildManifest,
          styles: family.styles,
          teamSources: family.teamSources,
          ...(resolved.view ? {view: resolved.view} : {}),
        };
      }

      return prepareTileflowHostedNativeDeployment({
        apiBaseUrl: apiUrl,
        mapId: mapName,
        buildManifest,
        styles: family.styles,
        teamSources: family.teamSources,
        assets,
        themes: Object.keys(resolved.themes),
        ...(resolved.view ? {view: resolved.view} : {}),
        // A loopback HTTP API serves local development; Hosted itself accepts only HTTPS.
        ...(apiUrl.startsWith('http:') ? {developmentOrigin: apiUrl} : {}),
      });
    };
    const preflight = await createArtifact(sprite ? {sprite} : {});
    const placed = teamModelSources(modelAssets, mapName);
    return {
      mapName,
      preflight,
      packages: compiledIcons.packages,
      ...(binding ? {iconBinding: binding} : {}),
      ...(compiledIcons.compositions[mapName]
        ? {iconComposition: compiledIcons.compositions[mapName]}
        : {}),
      ...(fontBundle ? {fontBundle} : {}),
      ...(placed ? {teamModelSources: placed} : {}),
      retarget: createArtifact,
      dispose: local.dispose,
    };
  } catch (error) {
    await local.dispose();
    throw error;
  }
}

/** What a Hosted deploy reports while it publishes. */
export type HostedDeployEvent =
  | Readonly<{
      kind: 'icon-package';
      label: string;
      icons: number;
      bytes: number;
      contentHash: string;
      changed: boolean;
    }>
  | Readonly<{
      kind: 'font-bundle';
      faces: number;
      bytes: number;
      contentHash: string;
      changed: boolean;
    }>
  | Readonly<{kind: 'publishing'; mapName: string; themes: number; bytes: number; native: boolean}>
  | HostedRendererDeploymentEvent;

export type HostedDeployOptions = Readonly<{
  /** The normalized API origin. */
  apiUrl: string;
  manifest: string;
  overwriteSelfHostedManifest?: boolean;
}>;

export type HostedDeployPorts = Readonly<{
  source: DeploySource;
  loadManifest(
    path: string,
    options: {overwriteSelfHosted: boolean},
  ): Promise<TileflowRuntimeManifest | null>;
  /**
   * The managed Map and a credential for it, after every local check: an existing `--map-id`, or a
   * Map created for this deploy. `null` after the port has said why there is none.
   */
  resolveTarget(
    input: Readonly<{mapName: string; existing: TileflowRuntimeManifest | null}>,
  ): Promise<HostedApi | null>;
  writeManifest(path: string, manifest: TileflowRuntimeManifest): Promise<string>;
  progress?(event: HostedDeployEvent): void;
  uploadIcon?: typeof uploadHostedIconPackage;
  uploadFont?: typeof uploadHostedFontBundle;
  request?: HostedRequestOptions;
  sleep?(milliseconds: number): Promise<unknown>;
}>;

/** One way native apps draw a map differently from the web, over the themes it applies to. */
export type NativeDifference = Readonly<{
  capability: TileflowNativeCapability;
  fallback: string;
  /** The affected themes, in declared order; every theme of the map when `all`. */
  themes: readonly string[];
  all: boolean;
}>;

export type HostedDeployResult = Readonly<{
  manifestPath: string;
  mapName: string;
  mapId: string;
  deploymentId: string;
  version: number;
  changed: boolean;
  entry: TileflowRuntimeManifestMapEntry;
  nativeManifestUrl?: string;
  nativeDifferences: readonly NativeDifference[];
  teamModels: NonNullable<TileflowRendererDeploymentResponse['teamModels']>;
}>;

/**
 * Publish the prepared renderer families to their managed Map, then write the frontend
 * manifest. Existing-manifest checks run before the target is resolved, uploads run only after
 * it, and a failure leaves the previous manifest in place. Repeating the same deploy resumes an
 * interrupted publication.
 */
export async function runHostedDeploy(
  prepared: PreparedHostedDeploy,
  options: HostedDeployOptions,
  ports: HostedDeployPorts,
): Promise<HostedDeployResult | null> {
  try {
    const apiOrigin = normalizeApiOrigin(options.apiUrl);
    let existing: TileflowRuntimeManifest | null;
    try {
      existing = await ports.loadManifest(options.manifest, {
        overwriteSelfHosted: options.overwriteSelfHostedManifest === true,
      });
    } catch (error) {
      throw new HostedDeploymentError(
        error instanceof Error ? error.message : 'Existing manifest is invalid.',
      );
    }
    const previousOrigin =
      existing?.apiUrl ?? (existing ? Object.values(existing.maps)[0]?.apiUrl : undefined);
    if (previousOrigin !== undefined && normalizeApiOrigin(previousOrigin) !== apiOrigin)
      throw new HostedDeploymentError(
        'Existing manifest belongs to a different Tileflow API origin.',
      );
    const api = await ports.resolveTarget({mapName: prepared.mapName, existing});
    if (!api) return null;
    if (
      normalizeApiOrigin(api.apiUrl) !== apiOrigin ||
      !api.mapId ||
      !/^map_[A-Za-z0-9_-]{16}$/u.test(api.mapId) ||
      !api.apiKey ||
      api.apiKey.length > 8192 ||
      /[\p{Cc}]/u.test(api.apiKey)
    )
      throw new HostedDeploymentError('Authorization did not confirm the requested API and Map.');
    const mapId = api.mapId;

    const sprites = new Map<string, string>();
    for (const icon of prepared.packages) {
      if (sprites.has(icon.contentHash)) continue;
      const uploaded = await transferred('Icon package upload', () =>
        (ports.uploadIcon ?? uploadHostedIconPackage)(api, icon, ports.request, true),
      );
      if (!uploaded.ok)
        throw new HostedDeploymentError(`Icon package upload failed: ${uploaded.status}.`, {
          resumable: uploaded.status >= 500,
          status: uploaded.status,
          failure: uploaded,
          operation: 'Icon package upload',
        });
      const expected = `${apiOrigin}/sprites/${uploaded.value.id}/sprite`;
      if (uploaded.value.contentHash !== icon.contentHash || uploaded.value.spriteUrl !== expected)
        throw new HostedDeploymentError(
          'Icon publication did not confirm the owned resource and origin.',
        );
      ports.progress?.({
        kind: 'icon-package',
        label:
          prepared.iconBinding?.packageHash === icon.contentHash
            ? prepared.iconBinding.label
            : 'Icons',
        icons: icon.manifest.iconNames.length,
        bytes: icon.manifest.files.reduce((total, file) => total + file.byteLength, 0),
        contentHash: icon.contentHash,
        changed: uploaded.value.changed !== false,
      });
      sprites.set(icon.contentHash, expected);
    }
    let fontBaseUrl: string | undefined;
    if (prepared.fontBundle) {
      const bundle = prepared.fontBundle;
      const uploaded = await transferred('Font bundle upload', () =>
        (ports.uploadFont ?? uploadHostedFontBundle)(api, bundle, ports.request, true),
      );
      if (!uploaded.ok)
        throw new HostedDeploymentError(`Font bundle upload failed: ${uploaded.status}.`, {
          resumable: uploaded.status >= 500,
          status: uploaded.status,
          failure: uploaded,
          operation: 'Font bundle upload',
        });
      if (new URL(uploaded.value.baseUrl).origin !== apiOrigin)
        throw new HostedDeploymentError(
          'Font bundle publication did not confirm the owned resource and origin.',
        );
      ports.progress?.({
        kind: 'font-bundle',
        faces: bundle.manifest.fontFaces.length,
        bytes: uploaded.value.totalBytes,
        contentHash: bundle.contentHash,
        changed: uploaded.value.changed !== false,
      });
      fontBaseUrl = uploaded.value.baseUrl;
    }

    const iconPackage = prepared.iconBinding
      ? prepared.packages.find((entry) => entry.contentHash === prepared.iconBinding!.packageHash)
      : undefined;
    const sprite = iconPackage ? sprites.get(iconPackage.contentHash) : undefined;
    const artifact = await prepared.retarget({
      ...(sprite ? {sprite} : {}),
      ...(fontBaseUrl ? {fontBaseUrl} : {}),
    });
    const preflightMap = webArtifact(prepared.preflight).buildManifest.maps[prepared.mapName];
    const build = webArtifact(artifact).buildManifest.maps[artifact.mapId];
    if (
      artifact.mapId !== prepared.mapName ||
      !build ||
      build.mapRevisionSha256 !== preflightMap?.mapRevisionSha256
    )
      throw new HostedDeploymentError('Authored map identity changed after preflight.');
    if (
      prepared.iconComposition &&
      prepared.iconComposition.packageHash !== iconPackage?.contentHash
    )
      throw new HostedDeploymentError(
        'Icon composition does not match the confirmed effective package.',
      );
    let split;
    try {
      split =
        artifact.schemaVersion === 1 ? undefined : await splitTileflowRendererDeployment(artifact);
    } catch {
      throw new HostedDeploymentError(
        'The map exceeds a Hosted deployment budget: 16 MiB for the web request, 8 MiB for each native document or 32 MiB for the native family.',
      );
    }
    const body = {
      artifact: split?.artifact ?? compactTileflowDeploymentArtifact(artifact),
      environment: prepared.mapName,
      managedMapId: mapId,
      usageMode: 'session',
      source: ports.source,
      ...(iconPackage && prepared.iconBinding
        ? {iconPackage: {contentHash: iconPackage.contentHash, label: prepared.iconBinding.label}}
        : {}),
      ...(prepared.iconComposition ? {iconComposition: prepared.iconComposition} : {}),
      ...(prepared.fontBundle ? {fontBundle: {contentHash: prepared.fontBundle.contentHash}} : {}),
      ...(prepared.teamModelSources ? {teamModelSources: prepared.teamModelSources} : {}),
    };
    const names = Object.keys(webArtifact(artifact).styles).sort();
    ports.progress?.({
      kind: 'publishing',
      native: split !== undefined,
      mapName: prepared.mapName,
      themes: names.length,
      bytes: new TextEncoder().encode(serializeCanonicalJson(body)).byteLength,
    });
    const publishOptions = {
      check: true,
      ...(ports.request ? {request: ports.request} : {}),
      ...(ports.progress ? {onProgress: ports.progress} : {}),
      ...(ports.sleep ? {sleep: ports.sleep} : {}),
    };
    const expectedNativeUrl = `${apiOrigin}/maps/${mapId}/native/manifest.json`;
    const result: Awaited<ReturnType<typeof publishHostedWebDeployment>> & {
      nativeManifestUrl?: string;
      teamModels?: TileflowRendererDeploymentResponse['teamModels'];
    } = split
      ? await publishHostedRendererDeployment(api, {body, split}, publishOptions).then(
          (published) => ({
            ...published,
            ...published.renderers.web,
            nativeManifestUrl: published.renderers.native.manifestUrl,
          }),
        )
      : await publishHostedWebDeployment(api, body, publishOptions);
    const {nativeManifestUrl} = result;
    if (
      result.mapId !== mapId ||
      nativeManifestUrl !== (split ? expectedNativeUrl : undefined) ||
      names.join('\0') !== Object.keys(result.themes).sort().join('\0')
    )
      throw new HostedDeploymentError(
        'The deployment did not confirm the requested Map and its complete theme family.',
      );
    if (
      result.familyUrl &&
      result.familyUrl !== `${apiOrigin}/maps/${mapId}/family/v${result.version}.json`
    )
      throw new HostedDeploymentError('The deployment returned an unexpected family route.');
    for (const name of names) {
      if (result.themes[name]!.styleUrl !== `${apiOrigin}/maps/${mapId}/${name}.json`)
        throw new HostedDeploymentError('The deployment returned an unexpected delivery route.');
    }

    const entry: TileflowRuntimeManifestMapEntry = {
      defaultTheme: build.defaultTheme,
      environment: prepared.mapName,
      mapId,
      ...(result.familyUrl ? {familyUrl: result.familyUrl} : {}),
      ...(build.systemThemes ? {systemThemes: build.systemThemes} : {}),
      ...(build.timeOfDay && Object.keys(build.timeOfDay).length
        ? {timeOfDay: build.timeOfDay}
        : {}),
      themes: Object.fromEntries(
        names.map((name) => {
          const deployed = result.themes[name]!;
          return [
            name,
            {
              colorScheme: build.themes[name]!.colorScheme,
              fontFaces: getTileflowStyleFontFaces(
                webArtifact(artifact).styles[name] as MapLibreStyle,
              ),
              revision: build.themes[name]!.styleSha256,
              ...(deployed.styleId ? {styleId: deployed.styleId} : {}),
              styleUrl: deployed.styleUrl,
            },
          ];
        }),
      ),
      ...(artifact.view ? {view: artifact.view} : {}),
      usageMode: 'session',
      worldGeneration: 'v1',
    };
    const maps = {...(existing?.maps ?? {}), [prepared.mapName]: entry};
    const manifest = parseTileflowRuntimeManifest({
      apiUrl: apiOrigin,
      maps,
      version: Object.values(maps).some((value) => value.familyUrl)
        ? 3
        : Object.values(maps).some((value) => value.timeOfDay)
          ? 2
          : 1,
    });
    const manifestPath = await ports.writeManifest(options.manifest, manifest);
    return Object.freeze({
      manifestPath,
      mapName: prepared.mapName,
      mapId,
      deploymentId: result.deploymentId,
      version: result.version,
      changed: result.changed,
      entry,
      ...(nativeManifestUrl ? {nativeManifestUrl} : {}),
      nativeDifferences:
        artifact.schemaVersion === 1
          ? []
          : summarizeNativeDifferences(artifact.renderers.native.family),
      teamModels: result.teamModels ?? [],
    });
  } finally {
    await prepared.dispose();
  }
}

/** An upload whose request did not complete can be repeated by running the same deploy. */
async function transferred<T>(label: string, upload: () => Promise<T>): Promise<T> {
  try {
    return await upload();
  } catch (error) {
    if (error instanceof HostedDeploymentError) throw error;
    const confirmed = error instanceof Error && /did not confirm/u.test(error.message);
    throw new HostedDeploymentError(confirmed ? error.message : `${label} did not complete.`, {
      resumable: !confirmed,
    });
  }
}

/** Each recorded native degradation once, with the themes it applies to, in first-seen order. */
export function summarizeNativeDifferences(family: TileflowNativeFamily): NativeDifference[] {
  const names = family.themes.map((theme) => theme.name);
  const byKey = new Map<
    string,
    {capability: TileflowNativeCapability; fallback: string; themes: string[]}
  >();
  for (const theme of family.themes) {
    for (const record of theme.degradations) {
      const key = `${record.feature}\0${record.fallback}`;
      const entry = byKey.get(key) ?? {
        capability: record.feature,
        fallback: record.fallback,
        themes: [],
      };
      if (!entry.themes.includes(theme.name)) entry.themes.push(theme.name);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].map((entry) => ({
    ...entry,
    themes: names.filter((name) => entry.themes.includes(name)),
    all: entry.themes.length === names.length,
  }));
}

/** A short, plain description of what native apps show for one difference. */
export function describeNativeDifference(difference: NativeDifference): string {
  switch (difference.capability) {
    case 'scene3d':
      return '3D building scene: drawn as plain building extrusions';
    case 'models3d':
      return 'Landmarks and building models: not drawn';
    case 'trees3d':
      return difference.fallback === 'flat'
        ? '3D trees: drawn as flat trees'
        : '3D trees: not drawn';
    case 'streetLights':
      return 'Street lights: not drawn';
    case 'terrain3d':
      return '3D terrain: drawn flat, with hillshading';
    case 'globe':
      return 'Globe: drawn in Web Mercator';
    case 'sky':
      return 'Sky, atmosphere and fog: not drawn';
    case 'deviceContours':
      return 'Contour lines and labels: not drawn';
    case 'pathGround':
      return 'Paths on green ground: drawn in their ground colour';
    case 'embeddedImages':
      return 'Images embedded in the style: not drawn';
    case 'nauticalLightRhythm':
      return 'Nautical light rhythms: lights shine steadily';
    case 'symbolOverlap':
      return 'Cooperative label overlap: drawn with allowed overlap';
    case 'reliefResampling':
      return "Relief resampling: the engine's default";
    case 'pitchAbove60':
      return 'Camera pitch: capped by the engine';
  }
}
