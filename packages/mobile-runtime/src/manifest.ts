import {
  parseTileflowMobileDiscovery,
  tileflowMobileDiscoveryMaximumBytes,
} from '@tileflow/core/native';
import {loadTileflowManifest, resolveTileflowManifestMap} from '@tileflow/core/runtime';
import {type InitializeOptions, ProtocolError} from './protocol';

/** Self-hosted sources remain direct manifests; Hosted sources select an explicit profile. */
export async function loadMobileManifest(
  source: InitializeOptions['source'],
  fetchResource: typeof fetch,
  signal: AbortSignal,
) {
  let manifestUrl = source.manifestUrl;
  let deploymentVersion: number | undefined;
  if (source.discoveryMapId) {
    const response = await fetchResource(manifestUrl, {signal});
    if (!response.ok || !response.body)
      throw new ProtocolError('resourceFailed', 'Mobile discovery is unavailable.');
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > tileflowMobileDiscoveryMaximumBytes)
          throw new ProtocolError('resourceFailed', 'Mobile discovery exceeds its limit.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const discovery = parseTileflowMobileDiscovery(
      JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer)),
      manifestUrl,
    );
    const representation = discovery.representations['webview-v1'];
    if (discovery.mapId !== source.discoveryMapId || !representation)
      throw new ProtocolError('resourceFailed', 'This Map has no webview-v1 representation.');
    manifestUrl = representation.manifestUrl;
    deploymentVersion = discovery.deploymentVersion;
  }
  const manifest = await loadTileflowManifest(manifestUrl, {
    fetch: fetchResource,
    cacheTtlMs: 0,
    signal,
  });
  if (manifest && deploymentVersion !== undefined) {
    const map = resolveTileflowManifestMap(manifest, source.map);
    const prefix = `${new URL(manifestUrl).origin}/maps/${source.discoveryMapId}/mobile/webview-v1/v${deploymentVersion}/`;
    if (
      !map ||
      map.mapId !== source.discoveryMapId ||
      Object.entries(map.themes).some(([name, theme]) => theme.styleUrl !== `${prefix}${name}.json`)
    ) {
      throw new ProtocolError(
        'resourceFailed',
        'The Map deployment changed during discovery. Reload the Map.',
      );
    }
  }
  return manifest;
}
