// The colour and shadow passes must draw the same trees, with the same mesh and density.
import type {TileflowTreeLevel} from './trees-3d-mesh';

export function tileflowTreeView(camera: {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  tileZoom: number;
}) {
  const n = 2 ** camera.tileZoom;
  const phi = (camera.lat * Math.PI) / 180;
  const centre = [
    ((camera.lng + 180) / 360) * n,
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n,
  ] as const;
  const tileMetres = (40_075_016.686 * Math.cos(phi)) / n;
  const far = Math.min(
    3000,
    Math.max(500, 900 * 2 ** (16 - camera.zoom) * (1 + camera.pitch / 90)),
  );
  const reach = [far * 0.7, far] as const;
  const base = camera.zoom >= 16.5 ? 15 : camera.zoom >= 16 ? 12 : camera.zoom >= 15.5 ? 9 : 7;
  return {
    centre,
    metres: tileMetres / 8192,
    reach,
    // Camera movement changes instance density, mesh selection and the per-tree fade.
    key: `${centre.join()}:${reach.join()}:${base}`,
    tile(x: number, y: number): {level: TileflowTreeLevel; rank: number} | undefined {
      const [cx, cy] = centre;
      const distance =
        Math.hypot(Math.max(x, Math.min(cx, x + 1)) - cx, Math.max(y, Math.min(cy, y + 1)) - cy) *
        tileMetres;
      if (distance > far) return undefined;
      const fall =
        distance > reach[0] ? Math.ceil(((distance - reach[0]) / (far - reach[0])) * 6) : 0;
      return {
        level: distance < reach[0] * 0.45 ? 'near' : 'far',
        rank: Math.max(2, Math.min(15, base - fall)),
      };
    },
  };
}
