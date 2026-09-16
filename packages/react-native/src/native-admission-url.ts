import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';
import type {HostedNativeSessionAuthority} from './session-controller';
import {nativeAdmissionLimits, nativeContextParameter, type NativeAdmissionResource} from './native-admission-contract';

const scopes = new Set(['style', 'tilejson', 'tile', 'sprite', 'glyph', 'font']);
export const isNativeToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,96}$/u.test(value) && !value.startsWith('tf_');

export function hasReservedNativeContext(url: string): boolean {
	const query = url.indexOf('?');
	if (query < 0) return false;
	return url.slice(query + 1).split('&').some((part) => {
		const key = part.split('=', 1)[0].replace(/%([0-9a-f]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
		return key.toLowerCase().startsWith('__tf_native');
	});
}

export function nativeResourceOrigin(url: string): string {
	const match = /^(https:\/\/[^/?#]+)\//u.exec(url);
	if (!match) throw new Error('Invalid native resource');
	return match[1];
}

export function normalizeNativeResources(input: readonly NativeAdmissionResource[]): readonly NativeAdmissionResource[] {
	if (!Array.isArray(input) || input.length > nativeAdmissionLimits.resources) throw new Error('Invalid native resource catalog');
	const seen = new Set<string>();
	return Object.freeze(input.map((resource) => {
		if (!resource || typeof resource.url !== 'string' || resource.url.length > nativeAdmissionLimits.urlCharacters - 128 ||
			!scopes.has(resource.scope) || hasReservedNativeContext(resource.url) ||
			/[^\x21-\x7e]|[\\#]/u.test(resource.url) || seen.has(resource.url) ||
			resolveTileflowNativeManifestUrl(resource.url) !== resource.url) throw new Error('Invalid native resource');
		const decoded = decodeURIComponent(resource.url);
		if (/tf_native_|tf_public_/iu.test(decoded)) throw new Error('Invalid native resource');
		nativeResourceOrigin(resource.url);
		if ((resource.scope === 'tile' || resource.scope === 'tilejson') && resource.tilesetId === undefined) throw new Error('Missing native tileset');
		if (resource.tilesetId !== undefined && (!/^[A-Za-z0-9._:-]{1,255}$/u.test(resource.tilesetId) || /tf_native_|tf_public_/iu.test(resource.tilesetId))) throw new Error('Invalid native tileset');
		seen.add(resource.url);
		return Object.freeze({url: resource.url, scope: resource.scope, ...(resource.tilesetId === undefined ? {} : {tilesetId: resource.tilesetId})});
	}));
}

export function authorityAllowsResource(authority: HostedNativeSessionAuthority, resource: NativeAdmissionResource, mapId: string): boolean {
	return authority.mapId === mapId && authority.resourceOrigins.includes(nativeResourceOrigin(resource.url)) &&
		authority.resourceScopes.includes(resource.scope) &&
		(resource.tilesetId === undefined || authority.tilesetIds.includes(resource.tilesetId));
}

export function discriminateNativeResourceForTest(url: string, context: string): string {
	if (!isNativeToken(context) || hasReservedNativeContext(url)) throw new Error('Invalid native context');
	const result = `${url}${url.includes('?') ? '&' : '?'}${nativeContextParameter}=${context}`;
	if (result.length > nativeAdmissionLimits.urlCharacters) throw new Error('Invalid native context');
	return result;
}
