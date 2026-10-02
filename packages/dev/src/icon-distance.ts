// Alpha EDT adapted from bitmap-sdf (MIT). See THIRD_PARTY_NOTICES.md.
const infinity = 1e20;

/** Fixed 24px logical cells: six transparent border pixels retain placement and halo room. */
export function createIconDistanceField(
  rgba: Uint8Array,
  width: number,
  height: number,
  ratio: 1 | 2,
): Uint8Array {
  if (width !== 24 * ratio || height !== 24 * ratio || rgba.length !== width * height * 4)
    throw new Error('SDF icons require a 24px logical cell at each density.');
  const outer = new Float64Array(width * height);
  const inner = new Float64Array(width * height);
  let occupied = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const alpha = rgba[index * 4 + 3]! / 255;
      if (
        alpha &&
        (x < 6 * ratio || y < 6 * ratio || x >= width - 6 * ratio || y >= height - 6 * ratio)
      )
        throw new Error(
          'SDF icons require six transparent pixels of padding inside the 24px cell. Add a transparent border to the source.',
        );
      occupied ||= alpha > 0;
      outer[index] = alpha === 1 ? 0 : alpha === 0 ? infinity : Math.max(0, 0.5 - alpha) ** 2;
      inner[index] = alpha === 1 ? infinity : alpha === 0 ? 0 : Math.max(0, alpha - 0.5) ** 2;
    }
  }
  if (!occupied) throw new Error('An SDF silhouette must contain visible pixels.');
  transform(outer, width, height);
  transform(inner, width, height);
  const result = new Uint8Array(rgba.length);
  for (let i = 0; i < outer.length; i++) {
    const distance = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
    const alpha = Math.round(255 * Math.max(0, Math.min(1, 0.75 - distance / (8 * ratio))));
    result.set([255, 255, 255, alpha], i * 4);
  }
  return result;
}

function transform(grid: Float64Array, width: number, height: number): void {
  const size = Math.max(width, height);
  const samples = new Float64Array(size);
  const result = new Float64Array(size);
  const sites = new Uint32Array(size);
  const bounds = new Float64Array(size + 1);

  const line = (length: number) => {
    let count = 0;
    sites[0] = 0;
    bounds[0] = -infinity;
    bounds[1] = infinity;
    for (let position = 1; position < length; position++) {
      let intersection: number;
      do {
        const site = sites[count]!;
        intersection =
          (samples[position]! + position ** 2 - samples[site]! - site ** 2) /
          (2 * (position - site));
        if (intersection > bounds[count]!) break;
        count--;
      } while (count >= 0);
      count++;
      sites[count] = position;
      bounds[count] = intersection;
      bounds[count + 1] = infinity;
    }
    count = 0;
    for (let position = 0; position < length; position++) {
      while (bounds[count + 1]! < position) count++;
      result[position] = (position - sites[count]!) ** 2 + samples[sites[count]!]!;
    }
  };

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) samples[y] = grid[y * width + x]!;
    line(height);
    for (let y = 0; y < height; y++) grid[y * width + x] = result[y]!;
  }
  for (let y = 0; y < height; y++) {
    samples.set(grid.subarray(y * width, (y + 1) * width));
    line(width);
    grid.set(result.subarray(0, width), y * width);
  }
}
