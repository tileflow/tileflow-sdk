import type {BuildingMeshGroup, TileflowBuildingMesh} from './buildings-3d-mesh';

/** Conservative homogeneous clip test: reject only when all eight corners miss the same plane. */
export function buildingBoxVisible(
  matrix: ArrayLike<number>,
  bounds: readonly [number, number, number, number, number, number],
): boolean {
  // Test the box's most positive point against each plane; no per-corner allocations.
  for (let axis = 0; axis < 3; axis += 1)
    for (const sign of [-1, 1]) {
      const a = matrix[3]! + sign * matrix[axis]!;
      const b = matrix[7]! + sign * matrix[axis + 4]!;
      const c = matrix[11]! + sign * matrix[axis + 8]!;
      const d = matrix[15]! + sign * matrix[axis + 12]!;
      const distance =
        a * bounds[a < 0 ? 0 : 3] + b * bounds[b < 0 ? 1 : 4] + c * bounds[c < 0 ? 2 : 5] + d;
      if (!Number.isFinite(distance)) return true;
      if (distance < -1e-7) return false;
    }
  return true;
}

/** Adjacent visible batches merge back into a single draw when the whole tile is visible. */
export function buildingDrawRanges(
  mesh: TileflowBuildingMesh,
  visible: (group: BuildingMeshGroup) => boolean,
  wallsOnly = false,
): {from: number; count: number}[] {
  if (!mesh.groups)
    return [
      {
        from: wallsOnly ? mesh.wallsFrom : 0,
        count: mesh.indices.length - (wallsOnly ? mesh.wallsFrom : 0),
      },
    ];
  const groups = mesh.groups.filter(visible);
  const ranges: {from: number; count: number}[] = [];
  const append = (from: number, count: number) => {
    if (!count) return;
    const last = ranges.at(-1);
    if (last && last.from + last.count === from) last.count += count;
    else ranges.push({from, count});
  };
  if (!wallsOnly) for (const group of groups) append(group.roofsFrom, group.roofsCount);
  for (const group of groups) append(group.wallsFrom, group.wallsCount);
  return ranges;
}

/** Limit rounded-corner tessellation by its CSS-pixel radius, including latitude and pitch. */
export function buildingCornerDetail(
  zoom: number,
  latitude = 40.42,
  radius = 0.8,
  pitch = 0,
  previous?: 0 | 1 | 2,
): 0 | 1 | 2 {
  // Very oblique views can magnify the foreground strongly: keep the authored tessellation.
  if (pitch > 70) return 2;
  const metresPerPixel =
    (40_075_016.686 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180))) / (512 * 2 ** zoom);
  const pixels = (radius / metresPerPixel) * (1 + Math.sin((Math.max(0, pitch) * Math.PI) / 180));
  // Hysteresis avoids repeatedly rebuilding tiles when zoom or latitude crosses a boundary.
  if (previous === 0 && pixels < 0.66) return 0;
  if (previous === 1 && pixels >= 0.54 && pixels < 3.3) return 1;
  if (previous === 2 && pixels >= 2.7) return 2;
  return pixels < 0.6 ? 0 : pixels < 3 ? 1 : 2;
}
