import {createHash} from 'node:crypto';
import {type MapLibreStyle, serializeCanonicalJson, type TileflowViewConfig} from '@tileflow/core';
import {
  inferTileflowDataRequirements,
  inferTileflowSourceRequirements,
  parseTileflowRendererDeploymentArtifact,
  type TileflowMapBuildManifestV1,
  type TileflowRendererDeploymentArtifact,
} from '@tileflow/core/build';
import {
  createTileflowNativeBuildRecord,
  createTileflowNativeDiagnostic,
  createTileflowNativeFamily,
  TileflowNativeCompatibilityError,
} from '@tileflow/core/native-profile';
import type {TileflowBuildAsset} from './icons';
import {lowerTileflowNativeCompiledStyles, prepareTileflowNativeStyles} from './native-artifacts';

type Input = Readonly<{
  mapId: string;
  buildManifest: TileflowMapBuildManifestV1;
  styles: Readonly<Record<string, MapLibreStyle>>;
  teamSources: Readonly<Record<string, Readonly<{tileset: string; type: 'raster' | 'vector'}>>>;
  assets: readonly TileflowBuildAsset[];
  view?: TileflowViewConfig;
  /** The map's theme names in declared order, for the family document; sorted when omitted. */
  themes?: readonly string[];
  /**
   * An exact HTTP origin the styles may reference, for local development of the API on the
   * developer's own machine. Hosted publication itself accepts only HTTPS.
   */
  developmentOrigin?: string;
}>;
const digest = (value: unknown) =>
  createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
const invalidSource = () =>
  new TileflowNativeCompatibilityError([
    createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_SOURCE', '/sources'),
  ]);

/**
 * Prepare both representations from the same already compiled, asset-bound web family.
 * This has no network or publication port. Call it before any authenticated remote operation.
 * Logical Hosted placeholders are validated syntactically without granting delivery authority.
 */
export async function prepareTileflowHostedNativeDeployment(
  input: Input,
): Promise<TileflowRendererDeploymentArtifact> {
  const webStyles: Record<string, MapLibreStyle> = JSON.parse(serializeCanonicalJson(input.styles));
  const validationStyles: Record<string, MapLibreStyle> = JSON.parse(
    serializeCanonicalJson(webStyles),
  );
  for (const style of Object.values(validationStyles)) {
    for (const [sourceId, binding] of Object.entries(input.teamSources)) {
      const source = style.sources[sourceId];
      if (
        !source ||
        source.type !== binding.type ||
        source.url !== `tileflow://hosted-sources/${sourceId}` ||
        source.tiles !== undefined
      )
        throw invalidSource();
      // This URL exists only during static validation. It is never serialized or fetched.
      source.url = `https://artifacts.invalid/tiles/${sourceId}/tiles.json`;
    }
  }
  // Lowering already rebinds POI priorities and overlay anchors, exactly as for local artifacts.
  const policy = input.developmentOrigin ? {developmentOrigin: input.developmentOrigin} : {};
  const lowered = lowerTileflowNativeCompiledStyles({[input.mapId]: validationStyles}, policy);
  const projected = prepareTileflowNativeStyles(lowered.styles, input.assets, policy)[input.mapId]!;
  for (const [name, style] of Object.entries(projected)) {
    for (const sourceId of Object.keys(input.teamSources)) {
      const source = style.sources[sourceId];
      if (!source) throw invalidSource();
      source.url = `tileflow://hosted-sources/${sourceId}`;
    }
    // A native style keeps the web sources it draws, unchanged; it may only leave some out.
    if (
      serializeCanonicalJson(style.sources) !==
      serializeCanonicalJson(retainedSources(webStyles[name]!, style))
    )
      throw invalidSource();
  }
  const nativeBuild: TileflowMapBuildManifestV1 = JSON.parse(
    serializeCanonicalJson(input.buildManifest),
  );
  const mapBuild = nativeBuild.maps[input.mapId];
  if (!mapBuild) throw invalidSource();
  for (const [name, style] of Object.entries(projected)) {
    const theme = mapBuild.themes[name];
    if (!theme) throw invalidSource();
    mapBuild.themes[name] = {
      ...theme,
      styleSha256: digest(style),
      dataRequirements: inferTileflowDataRequirements(style),
      sourceRequirements: inferTileflowSourceRequirements(style),
    };
  }
  const transformations = lowered.transformations.map((item) => ({
    ...item,
    inputStyleSha256: digest(webStyles[item.theme]!),
    loweredStyleSha256: digest({
      ...lowered.styles[input.mapId]![item.theme]!,
      sources: retainedSources(webStyles[item.theme]!, projected[item.theme]!),
    }),
  }));
  const themes = input.themes ?? Object.keys(projected).sort();
  return parseTileflowRendererDeploymentArtifact(
    {
      kind: 'tileflow-map-deployment',
      schemaVersion: 2,
      mapId: input.mapId,
      teamSources: input.teamSources,
      ...(input.view ? {view: input.view} : {}),
      renderers: {
        web: {buildManifest: input.buildManifest, styles: webStyles},
        native: {
          buildManifest: nativeBuild,
          buildRecord: createTileflowNativeBuildRecord(digest(nativeBuild), transformations),
          family: createTileflowNativeFamily({map: input.mapId, themes, styles: projected}),
          styles: projected,
        },
      },
    },
    policy,
  );
}

/** The web style's sources that a native style still draws. */
function retainedSources(web: MapLibreStyle, native: MapLibreStyle): MapLibreStyle['sources'] {
  return Object.fromEntries(
    Object.entries(web.sources).filter(([id]) => Object.hasOwn(native.sources, id)),
  );
}
