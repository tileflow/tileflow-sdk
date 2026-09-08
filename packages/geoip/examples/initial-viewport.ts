import {geolocate} from '../src/client';

export type InitialViewportCamera = {
  viewport: {center: [number, number]; zoom: number} | null;
  hasExplicitViewport(): boolean;
  hasUserInteracted(): boolean;
  setInitialViewport(viewport: {center: [number, number]; zoom: number}): void;
};

export async function applyOptionalGeoIpInitialViewport(
  camera: InitialViewportCamera,
  options: {apiUrl?: string; fetch?: typeof fetch; mapId: string; signal?: AbortSignal},
) {
  if (camera.hasExplicitViewport() || camera.hasUserInteracted()) return false;

  try {
    const result = await geolocate({
      apiUrl: options.apiUrl,
      fetch: options.fetch,
      mapId: options.mapId,
      signal: options.signal,
    });
    if (result.status !== 'available' || !result.location.position) return false;
    if (camera.hasExplicitViewport() || camera.hasUserInteracted()) return false;

    camera.setInitialViewport({center: result.location.position, zoom: 8});
    return true;
  } catch {
    return false;
  }
}

export async function runInitialViewportExample() {
  const camera: InitialViewportCamera = {
    viewport: null,
    hasExplicitViewport: () => false,
    hasUserInteracted: () => false,
    setInitialViewport(viewport) {
      this.viewport = viewport;
    },
  };
  await applyOptionalGeoIpInitialViewport(camera, {
    apiUrl: 'https://api.example.test',
    fetch: async () =>
      Response.json({
        location: {position: [-9.1393, 38.7223]},
        schemaVersion: 1,
        status: 'available',
        usage: {units: 1},
      }),
    mapId: 'map_1234567890abcdef',
  });
  return camera.viewport;
}
