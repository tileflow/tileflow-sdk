import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {canonicalMobileApiOrigin, NativeConfigurationError} from './mobile-configuration';
import {NativePreparationError} from './native-style-document';

type ReadySource = Extract<TileflowNativeSourceState, {status: 'ready'}>;
type Identity = Readonly<{mapId: string; apiOrigin: string; deploymentVersion: number}>;
const mapPattern = /^map_[A-Za-z0-9_-]{16}$/u;
const themePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const revisionPattern = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error();
	return value as Record<string, unknown>;
}
function field(value: unknown, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record(value), name);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !('value' in descriptor)) throw new Error();
	return descriptor.value;
}
function names(value: unknown, maximum: number): string[] {
	const keys = Reflect.ownKeys(record(value));
	if (!keys.length || keys.length > maximum || keys.some((key) => typeof key !== 'string'))
		throw new Error();
	return keys as string[];
}
function styleVersion(url: unknown, origin: string, mapId: string, theme: string): number {
	if (typeof url !== 'string' || url.length > 2048) throw new Error();
	const prefix = `${origin}/maps/${mapId}/native/v`;
	const suffix = `/${theme}.json`;
	if (!url.startsWith(prefix) || !url.endsWith(suffix)) throw new Error();
	const raw = url.slice(prefix.length, -suffix.length);
	if (!/^[1-9][0-9]{0,15}$/u.test(raw)) throw new Error();
	const version = Number(raw);
	if (!Number.isSafeInteger(version)) throw new Error();
	return version;
}

/**
 * Public metadata supplies selectors, never authority. Both actual document URLs must name the
 * canonical one-Map Hosted route. The application configuration separately approves this origin
 * before any credential can be used. Direct sources never evaluate this boundary.
 */
export function snapshotHostedNativeManifestIdentity(source: TileflowNativeSourceState): Identity | null {
	try {
		if (field(source, 'status') !== 'ready') throw new Error();
		const map = field(source, 'map');
		const mode = field(map, 'usageMode');
		if (mode === undefined) return null;
		if (mode !== 'session') throw new Error();
		const mapId = field(map, 'mapId');
		const name = field(map, 'name');
		const input = field(source, 'source');
		if (typeof mapId !== 'string' || !mapPattern.test(mapId) ||
			typeof name !== 'string' || !themePattern.test(name) || name !== field(input, 'map'))
			throw new Error();
		const apiOrigin = canonicalMobileApiOrigin(field(map, 'apiUrl'));
		const expected = `${apiOrigin}/maps/${mapId}/native/manifest.json`;
		// Do not accept query aliases, encoded path aliases, another Map, or a redirected CDN route.
		if (field(input, 'manifestUrl') !== expected || field(source, 'manifestUrl') !== expected)
			throw new Error();
		const manifest = field(source, 'manifest');
		const maps = field(manifest, 'maps');
		if (field(manifest, 'version') !== 1 || names(maps, 1)[0] !== name) throw new Error();
		const declared = field(maps, name);
		if (field(declared, 'mapId') !== mapId || field(declared, 'usageMode') !== 'session')
			throw new Error();
		const declaredApi = field(declared, 'apiUrl') ?? field(manifest, 'apiUrl');
		if (canonicalMobileApiOrigin(declaredApi) !== apiOrigin) throw new Error();
		const themes = field(map, 'themes');
		const declaredThemes = field(declared, 'themes');
		const themeNames = names(themes, 64).sort();
		if (themeNames.join('\0') !== names(declaredThemes, 64).sort().join('\0')) throw new Error();
		let deploymentVersion: number | undefined;
		for (const themeName of themeNames) {
			if (!themePattern.test(themeName)) throw new Error();
			const theme = field(themes, themeName);
			const original = field(declaredThemes, themeName);
			const revision = field(theme, 'revision');
			const styleUrl = field(theme, 'styleUrl');
			if (typeof revision !== 'string' || !revisionPattern.test(revision) ||
				revision !== field(original, 'revision') || styleUrl !== field(original, 'styleUrl'))
				throw new Error();
			const version = styleVersion(styleUrl, apiOrigin, mapId, themeName);
			if (deploymentVersion !== undefined && deploymentVersion !== version) throw new Error();
			deploymentVersion = version;
		}
		const selected = field(source, 'theme');
		const selectedName = field(selected, 'name');
		if (typeof selectedName !== 'string' || !themeNames.includes(selectedName)) throw new Error();
		const theme = field(themes, selectedName);
		if (field(selected, 'styleUrl') !== field(theme, 'styleUrl') ||
			field(selected, 'revision') !== field(theme, 'revision')) throw new Error();
		return Object.freeze({mapId, apiOrigin, deploymentVersion: deploymentVersion!});
	} catch {
		throw new NativeConfigurationError('NATIVE_CONFIGURATION_SOURCE_INVALID');
	}
}

/** Validate the protected response before projection or native renderer construction. */
export function assertHostedNativeStyleDocument(
	source: ReadySource,
	document: Readonly<{url: string; value: Readonly<Record<string, unknown>>}>,
): void {
	try {
		const identity = snapshotHostedNativeManifestIdentity(source);
		if (!identity) return;
		if (document.url !== source.theme.styleUrl) throw new Error();
		const metadata = field(document.value, 'metadata');
		if (field(metadata, 'tileflow:mapId') !== identity.mapId ||
			field(metadata, 'tileflow:theme') !== source.theme.name ||
			field(metadata, 'tileflow:deploymentVersion') !== identity.deploymentVersion ||
			field(metadata, 'tileflow:nativeStyleSha256') !== source.theme.revision) throw new Error();
	} catch {
		throw new NativePreparationError();
	}
}
