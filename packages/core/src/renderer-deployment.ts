import {z} from 'zod';
import {
	assertTileflowInteractionManifestLayers,
	type TileflowInteractionManifest,
} from './cartography/interaction-manifest';
import {tileflowIconCompositionSchema, tileflowRenderedIconIdentitySchema} from './icon-composition';
import {serializeCanonicalJson, sha256Hex} from './icon-package';
import {tileflowNativeBuildRecordSchema} from './native-build-record';
import {validateTileflowNativePreparedStyle} from './native-profile';
import {tileflowNativeProfileLimits} from './native-profile-helpers';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';
import {tileflowPoiCategories} from './types';

/** These are transport/validation bounds, not renderer or commercial quotas. */
export const tileflowRendererDeploymentLimits = Object.freeze({
	maximumBytes: 16 * 1024 * 1024,
	maximumNativeFamilyBytes: tileflowNativeProfileLimits.maximumStyleBytes,
	maximumThemes: 64,
});
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const recordSchema = z.record(z.string().min(1).max(256), z.unknown());
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sourceAssetsSchema = z.object({
	fonts: z.array(z.object({
		family: z.string().min(1).max(128), sha256: hashSchema,
		style: z.enum(['italic', 'normal', 'oblique']),
		weight: z.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900']),
	}).strict()).max(64),
	icons: z.array(z.union([
		z.object({format: z.enum(['jpeg', 'png', 'svg', 'webp']), id: tileflowPortableIdSchema,
			kind: z.enum(['icon', 'pattern']), sha256: hashSchema}).strict(),
		tileflowRenderedIconIdentitySchema,
	])).max(512),
	iconComposition: tileflowIconCompositionSchema.optional(),
}).strict();
const themeBuildSchema = z.object({
	colorScheme: z.enum(['dark', 'light']), dataRequirements: recordSchema,
	sourceRequirements: recordSchema, styleSha256: hashSchema,
	themeId: tileflowPortableIdSchema, themeVersion: positive,
}).strict();
const mapBuildSchema = z.object({
	assetSetSha256: hashSchema, defaultTheme: tileflowThemeNameSchema,
	lineage: z.array(z.object({id: tileflowPortableIdSchema, mapVersion: positive}).strict()).min(1).max(64),
	mapRevisionSha256: hashSchema, mapRevisionSchemaVersion: z.literal(2).optional(),
	mapVersion: positive,
	semanticCompiler: z.object({name: z.literal('tileflow-semantic'), version: z.literal(1)}).strict(),
	sourceAssets: sourceAssetsSchema,
	systemThemes: z.object({dark: tileflowThemeNameSchema, light: tileflowThemeNameSchema}).strict().optional(),
	themes: z.record(tileflowThemeNameSchema, themeBuildSchema),
}).strict();
const buildManifestSchema = z.object({
	schemaVersion: z.literal(1), maps: z.record(tileflowPortableIdSchema, mapBuildSchema),
	provenance: z.object({schemaVersion: z.literal(1),
		lockfile: z.object({format: z.enum(['bun', 'npm', 'pnpm', 'yarn']), sha256: hashSchema}).strict().optional(),
		packages: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
	}).strict().optional(),
}).strict();
const familyShape = {
	buildManifest: buildManifestSchema,
	styles: z.record(tileflowThemeNameSchema, recordSchema),
};
const teamSourcesSchema = z.record(tileflowPortableIdSchema, z.object({
	tileset: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
	type: z.enum(['raster', 'vector']),
}).strict()).superRefine((sources, context) => {
	const entries = Object.entries(sources);
	const tilesets = new Set<string>();
	if (entries.length > 16) context.addIssue({code: 'custom', message: 'Too many Team sources'});
	for (const [id, value] of entries) {
		if (id === 'tileflow' || id.startsWith('tileflow-') || ['world', 'terrain'].includes(value.tileset) || tilesets.has(value.tileset))
			context.addIssue({code: 'custom', message: 'Invalid logical Team source binding'});
		tilesets.add(value.tileset);
	}
});
const viewSchema = z.object({
	center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
	zoom: z.number().min(0).max(24).optional(),
	bearing: z.number().finite().optional(), pitch: z.number().min(0).max(85).optional(),
}).strict();

/** Explicit v2 only. Existing v1 envelopes and decoders are not extended by this schema. */
export const tileflowRendererDeploymentArtifactSchema = z.object({
	kind: z.literal('tileflow-map-deployment'), schemaVersion: z.literal(2),
	mapId: tileflowPortableIdSchema, teamSources: teamSourcesSchema,
	view: viewSchema.optional(),
	renderers: z.object({
		web: z.object(familyShape).strict(),
		native: z.object({...familyShape, buildRecord: tileflowNativeBuildRecordSchema}).strict(),
	}).strict(),
}).strict().superRefine((artifact, context) => {
	const fail = () => context.addIssue({code: 'custom', message: 'Renderer families must share one complete authored Map identity'});
	for (const family of [artifact.renderers.web, artifact.renderers.native]) {
		const names = Object.keys(family.buildManifest.maps);
		const map = family.buildManifest.maps[artifact.mapId];
		if (names.length !== 1 || names[0] !== artifact.mapId || !map) { fail(); continue; }
		const themes = Object.keys(map.themes).sort();
		if (!themes.length || themes.length > tileflowRendererDeploymentLimits.maximumThemes ||
			!equal(themes, Object.keys(family.styles).sort()) || !themes.includes(map.defaultTheme) ||
			map.lineage[0]?.id !== artifact.mapId || map.lineage[0]?.mapVersion !== map.mapVersion ||
			Boolean(map.sourceAssets.iconComposition) !== (map.mapRevisionSchemaVersion === 2)) fail();
		for (const scheme of ['light', 'dark'] as const) {
			if (map.systemThemes && map.themes[map.systemThemes[scheme]]?.colorScheme !== scheme) fail();
		}
	}
	const web = artifact.renderers.web.buildManifest;
	const native = artifact.renderers.native.buildManifest;
	if (!equal(authoredIdentity(web), authoredIdentity(native))) fail();
});
export type TileflowRendererDeploymentArtifact = z.infer<typeof tileflowRendererDeploymentArtifactSchema>;

export class TileflowRendererDeploymentError extends Error {
	readonly code = 'RENDERER_DEPLOYMENT_INVALID' as const;
	constructor() {
		super('Expected complete, bounded and consistent web and native deployment artifacts.');
		this.name = 'TileflowRendererDeploymentError';
	}
}

/** Hash/profile verification is deliberately separate from shape validation and server authority. */
export async function parseTileflowRendererDeploymentArtifact(input: unknown): Promise<TileflowRendererDeploymentArtifact> {
	try {
		const artifact = tileflowRendererDeploymentArtifactSchema.parse(input);
		const text = serializeCanonicalJson(artifact);
		if (new TextEncoder().encode(text).byteLength > tileflowRendererDeploymentLimits.maximumBytes ||
			/tf_(?:public|native|live)_/u.test(text)) throw new Error();
		const {web, native} = artifact.renderers;
		if (new TextEncoder().encode(serializeCanonicalJson(native)).byteLength > tileflowRendererDeploymentLimits.maximumNativeFamilyBytes)
			throw new Error();
		if (await sha256Hex(serializeCanonicalJson(native.buildManifest)) !== native.buildRecord.buildManifestSha256)
			throw new Error();
		const names = Object.keys(web.styles).sort();
		if (!equal(native.buildRecord.transformations.map((value) => `${value.map}/${value.theme}`), names.map((name) => `${artifact.mapId}/${name}`)))
			throw new Error();
		for (const name of names) {
			const webStyle = web.styles[name]!;
			const nativeStyle = native.styles[name]!;
			const webTheme = web.buildManifest.maps[artifact.mapId]!.themes[name]!;
			const nativeTheme = native.buildManifest.maps[artifact.mapId]!.themes[name]!;
			const transformation = native.buildRecord.transformations.find((value) => value.theme === name)!;
			const webHash = await sha256Hex(serializeCanonicalJson(webStyle));
			const nativeHash = await sha256Hex(serializeCanonicalJson(nativeStyle));
			if (webHash !== webTheme.styleSha256 || nativeHash !== nativeTheme.styleSha256 ||
				transformation.inputStyleSha256 !== webHash ||
				!Array.isArray(webStyle.layers) || !Array.isArray(nativeStyle.layers) ||
				transformation.inputLayers !== webStyle.layers.length || transformation.outputLayers !== nativeStyle.layers.length)
				throw new Error();
			if (validateTileflowNativePreparedStyle(nativeStyle, {
				documentUrl: `https://artifacts.invalid/native/styles/${artifact.mapId}/${name}.json`,
			}).length) throw new Error();
			// Representation lowering cannot introduce a different delivery graph or attribution.
			for (const field of ['sources', 'sprite', 'glyphs']) {
				if (!equal(webStyle[field], nativeStyle[field])) throw new Error();
			}
			for (const style of [webStyle, nativeStyle]) {
				const metadata = object(style.metadata);
				if (!metadata || metadata['tileflow:map'] !== artifact.mapId || metadata['tileflow:theme'] !== name ||
					metadata['tileflow:mapVersion'] !== web.buildManifest.maps[artifact.mapId]!.mapVersion ||
					metadata['tileflow:colorScheme'] !== webTheme.colorScheme ||
					['tileflow:deploymentId', 'tileflow:deploymentVersion', 'tileflow:mapId', 'tileflow:nativeStyleSha256'].some((key) => metadata[key] !== undefined))
					throw new Error();
			}
			if (!equal(semanticIdentity(webStyle), semanticIdentity(nativeStyle))) throw new Error();
		}
		return artifact;
	} catch {
		throw new TileflowRendererDeploymentError();
	}
}

function authoredIdentity(manifest: z.infer<typeof buildManifestSchema>) {
	return {...manifest, maps: Object.fromEntries(Object.entries(manifest.maps).map(([name, map]) => [name, {
		...map, themes: Object.fromEntries(Object.entries(map.themes).map(([theme, value]) => {
			const {styleSha256: _hash, ...identity} = value;
			return [theme, identity];
		})),
	}]))};
}
function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function equal(left: unknown, right: unknown): boolean {
	return left === undefined || right === undefined ? left === right : serializeCanonicalJson(left) === serializeCanonicalJson(right);
}
const artifactName = z.string().min(1).max(256).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const semanticSchema = z.object({version: z.literal(2), domains: z.object({poi: z.object({
	deduplication: z.object({identity: z.tuple([z.literal('source'), z.literal('source-layer'), z.literal('feature-id')]),
		representationPriority: z.tuple([z.literal('marker'), z.literal('icon'), z.literal('combined'), z.literal('label')]),
	}).strict(),
	fields: z.object({category: artifactName, filterRank: artifactName, icon: artifactName,
		name: artifactName, sizeRank: artifactName, type: artifactName}).strict(),
	hitTesting: z.object({frequency: z.literal('animation-frame'), order: z.literal('rendered-topmost')}).strict(),
	identity: z.literal('maplibre-feature-id-if-present'),
	layers: z.array(z.object({anchor: z.literal('pointer-coordinate'), category: z.enum(tileflowPoiCategories),
		layerId: artifactName, priority: z.number().int().min(0).max(4095),
		representation: z.enum(['combined', 'icon', 'label', 'marker']), source: artifactName, sourceLayer: artifactName,
	}).strict()).max(256),
}).strict().optional()}).strict()}).strict();
function semanticIdentity(style: Record<string, unknown>) {
	const candidate = object(style.metadata)?.['tileflow:interaction-manifest'];
	if (candidate === undefined) return undefined;
	const manifest = semanticSchema.parse(candidate);
	const layers = (style.layers as unknown[]).map((value) => {
		const layer = object(value);
		if (!layer) throw new Error();
		return layer;
	});
	assertTileflowInteractionManifestLayers(manifest as TileflowInteractionManifest, layers);
	const seen = new Set<string>();
	for (const layer of manifest.domains.poi?.layers ?? []) {
		if (seen.has(layer.layerId) || layers[layer.priority]?.id !== layer.layerId) throw new Error();
		seen.add(layer.layerId);
	}
	const poi = manifest.domains.poi;
	return poi ? {...poi, layers: poi.layers.map(({priority: _priority, ...identity}) => identity)} : manifest;
}

const mapIdSchema = z.string().regex(/^map_[A-Za-z0-9_-]{16}$/u);
const publicUrlSchema = z.string().min(1).max(2048).refine((value) => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
			url.toString() === value && !/tf_(?:public|native|live)_/u.test(value);
	} catch { return false; }
});
const webResponseTheme = z.object({styleId: z.string().min(1).max(128).optional(), styleUrl: publicUrlSchema}).strict();
const nativeResponseTheme = z.object({styleUrl: publicUrlSchema, revision: hashSchema}).strict();
export const tileflowRendererDeploymentResponseSchema = z.object({
	kind: z.literal('tileflow-map-deployment-result'), schemaVersion: z.literal(2), changed: z.boolean(),
	mapId: mapIdSchema, deploymentId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u), version: positive,
	worldConversionId: z.string().min(1).max(128).optional(),
	renderers: z.object({
		web: z.object({themes: z.record(tileflowThemeNameSchema, webResponseTheme)}).strict(),
		native: z.object({profile: z.literal('native-v1'), manifestUrl: publicUrlSchema,
			themes: z.record(tileflowThemeNameSchema, nativeResponseTheme)}).strict(),
	}).strict(),
}).strict().superRefine((value, context) => {
	const names = Object.keys(value.renderers.web.themes).sort();
	const native = value.renderers.native;
	const url = new URL(native.manifestUrl);
	if (!names.length || names.length > 64 || !equal(names, Object.keys(native.themes).sort()) ||
		url.pathname !== `/maps/${value.mapId}/native/manifest.json` ||
		names.some((name) => native.themes[name]!.styleUrl !== `${url.origin}/maps/${value.mapId}/native/v${value.version}/${name}.json`))
		context.addIssue({code: 'custom', message: 'Renderer response does not bind one complete deployment'});
});
export type TileflowRendererDeploymentResponse = z.infer<typeof tileflowRendererDeploymentResponseSchema>;
