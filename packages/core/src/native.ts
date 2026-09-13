/** URL resolution for native clients, without a renderer or an ambient application origin. */
export const tileflowNativeUrlLimits = Object.freeze({maximumLength: 2_048});

export type TileflowNativeNetworkOptions = {
	/** An exact HTTP development origin; never inferred from the device or environment. */
	developmentOrigin?: string;
};

export type TileflowNativeResourceUrlOptions = TileflowNativeNetworkOptions & {
	/** The absolute URL of the document declaring this resource, after any approved redirects. */
	documentUrl: string;
	/** Preserve supported placeholders in the path or query, without expanding them. */
	template?: 'tile' | 'glyphs';
};

export type TileflowNativeUrlErrorCode =
	| 'NATIVE_URL_INVALID'
	| 'NATIVE_URL_ABSOLUTE_REQUIRED'
	| 'NATIVE_URL_HTTPS_REQUIRED'
	| 'NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID'
	| 'NATIVE_URL_TEMPLATE_INVALID';

export type TileflowNativeUrlField =
	| 'manifestUrl'
	| 'documentUrl'
	| 'resourceUrl'
	| 'developmentOrigin';

const errorMessages: Record<TileflowNativeUrlErrorCode, string> = {
	NATIVE_URL_INVALID:
		'Expected a bounded HTTP(S) URL without credentials, fragments or backslashes.',
	NATIVE_URL_ABSOLUTE_REQUIRED: 'An explicit absolute HTTP(S) document URL is required.',
	NATIVE_URL_HTTPS_REQUIRED:
		'HTTP is allowed only at the explicitly configured development origin.',
	NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID:
		'Expected one HTTP origin without a path, credentials, query or fragment.',
	NATIVE_URL_TEMPLATE_INVALID:
		'Expected supported URL placeholders in the resource path or query only.',
};

/** Safe to report without exposing URL credentials, query parameters or filesystem paths. */
export class TileflowNativeUrlError extends TypeError {
	readonly code: TileflowNativeUrlErrorCode;
	readonly field: TileflowNativeUrlField;

	constructor(code: TileflowNativeUrlErrorCode, field: TileflowNativeUrlField) {
		super(errorMessages[code]);
		this.name = 'TileflowNativeUrlError';
		this.code = code;
		this.field = field;
	}
}

const tilePlaceholders = new Set(['z', 'x', 'y', 'ratio', 'quadkey', 'bbox-epsg-3857', 'prefix']);
const glyphPlaceholders = new Set(['fontstack', 'range']);
const absoluteHttpPattern = /^https?:\/\/[^/?#]+/iu;
const schemePattern = /^[a-z][a-z\d+.-]*:/iu;

/** Resolve a native manifest URL. There is intentionally no browser-relative default. */
export function resolveTileflowNativeManifestUrl(
	value: unknown,
	options: TileflowNativeNetworkOptions = {},
): string {
	const developmentOrigin = resolveDevelopmentOrigin(options.developmentOrigin);
	return resolveDocumentUrl(value, 'manifestUrl', developmentOrigin).href;
}

/**
 * Resolve a resource against its owning manifest, style or TileJSON document.
 * This checks URL policy only: it neither fetches resources nor authorizes requests.
 */
export function resolveTileflowNativeResourceUrl(
	value: unknown,
	options: TileflowNativeResourceUrlOptions,
): string {
	const developmentOrigin = resolveDevelopmentOrigin(options.developmentOrigin);
	const document = resolveDocumentUrl(options.documentUrl, 'documentUrl', developmentOrigin);
	assertUrlText(value, 'resourceUrl');
	if (
		options.template !== undefined &&
		options.template !== 'tile' &&
		options.template !== 'glyphs'
	) {
		throw new TileflowNativeUrlError('NATIVE_URL_TEMPLATE_INVALID', 'resourceUrl');
	}
	assertReferenceSyntax(value, 'resourceUrl', false);
	const authority = absoluteHttpPattern.exec(value)?.[0];
	if (authority && /[{}]/u.test(authority)) {
		throw new TileflowNativeUrlError('NATIVE_URL_TEMPLATE_INVALID', 'resourceUrl');
	}

	// Protect only literal placeholders. Already percent-encoded braces remain literal bytes.
	let prefix = '__tileflow_native_template_';
	while (value.includes(prefix) || document.href.includes(prefix)) prefix += '_';
	const placeholders: string[] = [];
	const allowed = options.template === 'tile' ? tilePlaceholders : glyphPlaceholders;
	const protectedValue = value.replace(/\{([^{}]*)\}/gu, (placeholder, name: string) => {
		if (!options.template || !allowed.has(name)) {
			throw new TileflowNativeUrlError('NATIVE_URL_TEMPLATE_INVALID', 'resourceUrl');
		}
		placeholders.push(placeholder);
		return `${prefix}${placeholders.length - 1}__`;
	});
	if (/[{}]/u.test(protectedValue)) {
		throw new TileflowNativeUrlError('NATIVE_URL_TEMPLATE_INVALID', 'resourceUrl');
	}

	const resolved = parseUrl(protectedValue, 'resourceUrl', document.href);
	assertTransport(resolved, 'resourceUrl', developmentOrigin);
	// URL parsing decodes host escapes; restore placeholders only outside that authority.
	const suffix = resolved.href.slice(resolved.origin.length).replace(
		new RegExp(`${prefix}(\\d+)__`, 'gu'),
		(match, index: string) => placeholders[Number(index)] ?? match,
	);
	const result = resolved.origin + suffix;
	assertUrlText(result, 'resourceUrl');
	return result;
}

function resolveDevelopmentOrigin(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	try {
		assertUrlText(value, 'developmentOrigin');
		const match = /^(http:\/\/[^/?#]+)\/?$/iu.exec(value);
		if (!match || /[{}@*]/u.test(match[1]!)) throw new Error();
		const url = parseUrl(value, 'developmentOrigin');
		if (url.protocol !== 'http:' || url.pathname !== '/' || url.search || url.hash) {
			throw new Error();
		}
		return url.origin;
	} catch {
		throw new TileflowNativeUrlError('NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID', 'developmentOrigin');
	}
}

function resolveDocumentUrl(
	value: unknown,
	field: 'manifestUrl' | 'documentUrl',
	developmentOrigin: string | undefined,
): URL {
	assertUrlText(value, field);
	assertReferenceSyntax(value, field, true);
	if (/[{}]/u.test(value)) throw new TileflowNativeUrlError('NATIVE_URL_TEMPLATE_INVALID', field);
	const url = parseUrl(value, field);
	assertTransport(url, field, developmentOrigin);
	assertUrlText(url.href, field);
	return url;
}

function assertUrlText(value: unknown, field: TileflowNativeUrlField): asserts value is string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > tileflowNativeUrlLimits.maximumLength ||
		value !== value.trim() ||
		/[\p{Cc}\\#]/u.test(value) ||
		/%(?![\da-f]{2})/iu.test(value)
	) {
		throw new TileflowNativeUrlError('NATIVE_URL_INVALID', field);
	}
}

function assertReferenceSyntax(
	value: string,
	field: TileflowNativeUrlField,
	absolute: boolean,
): void {
	if (value.startsWith('//')) {
		throw new TileflowNativeUrlError(
			absolute ? 'NATIVE_URL_ABSOLUTE_REQUIRED' : 'NATIVE_URL_INVALID',
			field,
		);
	}
	const authority = absoluteHttpPattern.exec(value)?.[0];
	if (schemePattern.test(value) && !authority) {
		throw new TileflowNativeUrlError('NATIVE_URL_INVALID', field);
	}
	if (absolute && !authority) {
		throw new TileflowNativeUrlError('NATIVE_URL_ABSOLUTE_REQUIRED', field);
	}
	if (authority?.includes('@')) throw new TileflowNativeUrlError('NATIVE_URL_INVALID', field);
}

function parseUrl(value: string, field: TileflowNativeUrlField, base?: string): URL {
	try {
		const url = base === undefined ? new URL(value) : new URL(value, base);
		if (!url.hostname || url.username || url.password || url.hash) throw new Error();
		return url;
	} catch {
		throw new TileflowNativeUrlError('NATIVE_URL_INVALID', field);
	}
}

function assertTransport(
	url: URL,
	field: TileflowNativeUrlField,
	developmentOrigin?: string,
): void {
	if (url.protocol === 'https:') return;
	if (url.protocol === 'http:' && url.origin === developmentOrigin) return;
	throw new TileflowNativeUrlError('NATIVE_URL_HTTPS_REQUIRED', field);
}
