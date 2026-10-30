// Bakes a level's sky visibility into a one-channel lightmap: its triangles are laid out flat in
// an atlas at the density a texel budget allows, and every texel averages the sky seen at several
// visible points inside it, so contact shade follows the surface instead of its vertices.
import {buildingModelAmbientSampler} from './building-model-occlusion';

type Geometry = {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly indices: readonly number[];
};

export type BuildingModelLightmapOptions = {
  /** The most texels the atlas may hold. */
  texels: number;
  /** How far, in metres, geometry still blocks the sky. */
  radius?: number;
  /** Rays per point; each texel samples a grid of points with turned ray patterns. */
  rays?: number;
  /** Points per texel along each axis; by default enough to sample every 0.35 m, two to four. */
  points?: number;
};

export type BuildingModelLightmap = {
  /** The source vertex of each output vertex; charts split vertices along their borders. */
  sources: number[];
  /** One output triangle per source triangle, in the same order and winding. */
  indices: number[];
  /** Two atlas coordinates, zero to one, per output vertex. */
  uvs: number[];
  width: number;
  height: number;
  /** Texels per metre. */
  density: number;
  /** Sky visibility, one byte a texel, rows from the top. */
  texels: Uint8Array;
};

type Chart = {
  triangles: number[];
  normal: number[];
  u: number[];
  v: number[];
  min: [number, number];
  extent: [number, number];
  w: number;
  h: number;
  x: number;
  y: number;
  /** Texels per metre along each side: the chart's edges fall on its edge texels' centres. */
  scale: [number, number];
  /** Under two texels both ways: it reads one uniform texel of the palette. */
  tiny?: boolean;
  /** The palette: one uniform texel for each of 256 grey levels. */
  palette?: boolean;
};

// A chart's edges fall on the centres of its edge texels, so filtering a chart never reads its
// neighbours and charts need no border. Charts under two texels cannot hold any gradient; they share
// a palette of uniform texels, one for each grey level, holding their mean.
const paletteSide = 16;
const maximumSide = 4096;

/** Undefined when even the coarsest density exceeds the budget. */
export function bakeBuildingModelLightmap(
  mesh: Geometry,
  {texels: budget, radius = 2, ...options}: BuildingModelLightmapOptions,
): BuildingModelLightmap | undefined {
  if (
    options.points !== undefined &&
    !(options.points >= 1 && options.points <= 4 && Number.isInteger(options.points))
  )
    throw new RangeError('A lightmap samples one to four points along each side of a texel.');
  const {positions, indices} = mesh;
  const point = (vertex: number) => [
    positions[vertex * 3]!,
    positions[vertex * 3 + 1]!,
    positions[vertex * 3 + 2]!,
  ];
  const charts = chartsOf(indices, point);
  const palette: Chart = {
    triangles: [],
    normal: [0, 0, 1],
    u: [1, 0, 0],
    v: [0, 1, 0],
    min: [0, 0],
    extent: [0, 0],
    scale: [0, 0],
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    palette: true,
  };
  charts.push(palette);
  let density = densityFor(charts, budget);
  if (density === undefined) return undefined;
  let layout = pack(charts, density);
  for (
    let attempt = 0;
    attempt < 12 && !(layout && layout.width * layout.height <= budget);
    attempt++
  ) {
    density *= 0.9;
    layout = pack(charts, density);
  }
  if (!layout || layout.width * layout.height > budget) return undefined;
  const {width, height} = layout;
  // Every point inside a texel and on its chart's triangles is sampled once, unless another surface
  // lies just in front of it and hides it.
  // A coarse texel spans mullions, recesses and glass; sampling it at only a few points would
  // pick some of them at random and leave the shade mottled. Points stay about 0.35 m apart, and
  // each takes fewer rays so a texel keeps about 48.
  const points = options.points ?? Math.min(4, Math.max(2, Math.ceil(1 / (density * 0.35))));
  const rays = options.rays ?? Math.max(4, Math.round(48 / (points * points)));
  const sampler = buildingModelAmbientSampler(mesh, {radius});
  const sums = new Float64Array(width * height);
  const counts = new Uint16Array(width * height);
  const taken = new Uint16Array(width * height);
  const hidden = Math.min(0.05, radius * 0.025);
  for (const chart of charts) {
    const local = (vertex: number) => {
      const p = point(vertex);
      return [
        (dot(chart.u, p) - chart.min[0]) * chart.scale[0] + 0.5,
        (dot(chart.v, p) - chart.min[1]) * chart.scale[1] + 0.5,
      ];
    };
    if (chart.tiny || chart.palette) continue;
    for (const triangle of chart.triangles) {
      const corners = [0, 1, 2].map((k) => local(indices[triangle * 3 + k]!));
      const [a, b, c] = corners as [number[], number[], number[]];
      const area = cross2(a, b, c);
      if (Math.abs(area) < 1e-12) continue;
      const [A, B, C] = [0, 1, 2].map((k) => point(indices[triangle * 3 + k]!)) as [
        number[],
        number[],
        number[],
      ];
      const rawNormal = crossOf(sub(B, A), sub(C, A));
      const facing = rawNormal.map((value) => value / (Math.hypot(...rawNormal) || 1));
      const x0 = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!)));
      const x1 = Math.min(chart.w - 1, Math.floor(Math.max(a[0]!, b[0]!, c[0]!)));
      const y0 = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!)));
      const y1 = Math.min(chart.h - 1, Math.floor(Math.max(a[1]!, b[1]!, c[1]!)));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const texel = (chart.y + y) * width + chart.x + x;
          for (let j = 0; j < points; j++)
            for (let i = 0; i < points; i++) {
              const bit = 1 << (j * points + i);
              if (taken[texel]! & bit) continue;
              const p = [x + (i + 0.5) / points, y + (j + 0.5) / points];
              const w0 = cross2(b, c, p) / area,
                w1 = cross2(c, a, p) / area,
                w2 = 1 - w0 - w1;
              if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
              taken[texel]! |= bit;
              const world = [0, 1, 2].map((axis) => w0 * A[axis]! + w1 * B[axis]! + w2 * C[axis]!);
              if (sampler.along(world, facing) < hidden) continue;
              // Neighbouring points turn their ray patterns, so their noise averages out.
              const turn =
                ((j * points + i) * 2.399963 + (x * 0.618034 + y * 0.381966) * 6.283185) % 6.283185;
              sums[texel]! += sampler.sky(world, facing, rays, turn);
              counts[texel]! += 1;
            }
        }
    }
  }

  // Empty texels take their neighbours' mean, growing out from every chart.
  const values = new Float32Array(width * height).fill(-1);
  for (let texel = 0; texel < values.length; texel++)
    if (counts[texel]) values[texel] = sums[texel]! / counts[texel]!;
  for (let level = 0; level < paletteSide * paletteSide; level++) {
    const x = palette.x + (level % paletteSide),
      y = palette.y + Math.floor(level / paletteSide);
    values[y * width + x] = level / 255;
  }
  // A tiny chart's level is its sky at its triangles' centres, weighted by area.
  const levels = new Map<Chart, number>();
  for (const chart of charts) {
    if (!chart.tiny) continue;
    let sum = 0,
      weight = 0;
    for (const triangle of chart.triangles) {
      const [a, b, c] = [0, 1, 2].map((k) => point(indices[triangle * 3 + k]!)) as [
        number[],
        number[],
        number[],
      ];
      const raw = crossOf(sub(b, a), sub(c, a));
      const area = Math.hypot(...raw) / 2;
      if (!(area > 0)) continue;
      const facing = raw.map((value) => value / (2 * area));
      const centre = [0, 1, 2].map((axis) => (a[axis]! + b[axis]! + c[axis]!) / 3);
      if (sampler.along(centre, facing) < hidden) continue;
      sum += area * sampler.sky(centre, facing, rays * points * points);
      weight += area;
    }
    levels.set(chart, Math.round((weight > 0 ? sum / weight : 1) * 255));
  }
  for (let pass = 0; pass < 3; pass++) {
    const previous = values.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (previous[y * width + x]! >= 0) continue;
        let sum = 0,
          count = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const value = previous[yy * width + xx]!;
          if (value >= 0) {
            sum += value;
            count++;
          }
        }
        if (count) values[y * width + x] = sum / count;
      }
  }
  const bytes = new Uint8Array(width * height);
  for (let texel = 0; texel < bytes.length; texel++)
    bytes[texel] = Math.round(
      Math.min(1, Math.max(0, values[texel]! < 0 ? 1 : values[texel]!)) * 255,
    );

  // Vertices are split where charts meet; triangles keep their order and winding.
  const sources: number[] = [];
  const uvs: number[] = [];
  const out = new Array<number>(indices.length);
  for (const chart of charts) {
    const own = new Map<number, number>();
    for (const triangle of chart.triangles)
      for (let k = 0; k < 3; k++) {
        const vertex = indices[triangle * 3 + k]!;
        let index = own.get(vertex);
        if (index === undefined) {
          index = sources.length;
          own.set(vertex, index);
          sources.push(vertex);
          const level = levels.get(chart);
          if (level !== undefined)
            uvs.push(
              (palette.x + (level % paletteSide) + 0.5) / width,
              (palette.y + Math.floor(level / paletteSide) + 0.5) / height,
            );
          else {
            const p = point(vertex);
            uvs.push(
              (chart.x + 0.5 + (dot(chart.u, p) - chart.min[0]) * chart.scale[0]) / width,
              (chart.y + 0.5 + (dot(chart.v, p) - chart.min[1]) * chart.scale[1]) / height,
            );
          }
        }
        out[triangle * 3 + k] = index;
      }
  }
  // Coordinates on a 1/65,536 grid, a sixteenth of a texel in the widest atlas, compress well.
  for (let at = 0; at < uvs.length; at++) uvs[at] = Math.round(uvs[at]! * 65_536) / 65_536;
  return {
    sources,
    indices: out,
    uvs,
    width,
    height,
    density,
    texels: bytes,
  };
}

// Charts grow across shared edges from the largest triangles, taking neighbours that face within
// 20 degrees of their seed; each is projected flat along its seed's normal. Curved facades and
// roofs made of many facets become one chart each, while folds such as window reveals split.
const chartCone = Math.cos((20 * Math.PI) / 180);

function chartsOf(indices: readonly number[], point: (vertex: number) => number[]): Chart[] {
  const key = (p: number[]) => p.map((value) => Math.round(value * 10_000)).join(',');
  const count = indices.length / 3;
  const normals: number[][] = [];
  const areas: number[] = [];
  const edges = new Map<string, number[]>();
  const edgeKeys: string[] = [];
  for (let triangle = 0; triangle < count; triangle++) {
    const [a, b, c] = [0, 1, 2].map((k) => point(indices[triangle * 3 + k]!)) as [
      number[],
      number[],
      number[],
    ];
    const normal = crossOf(sub(b, a), sub(c, a));
    const length = Math.hypot(...normal);
    areas.push(length / 2);
    normals.push(length > 1e-12 ? normal.map((value) => value / length) : [0, 0, 1]);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const [u, v] = [key(from), key(to)];
      const edge = u < v ? `${u}|${v}` : `${v}|${u}`;
      edgeKeys.push(edge);
      const users = edges.get(edge);
      if (users) users.push(triangle);
      else edges.set(edge, [triangle]);
    }
  }
  const owner = new Int32Array(count).fill(-1);
  const order = Array.from({length: count}, (_, i) => i).sort(
    (a, b) => areas[b]! - areas[a]! || a - b,
  );
  const charts: Chart[] = [];
  for (const seed of order) {
    if (owner[seed] !== -1) continue;
    const normal = normals[seed]!;
    const group = [seed];
    owner[seed] = seed;
    for (let at = 0; at < group.length; at++)
      for (let e = 0; e < 3; e++)
        for (const next of edges.get(edgeKeys[group[at]! * 3 + e]!)!)
          if (owner[next] === -1 && dot(normals[next]!, normal) >= chartCone) {
            owner[next] = seed;
            group.push(next);
          }
    charts.push(...flatCharts(group, normal, indices, point));
  }
  return charts;
}

// A chart laid along its longest edge; one its triangles fill less than half of, such as a curved
// strip lying in one plane, is halved across its length until its pieces fill their rectangles.
function flatCharts(
  group: number[],
  normal: number[],
  indices: readonly number[],
  point: (vertex: number) => number[],
  depth = 0,
): Chart[] {
  let longest = 0;
  let u = Math.abs(normal[2]!) < 0.9 ? [-normal[1]!, normal[0]!, 0] : [normal[2]!, 0, -normal[0]!];
  let area = 0;
  for (const triangle of group) {
    const [a, b, c] = [0, 1, 2].map((k) => point(indices[triangle * 3 + k]!)) as [
      number[],
      number[],
      number[],
    ];
    area += Math.hypot(...crossOf(sub(b, a), sub(c, a))) / 2;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const d = sub(to, from);
      const along = d.map((value, axis) => value - normal[axis]! * dot(d, normal));
      const length = Math.hypot(...along);
      if (length > longest) {
        longest = length;
        u = along;
      }
    }
  }
  const size = Math.hypot(...u) || 1;
  u = u.map((value) => value / size);
  const v = crossOf(normal, u);
  let [minU, minV, maxU, maxV] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const triangle of group)
    for (let k = 0; k < 3; k++) {
      const p = point(indices[triangle * 3 + k]!);
      minU = Math.min(minU, dot(u, p));
      maxU = Math.max(maxU, dot(u, p));
      minV = Math.min(minV, dot(v, p));
      maxV = Math.max(maxV, dot(v, p));
    }
  const flip = maxV - minV > maxU - minU;
  if (group.length > 1 && depth < 16 && area < 0.5 * (maxU - minU) * (maxV - minV)) {
    const axis = flip ? v : u;
    const centre = (triangle: number) =>
      [0, 1, 2].reduce((sum, k) => sum + dot(axis, point(indices[triangle * 3 + k]!)), 0) / 3;
    const sorted = [...group].sort((a, b) => centre(a) - centre(b) || a - b);
    const half = sorted.length >> 1;
    return [
      ...flatCharts(sorted.slice(0, half), normal, indices, point, depth + 1),
      ...flatCharts(sorted.slice(half), normal, indices, point, depth + 1),
    ];
  }
  // Charts lie landscape, so shelves of the skyline stay low.
  return [
    {
      triangles: group,
      normal,
      u: flip ? v : u,
      v: flip ? u : v,
      min: flip ? [minV, minU] : [minU, minV],
      extent: flip ? [maxV - minV, maxU - minU] : [maxU - minU, maxV - minV],
      scale: [0, 0],
      w: 0,
      h: 0,
      x: 0,
      y: 0,
    },
  ];
}

function sizeAt(chart: Chart, density: number): [number, number] {
  if (chart.palette) return [paletteSide, paletteSide];
  chart.tiny = chart.extent[0] * density < 2 && chart.extent[1] * density < 2;
  if (chart.tiny) return [0, 0];
  const size = chart.extent.map((extent) => Math.max(2, Math.round(extent * density) + 1)) as [
    number,
    number,
  ];
  chart.scale = [0, 1].map((axis) =>
    chart.extent[axis]! > 0 ? (size[axis]! - 1) / chart.extent[axis]! : 0,
  ) as [number, number];
  return size;
}

// The highest density whose charts, packed at about four fifths, fit the budget.
function densityFor(charts: readonly Chart[], budget: number): number | undefined {
  const area = (density: number) =>
    charts.reduce((sum, chart) => {
      const [w, h] = sizeAt(chart, density);
      return sum + w * h;
    }, 0);
  let low = 1 / 16,
    high = 64;
  if (area(low) / 0.8 > budget) return undefined;
  for (let step = 0; step < 24; step++) {
    const middle = Math.sqrt(low * high);
    if (area(middle) / 0.8 <= budget) low = middle;
    else high = middle;
  }
  return low;
}

// Skyline bottom-left packing into one atlas; the width with the least area wins.
function pack(charts: Chart[], density: number): {width: number; height: number} | undefined {
  for (const chart of charts) [chart.w, chart.h] = sizeAt(chart, density);
  const order = charts
    .map((_, i) => i)
    .sort((a, b) => charts[b]!.h - charts[a]!.h || charts[b]!.w - charts[a]!.w || a - b);
  let best: {width: number; height: number; places: [number, number][]} | undefined;
  for (let width = 64; width <= maximumSide; width *= 2) {
    let line = [{x: 0, y: 0, w: width}];
    const places: [number, number][] = new Array(charts.length);
    let fits = true;
    for (const index of order) {
      const chart = charts[index]!;
      if (chart.w === 0) {
        places[index] = [0, 0];
        continue;
      }
      if (chart.w > width) {
        fits = false;
        break;
      }
      let place: {x: number; y: number} | undefined;
      for (let i = 0; i < line.length; i++) {
        const x = line[i]!.x;
        if (x + chart.w > width) break;
        let y = 0,
          covered = 0;
        for (let j = i; j < line.length && covered < chart.w; j++) {
          y = Math.max(y, line[j]!.y);
          covered += line[j]!.w;
        }
        if (covered < chart.w) continue;
        if (!place || y < place.y) place = {x, y};
      }
      if (!place || place.y + chart.h > maximumSide) {
        fits = false;
        break;
      }
      places[index] = [place.x, place.y];
      const next: {x: number; y: number; w: number}[] = [];
      for (const segment of line) {
        const end = segment.x + segment.w;
        if (end <= place.x || segment.x >= place.x + chart.w) next.push(segment);
        else {
          if (segment.x < place.x) next.push({x: segment.x, y: segment.y, w: place.x - segment.x});
          if (end > place.x + chart.w)
            next.push({x: place.x + chart.w, y: segment.y, w: end - place.x - chart.w});
        }
      }
      next.push({x: place.x, y: place.y + chart.h, w: chart.w});
      next.sort((a, b) => a.x - b.x);
      line = [];
      for (const segment of next) {
        const last = line.at(-1);
        if (last && last.y === segment.y && last.x + last.w === segment.x) last.w += segment.w;
        else line.push({...segment});
      }
    }
    if (!fits) continue;
    const height = Math.max(...line.map((segment) => segment.y));
    if (!best || width * height < best.width * best.height) best = {width, height, places};
  }
  if (!best) return undefined;
  charts.forEach((chart, i) => ([chart.x, chart.y] = best.places[i]!));
  return {width: best.width, height: best.height};
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function sub(a: readonly number[], b: readonly number[]): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function crossOf(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function cross2(a: readonly number[], b: readonly number[], p: readonly number[]): number {
  return (b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!);
}
