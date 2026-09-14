import type {TileflowRuntimeManifest} from './manifest';
import type {
	TileflowResolvedRuntimeTheme,
	TileflowRuntimeColorScheme,
	TileflowRuntimeManifestMap,
} from './runtime';
import type {TileflowNativeNetworkOptions} from './native-url-policy';

/** The adapter must honor the requested read bound, without first buffering an unbounded body. */
export type TileflowNativeManifestReader = {
	read(maximumBytes: number): Promise<
		| {done: true; value?: undefined}
		| {done: false; value: Uint8Array}
	>;
	cancel(): void | Promise<void>;
};

export type TileflowNativeManifestResponse = {
	/** Absolute final URL after redirects approved by the acquisition adapter. */
	url: string;
	status: number;
	reader: TileflowNativeManifestReader;
};

/** Cancellation must be available immediately, including before response headers arrive. */
export type TileflowNativeManifestOperation = {
	response: Promise<TileflowNativeManifestResponse>;
	cancel(): void | Promise<void>;
};

export type TileflowNativeManifestAcquire = (
	url: string,
	options: Readonly<{maximumBytes: number}>,
) => TileflowNativeManifestOperation;

/** No AbortController/EventTarget construction or reason inspection is required by Core. */
export type TileflowNativeAbortSignal = {
	readonly aborted: boolean;
	addEventListener(type: 'abort', listener: () => void, options?: {once?: boolean}): void;
	removeEventListener(type: 'abort', listener: () => void): void;
};

export type TileflowNativeManifestLoadOptions = TileflowNativeNetworkOptions & {
	acquire: TileflowNativeManifestAcquire;
	signal?: TileflowNativeAbortSignal;
};

export type TileflowNativeSource = {
	kind: 'tileflow';
	map: string;
	manifestUrl: string;
};

export type TileflowNativeSourceOptions = TileflowNativeNetworkOptions & {
	theme?: string;
	/** Required only for theme="system". Core never reads system appearance. */
	colorScheme?: TileflowRuntimeColorScheme;
	signal?: TileflowNativeAbortSignal;
};

type Immutable<T> = T extends object ? {readonly [K in keyof T]: Immutable<T[K]>} : T;

export type TileflowNativeManifestResult = {
	readonly manifestUrl: string;
	readonly manifest: Immutable<TileflowRuntimeManifest>;
};

export type TileflowNativeSourceState =
	| {readonly status: 'loading'; readonly generation: number}
	| ({readonly status: 'ready'; readonly generation: number;
		readonly source: Readonly<TileflowNativeSource>;
		readonly map: Immutable<TileflowRuntimeManifestMap>;
		readonly theme: Immutable<TileflowResolvedRuntimeTheme>;
	} & TileflowNativeManifestResult)
	| {readonly status: 'error'; readonly generation: number; readonly error: TileflowNativeSourceError};

export type TileflowNativeSourceController = {
	/** Undefined until the first replacement. Disposed controllers retain their last snapshot. */
	readonly state: TileflowNativeSourceState | undefined;
	replace(source: TileflowNativeSource, options?: TileflowNativeSourceOptions): Promise<void>;
	subscribe(listener: (state: TileflowNativeSourceState) => void): () => void;
	dispose(): void;
};

const messages = {
	NATIVE_SOURCE_INVALID: 'Expected an explicit Tileflow manifest source and portable map identity.',
	NATIVE_SOURCE_ABORTED: 'The manifest source operation was cancelled.',
	NATIVE_SOURCE_DISPOSED: 'The source controller has been disposed.',
	NATIVE_MANIFEST_URL_INVALID: 'Expected a safe absolute manifest URL and an exact development origin.',
	NATIVE_MANIFEST_REQUEST_FAILED: 'Manifest acquisition failed.',
	NATIVE_MANIFEST_RESPONSE_INVALID: 'Expected a bounded byte reader and an explicit final response URL.',
	NATIVE_MANIFEST_ACCESS_DENIED: 'Manifest access was denied.',
	NATIVE_MANIFEST_NOT_FOUND: 'The manifest was not found.',
	NATIVE_MANIFEST_TOO_LARGE: 'The manifest exceeds the 1 MiB limit.',
	NATIVE_MANIFEST_UTF8_INVALID: 'The manifest body is not valid UTF-8.',
	NATIVE_MANIFEST_JSON_INVALID: 'The manifest body is not valid JSON.',
	NATIVE_MANIFEST_INVALID: 'The manifest does not satisfy the version-1 runtime contract.',
	NATIVE_MANIFEST_RESOURCE_INVALID: 'A manifest resource URL is outside the native URL policy.',
	NATIVE_MAP_NOT_FOUND: 'The requested map is not declared by the manifest.',
	NATIVE_THEME_INVALID: 'Expected a declared concrete theme or an explicitly supplied system color scheme.',
} as const;

export type TileflowNativeSourceErrorCode = keyof typeof messages;
export type TileflowNativeSourceErrorField = 'source' | 'signal' | 'manifestUrl' | 'response' | 'body' | 'map' | 'theme';

/** Contains no body, URL, remote cause, parser details, or AbortSignal.reason. */
export class TileflowNativeSourceError extends Error {
	readonly code: TileflowNativeSourceErrorCode;
	readonly field: TileflowNativeSourceErrorField;
	readonly kind: 'terminal' | 'cancelled';

	constructor(code: TileflowNativeSourceErrorCode, field: TileflowNativeSourceErrorField) {
		super(messages[code]);
		this.name = 'TileflowNativeSourceError';
		this.code = code;
		this.field = field;
		this.kind = code === 'NATIVE_SOURCE_ABORTED' || code === 'NATIVE_SOURCE_DISPOSED' ? 'cancelled' : 'terminal';
	}
}

/** Never forward an exception object supplied by an acquisition adapter or observer. */
export function normalizeNativeSourceError(error: unknown): TileflowNativeSourceError {
	try {
		if (error instanceof TileflowNativeSourceError) {
			const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
			const field = Object.getOwnPropertyDescriptor(error, 'field')?.value;
			if (typeof code === 'string' && Object.hasOwn(messages, code) &&
				['source', 'signal', 'manifestUrl', 'response', 'body', 'map', 'theme'].includes(field)) {
				return new TileflowNativeSourceError(code as TileflowNativeSourceErrorCode, field);
			}
		}
	} catch { /* Do not inspect remote exception messages or causes. */ }
	return new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
}
