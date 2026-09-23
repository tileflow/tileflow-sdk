import {dirname} from 'node:path';
import {
  getTileflowStyleFontFaces,
  parseResolvedTileflowMap,
  serializeCanonicalJson,
  type MapLibreStyle,
} from '@tileflow/core';
import {
  createTileflowMapBuildManifest,
  parseTileflowRendererDeploymentArtifact,
  tileflowRendererDeploymentResponseSchema,
  type TileflowBuildCatalog,
  type TileflowRendererDeploymentArtifact,
} from '@tileflow/core/build';
import {parseTileflowRuntimeManifest, type TileflowRuntimeManifest} from '@tileflow/core/manifest';
import {
  createTileflowBuildProvenance,
  createTileflowStyles,
  prepareTileflowHostedNativeDeployment,
  prepareTileflowLocalTilesets,
} from '@tileflow/dev/artifacts';
import {
  assertValidTileflowConfig,
  getTileflowMapNames,
  loadTileflowConfigWithInputs,
} from '@tileflow/dev/config';
import {prepareTileflowStyleFonts} from '@tileflow/dev/fonts';
import {compileTileflowIconPackages, type CompiledTileflowIconPackage} from '@tileflow/dev/icons';
import {normalizeApiOrigin} from './account-session';
import {withTileflowConfigSecretsHidden} from './config-execution';
import type {DeploySource} from './deploy-source';
import {
  requestHostedJson,
  uploadHostedIconPackage,
  type HostedApi,
  type HostedRequestOptions,
} from './hosted-client';
import {
  inspectTileflowHostedCompatibility,
  prepareTileflowHostedThemeFamily,
} from './hosted-preflight';

type IconCompilation = Awaited<ReturnType<typeof compileTileflowIconPackages>>;
export type NativeHostedDeployOptions = Readonly<{
  apiUrl: string;
  config: string;
  manifest: string;
  mapId?: string;
  map?: string;
  cacheDir?: string;
  offline?: boolean;
  overwriteSelfHostedManifest?: boolean;
}>;
export type PreparedNativeDeploy = Readonly<{
  mapName: string;
  artifact: TileflowRendererDeploymentArtifact;
  packages: readonly CompiledTileflowIconPackage[];
  iconBinding?: IconCompilation['bindings'][number];
  iconComposition?: IconCompilation['compositions'][string];
  retarget(sprites: ReadonlyMap<string, string>): Promise<TileflowRendererDeploymentArtifact>;
  dispose(): Promise<void>;
}>;
type Ports = Readonly<{
  source: DeploySource;
  resolveApi(mapName: string): Promise<HostedApi | null>;
  loadManifest(
    path: string,
    options: {overwriteSelfHosted: boolean},
  ): Promise<TileflowRuntimeManifest | null>;
  writeManifest(path: string, manifest: TileflowRuntimeManifest): Promise<string>;
  prepare?(options: NativeHostedDeployOptions): Promise<PreparedNativeDeploy>;
  uploadIcon?: typeof uploadHostedIconPackage;
  request?: HostedRequestOptions;
}>;

function failure(message: string): Error {
  return Object.assign(new Error(message), {code: 'TF_NATIVE_DEPLOYMENT_INVALID'});
}
function requireNativeTarget(options: NativeHostedDeployOptions): {
  apiOrigin: string;
  mapId: string;
} {
  if (!options.mapId || !/^map_[A-Za-z0-9_-]{16}$/u.test(options.mapId))
    throw failure('--with-native requires one valid --map-id.');
  const apiOrigin = normalizeApiOrigin(options.apiUrl);
  if (!apiOrigin.startsWith('https://'))
    throw failure('Hosted Native deployment requires an HTTPS API origin.');
  return {apiOrigin, mapId: options.mapId};
}

/** Config and both renderer preflights complete without an authenticated remote-write capability. */
export async function prepareNativeHostedDeploy(
  options: NativeHostedDeployOptions,
): Promise<PreparedNativeDeploy> {
  const {apiOrigin} = requireNativeTarget(options);
  const loaded = await withTileflowConfigSecretsHidden(() =>
    loadTileflowConfigWithInputs(options.config),
  );
  assertValidTileflowConfig(loaded.project);
  const names = getTileflowMapNames(loaded.project);
  const mapName = options.map ?? (names.length === 1 ? names[0] : undefined);
  if (!mapName || !names.includes(mapName))
    throw failure('Select one configured map with --map for this Native deployment.');
  const map = loaded.project.maps[mapName]!;
  const project: TileflowBuildCatalog = {...loaded.project, maps: {[mapName]: map}};
  const baseDirectory = dirname(loaded.configFile);
  const compiledIcons = await compileTileflowIconPackages(project, {
    baseDirectory,
    cwd: process.cwd(),
    target: 'hosted',
    icons: {
      ...(options.cacheDir ? {cacheRoot: options.cacheDir} : {}),
      ...(options.offline ? {offline: true} : {}),
    },
  });
  const binding = compiledIcons.bindings.find((entry) => entry.mapName === mapName);
  const iconPackage = binding
    ? compiledIcons.packages.find((entry) => entry.contentHash === binding.packageHash)
    : undefined;
  const sprite = binding
    ? `${apiOrigin}/sprites/preflight/${binding.packageHash}/sprite`
    : undefined;
  const mapAssets = Object.fromEntries(
    compiledIcons.bindings.map((entry) => [
      entry.mapName,
      {
        icons: {
          ids: entry.iconIds,
          sprite: `${apiOrigin}/sprites/preflight/${entry.packageHash}/sprite`,
        },
      },
    ]),
  );
  const styles = createTileflowStyles(project, {apiBaseUrl: apiOrigin, mapAssets});
  const local = await prepareTileflowLocalTilesets(project, styles, {
    assetBaseUrl: apiOrigin,
    baseDirectory,
    cwd: process.cwd(),
  });
  try {
    const fonts = await prepareTileflowStyleFonts(project, local.styles, {
      assetBaseUrl: `${apiOrigin}/fonts/preflight`,
      baseDirectory,
      cwd: process.cwd(),
      target: 'hosted',
    });
    if (inspectTileflowHostedCompatibility(project, fonts.styles).length)
      throw failure('Hosted renderer deployment requires compatible Tileflow World sources.');
    // Preserve the existing Hosted web-font limitation; --with-native cannot bypass it.
    if (Object.keys(fonts.bundles).length)
      throw failure(
        'Hosted deploy does not yet support package-owned web fonts. Use an explicit public glyph provider.',
      );
    const assets = (iconPackage?.files ?? []).map((file) => ({
      contentType: file.contentType,
      fileName: `icons/${mapName}/${file.fileName}`,
      source: file.source,
    }));
    const provenance = await createTileflowBuildProvenance(process.cwd());
    const resolved = parseResolvedTileflowMap(map);
    const inputStyles: Record<string, MapLibreStyle> = JSON.parse(
      serializeCanonicalJson(fonts.styles[mapName]!),
    );
    const createArtifact = async (selectedSprite: string | undefined) => {
      const selected: Record<string, MapLibreStyle> = JSON.parse(
        serializeCanonicalJson(inputStyles),
      );
      if (binding) {
        if (!sprite || !selectedSprite) throw failure('Missing confirmed sprite binding.');
        for (const style of Object.values(selected)) {
          if (style.sprite !== sprite)
            throw failure('Compiled sprite identity changed before publication.');
          style.sprite = selectedSprite;
        }
      }
      const family = prepareTileflowHostedThemeFamily(mapName, map, selected);
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
            },
            styles: family.styles,
          },
        },
        {provenance},
      );
      return prepareTileflowHostedNativeDeployment({
        mapId: mapName,
        buildManifest,
        styles: family.styles,
        teamSources: family.teamSources,
        assets,
        ...(resolved.view ? {view: resolved.view} : {}),
      });
    };
    const artifact = await createArtifact(sprite);
    return {
      mapName,
      artifact,
      packages: compiledIcons.packages,
      ...(binding ? {iconBinding: binding} : {}),
      ...(compiledIcons.compositions[mapName]
        ? {iconComposition: compiledIcons.compositions[mapName]}
        : {}),
      async retarget(sprites) {
        // Same frozen compiled input, not another config evaluation. Only an owned sprite URL changes.
        return binding ? createArtifact(sprites.get(binding.packageHash)) : artifact;
      },
      dispose: local.dispose,
    };
  } catch (error) {
    await local.dispose();
    throw error;
  }
}

/** An opt-in sibling of schema-1 deploy, reusing its authorization, transport and atomic file ports. */
export async function runHostedNativeDeploy(options: NativeHostedDeployOptions, ports: Ports) {
  const {apiOrigin, mapId} = requireNativeTarget(options);
  const prepared = await (ports.prepare ?? prepareNativeHostedDeploy)({
    ...options,
    apiUrl: apiOrigin,
  });
  try {
    // Validate injected and production preparations identically before authentication or uploads.
    const preflight = await parseTileflowRendererDeploymentArtifact(prepared.artifact);
    if (preflight.mapId !== prepared.mapName)
      throw failure('The prepared map does not match its artifact.');
    const existing = await ports.loadManifest(options.manifest, {
      overwriteSelfHosted: options.overwriteSelfHostedManifest === true,
    });
    const previousOrigin =
      existing?.apiUrl ?? (existing ? Object.values(existing.maps)[0]?.apiUrl : undefined);
    if (previousOrigin !== undefined && normalizeApiOrigin(previousOrigin) !== apiOrigin)
      throw failure('Existing manifest belongs to a different Tileflow API origin.');
    const api = await ports.resolveApi(prepared.mapName);
    if (!api) return null;
    if (
      api.apiUrl !== apiOrigin ||
      api.mapId !== mapId ||
      !api.apiKey ||
      api.apiKey.length > 8192 ||
      /[\p{Cc}]/u.test(api.apiKey)
    )
      throw failure('Authorization did not confirm the requested API and Map.');
    const sprites = new Map<string, string>();
    for (const icon of prepared.packages) {
      if (sprites.has(icon.contentHash)) continue;
      let uploaded;
      try {
        uploaded = await (ports.uploadIcon ?? uploadHostedIconPackage)(api, icon, ports.request);
      } catch {
        throw failure('Native deployment icon upload failed. The local manifest was preserved.');
      }
      if (!uploaded.ok)
        throw failure('Native deployment icon upload failed. Retry the same artifact.');
      const expected = `${apiOrigin}/sprites/${uploaded.value.id}/sprite`;
      if (uploaded.value.contentHash !== icon.contentHash || uploaded.value.spriteUrl !== expected)
        throw failure('Icon publication did not confirm the owned resource and origin.');
      sprites.set(icon.contentHash, expected);
    }
    const artifact = await parseTileflowRendererDeploymentArtifact(
      await prepared.retarget(sprites),
    );
    if (
      artifact.mapId !== preflight.mapId ||
      artifact.renderers.web.buildManifest.maps[artifact.mapId]!.mapRevisionSha256 !==
        preflight.renderers.web.buildManifest.maps[preflight.mapId]!.mapRevisionSha256
    )
      throw failure('Authored map identity changed after preflight.');
    const iconPackage = prepared.iconBinding
      ? prepared.packages.find((entry) => entry.contentHash === prepared.iconBinding!.packageHash)
      : undefined;
    if (
      prepared.iconComposition &&
      prepared.iconComposition.packageHash !== iconPackage?.contentHash
    )
      throw failure('Icon composition does not match the confirmed effective package.');
    let response;
    try {
      response = await requestHostedJson(
        apiOrigin,
        '/v1/styles',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${api.apiKey}`,
            'X-Tileflow-Map-Id': mapId,
            'Content-Type': 'application/json',
          },
          body: serializeCanonicalJson({
            artifact,
            environment: prepared.mapName,
            managedMapId: mapId,
            usageMode: 'session',
            source: ports.source,
            ...(iconPackage && prepared.iconBinding
              ? {
                  iconPackage: {
                    contentHash: iconPackage.contentHash,
                    label: prepared.iconBinding.label,
                  },
                }
              : {}),
            ...(prepared.iconComposition ? {iconComposition: prepared.iconComposition} : {}),
          }),
        },
        ports.request,
      );
    } catch {
      throw failure(
        'Renderer deployment response was unavailable. Retry the same artifact; the local manifest was preserved.',
      );
    }
    if (!response.ok || !response.json)
      throw failure('Renderer deployment failed. The local manifest was preserved.');
    const parsed = tileflowRendererDeploymentResponseSchema.safeParse(response.body);
    if (!parsed.success)
      throw failure('Invalid renderer deployment response. The local manifest was preserved.');
    const result = parsed.data;
    const names = Object.keys(artifact.renderers.web.styles).sort();
    const expectedManifestUrl = `${apiOrigin}/maps/${mapId}/native/manifest.json`;
    if (
      result.mapId !== mapId ||
      result.renderers.native.manifestUrl !== expectedManifestUrl ||
      names.join('\0') !== Object.keys(result.renderers.web.themes).sort().join('\0') ||
      names.join('\0') !== Object.keys(result.renderers.native.themes).sort().join('\0')
    )
      throw failure(
        'Renderer deployment did not confirm the requested Map and complete theme families.',
      );
    for (const name of names) {
      if (
        result.renderers.web.themes[name]!.styleUrl !== `${apiOrigin}/maps/${mapId}/${name}.json` ||
        result.renderers.native.themes[name]!.styleUrl !==
          `${apiOrigin}/maps/${mapId}/native/v${result.version}/${name}.json`
      )
        throw failure('Renderer deployment returned an unexpected delivery route.');
    }
    const build = artifact.renderers.web.buildManifest.maps[artifact.mapId]!;
    const manifest = parseTileflowRuntimeManifest({
      apiUrl: apiOrigin,
      version: 1,
      maps: {
        ...(existing?.maps ?? {}),
        [prepared.mapName]: {
          defaultTheme: build.defaultTheme,
          environment: prepared.mapName,
          mapId,
          ...(build.systemThemes ? {systemThemes: build.systemThemes} : {}),
          ...(artifact.view ? {view: artifact.view} : {}),
          usageMode: 'session',
          worldGeneration: 'v1',
          themes: Object.fromEntries(
            names.map((name) => [
              name,
              {
                colorScheme: build.themes[name]!.colorScheme,
                fontFaces: getTileflowStyleFontFaces(
                  artifact.renderers.web.styles[name] as MapLibreStyle,
                ),
                revision: build.themes[name]!.styleSha256,
                ...result.renderers.web.themes[name],
              },
            ]),
          ),
        },
      },
    });
    const manifestPath = await ports.writeManifest(options.manifest, manifest);
    return Object.freeze({
      manifestPath,
      mapName: prepared.mapName,
      mapId,
      deploymentId: result.deploymentId,
      version: result.version,
      changed: result.changed,
      nativeManifestUrl: expectedManifestUrl,
    });
  } finally {
    await prepared.dispose();
  }
}
