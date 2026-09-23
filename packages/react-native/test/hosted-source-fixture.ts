import type {TileflowNativeSourceState} from '@tileflow/core/native';

export type ReadyHostedSource = Extract<TileflowNativeSourceState, {status: 'ready'}>;

/** A public one-Map document and the exact Core resolution of that document. */
export function hostedSourceFixture(options: {
	mapId?: string;
	apiOrigin?: string;
	version?: number;
	revision?: string;
} = {}): ReadyHostedSource {
	const mapId = options.mapId ?? 'map_abcdefghijklmnop';
	const apiOrigin = options.apiOrigin ?? 'https://api.example.test';
	const version = options.version ?? 7;
	const manifestUrl = `${apiOrigin}/maps/${mapId}/native/manifest.json`;
	const theme = {
		colorScheme: 'light' as const,
		styleUrl: `${apiOrigin}/maps/${mapId}/native/v${version}/light.json`,
		revision: options.revision ?? 'a'.repeat(64),
	};
	// Core requires these delivery fields together, including when the document is public metadata.
	const map = {mapId, apiUrl: apiOrigin, usageMode: 'session' as const, worldGeneration: 'v1' as const,
		environment: 'streets', defaultTheme: 'light', themes: {light: theme}};
	return {
		status: 'ready', generation: 1,
		source: {map: 'streets', manifestUrl}, manifestUrl,
		manifest: {version: 1, apiUrl: apiOrigin, maps: {streets: map}},
		map: {name: 'streets', ...map}, theme: {name: 'light', ...theme},
	};
}

export function directSourceFixture(): ReadyHostedSource {
	const manifestUrl = 'https://self-hosted.example/manifest.json';
	const theme = {colorScheme: 'light' as const, styleUrl: 'https://self-hosted.example/light.json'};
	const map = {defaultTheme: 'light', themes: {light: theme}};
	return {
		status: 'ready', generation: 1,
		source: {map: 'streets', manifestUrl}, manifestUrl,
		manifest: {version: 1, maps: {streets: map}},
		map: {name: 'streets', ...map}, theme: {name: 'light', ...theme},
	};
}
