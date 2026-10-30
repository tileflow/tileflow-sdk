import {parseNativeUrl} from './native-url-provider';

/** Public selectors only; authority is acquired separately for each protected resource. */
export type TileflowMobileDiscovery = Readonly<{
  version: 1;
  mapId: string;
  deploymentVersion: number;
  representations: Readonly<
    Partial<Record<'native-v1' | 'webview-v1', Readonly<{manifestUrl: string}>>>
  >;
}>;

export const tileflowMobileDiscoveryMaximumBytes = 4096;

/** Bind every advertised representation to the exact Hosted origin and Map being requested. */
export function parseTileflowMobileDiscovery(
  value: unknown,
  discoveryUrl: string,
): TileflowMobileDiscovery {
  const fail = (): never => {
    throw new Error('Invalid mobile discovery.');
  };
  if (typeof discoveryUrl !== 'string' || discoveryUrl.length > 2048) return fail();
  const url = parseNativeUrl(discoveryUrl);
  const match = /^\/maps\/(map_[A-Za-z0-9_-]{16})\/mobile\/manifest\.json$/u.exec(url.pathname);
  if (!match || url.protocol !== 'https:' || discoveryUrl !== `${url.origin}${url.pathname}`)
    return fail();
  const record = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !== 'deploymentVersion,mapId,representations,version'
  )
    return fail();
  if (
    value.version !== 1 ||
    value.mapId !== match[1] ||
    !Number.isSafeInteger(value.deploymentVersion) ||
    Number(value.deploymentVersion) < 1 ||
    !record(value.representations)
  )
    return fail();
  const representations: Partial<Record<'native-v1' | 'webview-v1', {manifestUrl: string}>> = {};
  const entries = Object.entries(value.representations);
  if (!entries.length || entries.length > 2) fail();
  for (const [profile, representation] of entries) {
    if (profile !== 'native-v1' && profile !== 'webview-v1') return fail();
    if (!record(representation) || Object.keys(representation).join(',') !== 'manifestUrl')
      return fail();
    const path = profile === 'native-v1' ? 'native' : 'mobile/webview-v1';
    const expected = `${url.origin}/maps/${value.mapId}/${path}/manifest.json`;
    if (representation.manifestUrl !== expected) fail();
    representations[profile] = Object.freeze({manifestUrl: expected});
  }
  return Object.freeze({
    version: 1,
    mapId: value.mapId as string,
    deploymentVersion: Number(value.deploymentVersion),
    representations: Object.freeze(representations),
  });
}
