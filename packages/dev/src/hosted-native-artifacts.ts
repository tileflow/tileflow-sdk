import {createHash} from 'node:crypto';
import {serializeCanonicalJson, type MapLibreStyle, type TileflowViewConfig} from '@tileflow/core';
import {
	inferTileflowDataRequirements,
	inferTileflowSourceRequirements,
	parseTileflowRendererDeploymentArtifact,
	type TileflowMapBuildManifestV1,
	type TileflowRendererDeploymentArtifact,
} from '@tileflow/core/build';
import {createTileflowNativeBuildRecord, TileflowNativeCompatibilityError,
	createTileflowNativeDiagnostic} from '@tileflow/core/native-profile';
import type {TileflowBuildAsset} from './icons';
import {lowerTileflowNativeCompiledStyles, prepareTileflowNativeStyles} from './native-artifacts';
import {finalizeNativeHostedProvenance} from './native-hosted-provenance';

type Input = Readonly<{
	mapId: string;
	buildManifest: TileflowMapBuildManifestV1;
	styles: Readonly<Record<string, MapLibreStyle>>;
	teamSources: Readonly<Record<string, Readonly<{tileset: string; type: 'raster' | 'vector'}>>>;
	assets: readonly TileflowBuildAsset[];
	view?: TileflowViewConfig;
}>;
const digest = (value: unknown) => createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
const invalidSource = () => new TileflowNativeCompatibilityError([
	createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_SOURCE', '/sources'),
]);

/**
 * Prepare both representations from the same already compiled, asset-bound web family.
 * This has no network or publication port. Call it before any authenticated remote operation.
 * Logical Hosted placeholders are validated syntactically without granting delivery authority.
 */
export async function prepareTileflowHostedNativeDeployment(input: Input): Promise<TileflowRendererDeploymentArtifact> {
	const webStyles: Record<string, MapLibreStyle> = JSON.parse(serializeCanonicalJson(input.styles));
	const validationStyles: Record<string, MapLibreStyle> = JSON.parse(serializeCanonicalJson(webStyles));
	for (const style of Object.values(validationStyles)) {
		for (const [sourceId, binding] of Object.entries(input.teamSources)) {
			const source = style.sources[sourceId];
			if (!source || source.type !== binding.type || source.url !== `tileflow://hosted-sources/${sourceId}` || source.tiles !== undefined)
				throw invalidSource();
			// This URL exists only during static validation. It is never serialized or fetched.
			source.url = `https://artifacts.invalid/tiles/${sourceId}/tiles.json`;
		}
	}
	const lowered = lowerTileflowNativeCompiledStyles({[input.mapId]: validationStyles});
	for (const transformation of lowered.transformations) {
		const name = transformation.theme;
		lowered.styles[input.mapId]![name] = finalizeNativeHostedProvenance(
			validationStyles[name]!, lowered.styles[input.mapId]![name]!, transformation.layers,
		);
	}
	const projected = prepareTileflowNativeStyles(lowered.styles, input.assets)[input.mapId]!;
	for (const [name, style] of Object.entries(projected)) {
		for (const sourceId of Object.keys(input.teamSources)) {
			const source = style.sources[sourceId];
			if (!source) throw invalidSource();
			source.url = `tileflow://hosted-sources/${sourceId}`;
		}
		if (serializeCanonicalJson(style.sources) !== serializeCanonicalJson(webStyles[name]!.sources)) throw invalidSource();
	}
	const nativeBuild: TileflowMapBuildManifestV1 = JSON.parse(serializeCanonicalJson(input.buildManifest));
	const mapBuild = nativeBuild.maps[input.mapId];
	if (!mapBuild) throw invalidSource();
	for (const [name, style] of Object.entries(projected)) {
		const theme = mapBuild.themes[name];
		if (!theme) throw invalidSource();
		mapBuild.themes[name] = {...theme,
			styleSha256: digest(style),
			dataRequirements: inferTileflowDataRequirements(style),
			sourceRequirements: inferTileflowSourceRequirements(style),
		};
	}
	const transformations = lowered.transformations.map((item) => ({...item,
		inputStyleSha256: digest(webStyles[item.theme]!),
		loweredStyleSha256: digest({...lowered.styles[input.mapId]![item.theme]!,
			sources: webStyles[item.theme]!.sources}),
	}));
	return parseTileflowRendererDeploymentArtifact({
		kind: 'tileflow-map-deployment', schemaVersion: 2, mapId: input.mapId,
		teamSources: input.teamSources,
		...(input.view ? {view: input.view} : {}),
		renderers: {
			web: {buildManifest: input.buildManifest, styles: webStyles},
			native: {buildManifest: nativeBuild,
				buildRecord: createTileflowNativeBuildRecord(digest(nativeBuild), transformations), styles: projected},
		},
	});
}
