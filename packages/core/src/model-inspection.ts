/** Bounded, read-only mesh snapshot for developer tooling. Positions are x east, y north, z up. */
export type TileflowModelInspection = Readonly<{
  id: string;
  module: string;
  format: string;
  vertices: number;
  triangles: number;
  bytes: number;
  lods: number;
  instances?: number;
  positions: number[];
  indices: number[];
  colors?: string[];
}>;

/** Keep real triangles, compacting only their referenced vertices for an inexpensive preview. */
export function inspectModelTriangles(
  indices: ArrayLike<number>,
  position: (index: number) => readonly number[],
  limit = 3000,
) {
  const positions: number[] = [],
    preview: number[] = [],
    remap = new Map<number, number>();
  const triangles = Math.floor(indices.length / 3),
    stride = Math.max(1, Math.ceil(triangles / limit));
  for (let triangle = 0; triangle < triangles; triangle += stride)
    for (let corner = 0; corner < 3; corner++) {
      const original = indices[triangle * 3 + corner]!;
      let index = remap.get(original);
      if (index === undefined) {
        index = positions.length / 3;
        remap.set(original, index);
        positions.push(...position(original));
      }
      preview.push(index);
    }
  return {positions, indices: preview};
}
