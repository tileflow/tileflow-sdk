// The meshes of Tileflow's 3D trees: one low-poly tree per form in two levels of detail, a near one
// of about a hundred triangles and a far one of about twenty. Each is a unit tree, standing from
// z 0 to 1 with its crown one unit wide, that the renderer stretches to a tree's height and crown.
// Crowns are clusters of faceted lobes, shaded between their facets and a round crown, so they read
// as drawn trees rather than as models. It has no DOM dependency.
import {type TileflowTreeForm, tileflowTreeForms} from './trees-3d';

/**
 * Bytes per vertex: position (3 floats), normal (3 signed bytes), part, then a lobe's shade (from 0
 * to 255 for -1 to 1) and occlusion (0 to 255), and 2 spare bytes.
 */
export const tileflowTreeVertexBytes = 20;

/** A part of a tree: bark, leaves, or palm fronds (leaves seen from both sides). */
export const tileflowTreeParts = {bark: 0, leaves: 1, fronds: 2} as const;

export type TileflowTreeLevel = 'near' | 'far';

export type TileflowTreeMesh = Readonly<{
  /** Unindexed triangles, `tileflowTreeVertexBytes` per vertex. */
  vertices: Uint8Array;
  /** Vertices in `vertices`. */
  count: number;
}>;

type Vec = [number, number, number];
type Builder = {
  positions: number[];
  normals: number[];
  parts: number[];
  shades: number[];
  occlusion: number[];
};

/** The meshes of every form, near and far. */
export function tileflowTreeMeshes(): Readonly<
  Record<TileflowTreeForm, Readonly<Record<TileflowTreeLevel, TileflowTreeMesh>>>
> {
  return Object.fromEntries(
    tileflowTreeForms.map((form) => [
      form,
      {near: pack(build(form, 'near')), far: pack(build(form, 'far'))},
    ]),
  ) as Record<TileflowTreeForm, Record<TileflowTreeLevel, TileflowTreeMesh>>;
}

function build(form: TileflowTreeForm, level: TileflowTreeLevel): Builder {
  const out: Builder = {positions: [], normals: [], parts: [], shades: [], occlusion: []};
  const near = level === 'near';
  switch (form) {
    case 'round': {
      trunk(out, 0.46, 0.036, 0.024, near ? 6 : 3);
      if (!near) {
        lobe(out, [0, 0, 0.68], [0.5, 0.5, 0.33], 1, 0, 0.36);
        break;
      }
      lobe(out, [0, 0, 0.66], [0.4, 0.4, 0.28], 1, 0.0, 0.36);
      for (let side = 0; side < 3; side += 1) {
        const angle = (side * Math.PI * 2) / 3 + 0.4;
        lobe(
          out,
          [Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0.6 + side * 0.02],
          [0.27, 0.27, 0.2],
          2 + side,
          side === 1 ? -0.5 : 0.4,
          0.36,
        );
      }
      lobe(out, [0.02, -0.02, 0.85], [0.24, 0.24, 0.15], 9, 0.7, 0.36);
      break;
    }
    case 'open': {
      trunk(out, 0.42, 0.04, 0.026, near ? 6 : 3);
      if (!near) {
        lobe(out, [0, 0, 0.64], [0.52, 0.52, 0.26], 1, 0, 0.38);
        break;
      }
      for (let side = 0; side < 4; side += 1) {
        const angle = (side * Math.PI) / 2 + 0.3;
        lobe(
          out,
          [Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, 0.58 + (side % 2) * 0.06],
          [0.28, 0.28, 0.16],
          3 + side,
          side % 2 ? -0.4 : 0.3,
          0.38,
        );
      }
      lobe(out, [0, 0, 0.74], [0.3, 0.3, 0.17], 8, 0.6, 0.38);
      break;
    }
    case 'tall': {
      trunk(out, 0.3, 0.032, 0.022, near ? 6 : 3);
      if (!near) {
        lobe(out, [0, 0, 0.64], [0.5, 0.5, 0.38], 1, 0, 0.24);
        break;
      }
      lobe(out, [0, 0, 0.46], [0.46, 0.46, 0.24], 4, -0.3, 0.24);
      lobe(out, [0.03, 0.02, 0.66], [0.42, 0.42, 0.22], 5, 0.2, 0.24);
      lobe(out, [-0.02, 0.01, 0.84], [0.3, 0.3, 0.17], 6, 0.6, 0.24);
      lobe(out, [0.1, -0.12, 0.56], [0.26, 0.26, 0.16], 7, -0.6, 0.24);
      break;
    }
    case 'conifer': {
      trunk(out, 0.22, 0.04, 0.03, near ? 6 : 3);
      if (!near) {
        cone(out, 0.12, 1, 0.5, 6, 0, true);
        break;
      }
      cone(out, 0.12, 0.56, 0.5, 8, -0.4, true);
      cone(out, 0.36, 0.8, 0.38, 8, 0.1, true);
      cone(out, 0.6, 1, 0.26, 8, 0.6, true);
      break;
    }
    case 'columnar': {
      trunk(out, 0.1, 0.06, 0.05, near ? 5 : 3);
      lathe(
        out,
        near ? [0.05, 0.22, 0.5, 0.78, 1] : [0.05, 0.4, 1],
        near ? [0.3, 0.48, 0.5, 0.32, 0] : [0.36, 0.5, 0],
        near ? 8 : 6,
        tileflowTreeParts.leaves,
        0,
      );
      break;
    }
    case 'palm': {
      palmTrunk(out, near ? 6 : 2, near ? 5 : 3);
      fronds(out, near ? 9 : 6, near ? 3 : 1);
      if (near) lobe(out, [0.08, 0, 0.9], [0.09, 0.09, 0.07], 3, -0.6, 0, 'octa');
      break;
    }
  }
  return out;
}

/** A tapered trunk with `sides` faces, from the ground to `top`. */
function trunk(out: Builder, top: number, base: number, tip: number, sides: number): void {
  for (let side = 0; side < sides; side += 1) {
    const a0 = (side * Math.PI * 2) / sides;
    const a1 = ((side + 1) * Math.PI * 2) / sides;
    const corner = (angle: number, radius: number, z: number): Vec => [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      z,
    ];
    const quad: Vec[] = [
      corner(a0, base, 0),
      corner(a1, base, 0),
      corner(a1, tip, top),
      corner(a0, tip, top),
    ];
    const normal = (angle: number): Vec => [Math.cos(angle), Math.sin(angle), 0.1];
    triangle(
      out,
      [quad[0]!, quad[1]!, quad[2]!],
      [normal(a0), normal(a1), normal(a1)],
      tileflowTreeParts.bark,
      0,
      [0.6, 0.6, 0.85],
    );
    triangle(
      out,
      [quad[0]!, quad[2]!, quad[3]!],
      [normal(a0), normal(a1), normal(a0)],
      tileflowTreeParts.bark,
      0,
      [0.6, 0.85, 0.85],
    );
  }
}

/**
 * A faceted lobe of leaves: an icosahedron (or an octahedron for distant trees) with its corners
 * pushed in and out, shaded half by its facets and half as a ball, darker underneath and towards
 * the trunk.
 */
function lobe(
  out: Builder,
  centre: Vec,
  radii: Vec,
  seed: number,
  shade: number,
  crownBase: number,
  shape: 'icosa' | 'octa' = 'icosa',
): void {
  const {corners, faces} = shape === 'icosa' ? icosahedron : octahedron;
  const pushed = corners.map((corner, index) => {
    const wobble = 1 + (fraction(seed * 12.9898 + index * 78.233) - 0.5) * 0.24;
    return [
      centre[0] + corner[0] * radii[0] * wobble,
      centre[1] + corner[1] * radii[1] * wobble,
      centre[2] + corner[2] * radii[2] * wobble,
    ] as Vec;
  });
  const round = corners.map(
    (corner) =>
      normalize([corner[0] / radii[0], corner[1] / radii[1], corner[2] / radii[2]]) as Vec,
  );
  for (const [a, b, c] of faces) {
    const points: [Vec, Vec, Vec] = [pushed[a]!, pushed[b]!, pushed[c]!];
    const outward = normalize(mix(mix(round[a]!, round[b]!, 0.5), round[c]!, 1 / 3));
    let facet = faceNormal(points);
    if (dot(facet, outward) < 0) facet = [-facet[0], -facet[1], -facet[2]];
    const normals = [a, b, c].map((index) => normalize(mix(facet, round[index]!, 0.5))) as [
      Vec,
      Vec,
      Vec,
    ];
    const occlusion = points.map((point) => {
      const height = smooth(crownBase, 1, point[2]);
      const outward = Math.min(1, Math.hypot(point[0], point[1]) / 0.45);
      return 0.5 + 0.32 * height + 0.18 * outward;
    }) as Vec;
    triangle(out, points, normals, tileflowTreeParts.leaves, shade, occlusion);
  }
}

/** A cone of needles from `z0` to `z1` with a base of `radius`, closed underneath. */
function cone(
  out: Builder,
  z0: number,
  z1: number,
  radius: number,
  sides: number,
  shade: number,
  closed: boolean,
): void {
  const tip: Vec = [0, 0, z1];
  const slope = radius / (z1 - z0);
  for (let side = 0; side < sides; side += 1) {
    const a0 = (side * Math.PI * 2) / sides;
    const a1 = ((side + 1) * Math.PI * 2) / sides;
    const wobble = (angle: number) => 1 + (fraction(angle * 43.1 + z0 * 7.7) - 0.5) * 0.18;
    const p0: Vec = [Math.cos(a0) * radius * wobble(a0), Math.sin(a0) * radius * wobble(a0), z0];
    const p1: Vec = [Math.cos(a1) * radius * wobble(a1), Math.sin(a1) * radius * wobble(a1), z0];
    const side0: Vec = normalize([Math.cos(a0), Math.sin(a0), slope]);
    const side1: Vec = normalize([Math.cos(a1), Math.sin(a1), slope]);
    const up: Vec = normalize([Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), slope]);
    const facet = faceNormal([p0, p1, tip]);
    triangle(
      out,
      [p0, p1, tip],
      [
        normalize(mix(facet, side0, 0.5)),
        normalize(mix(facet, side1, 0.5)),
        normalize(mix(facet, up, 0.5)),
      ],
      tileflowTreeParts.leaves,
      shade,
      [0.55 + 0.3 * z0, 0.55 + 0.3 * z0, 1],
    );
    if (closed)
      triangle(
        out,
        [p1, p0, [0, 0, z0 + (z1 - z0) * 0.15]],
        [
          [0, 0, -1],
          [0, 0, -1],
          [0, 0, -1],
        ],
        tileflowTreeParts.leaves,
        shade,
        [0.45, 0.45, 0.4],
      );
  }
}

/** A surface of revolution through rings at `heights` of `radii`, its normals from the profile. */
function lathe(
  out: Builder,
  heights: readonly number[],
  radii: readonly number[],
  sides: number,
  part: number,
  shade: number,
): void {
  for (let ring = 0; ring + 1 < heights.length; ring += 1) {
    const [z0, z1, r0, r1] = [heights[ring]!, heights[ring + 1]!, radii[ring]!, radii[ring + 1]!];
    const slope = (r0 - r1) / Math.max(1e-6, z1 - z0);
    for (let side = 0; side < sides; side += 1) {
      const a0 = (side * Math.PI * 2) / sides;
      const a1 = ((side + 1) * Math.PI * 2) / sides;
      const at = (angle: number, radius: number, z: number): Vec => [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z,
      ];
      const n = (angle: number): Vec => normalize([Math.cos(angle), Math.sin(angle), slope]);
      const o0 = 0.55 + 0.45 * z0;
      const o1 = 0.55 + 0.45 * z1;
      triangle(
        out,
        [at(a0, r0, z0), at(a1, r0, z0), at(a1, r1, z1)],
        [n(a0), n(a1), n(a1)],
        part,
        shade,
        [o0, o0, o1],
      );
      if (r1 > 0)
        triangle(
          out,
          [at(a0, r0, z0), at(a1, r1, z1), at(a0, r1, z1)],
          [n(a0), n(a1), n(a0)],
          part,
          shade,
          [o0, o1, o1],
        );
    }
  }
}

/** A palm's trunk, slender and leaning a little, in `rings` segments. */
function palmTrunk(out: Builder, rings: number, sides: number): void {
  const heights: number[] = [];
  const radii: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    heights.push(t * 0.9);
    radii.push(0.06 - t * 0.02);
  }
  const start = out.positions.length;
  lathe(out, heights, radii, sides, tileflowTreeParts.bark, 0);
  // Lean the trunk: each point moves along x with the square of its height.
  for (let at = start; at < out.positions.length; at += 3) {
    const z = out.positions[at + 2]!;
    out.positions[at] = out.positions[at]! + 0.08 * (z / 0.9) ** 2;
  }
}

/** A palm's fronds: strips that arch out from the top of the trunk and droop at their tips. */
function fronds(out: Builder, count: number, segments: number): void {
  const top: Vec = [0.08, 0, 0.9];
  for (let frond = 0; frond < count; frond += 1) {
    const angle = (frond * Math.PI * 2) / count + (frond % 2) * 0.2;
    const dir: Vec = [Math.cos(angle), Math.sin(angle), 0];
    const side: Vec = [-dir[1], dir[0], 0];
    const length = 0.5 * (0.85 + fraction(frond * 3.7) * 0.3);
    const lift = 0.1 + fraction(frond * 5.3) * 0.12;
    const spine: Vec[] = [];
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      spine.push([
        top[0] + dir[0] * length * t,
        top[1] + dir[1] * length * t,
        top[2] + lift * Math.sin(t * Math.PI * 0.6) - 0.32 * t * t,
      ]);
    }
    const widthAt = (t: number) => 0.09 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05));
    for (let step = 0; step < segments; step += 1) {
      const t0 = step / segments;
      const t1 = (step + 1) / segments;
      const a = spine[step]!;
      const b = spine[step + 1]!;
      const offset = (point: Vec, width: number, sign: number): Vec => [
        point[0] + side[0] * width * sign,
        point[1] + side[1] * width * sign,
        point[2] - Math.abs(width) * 0.35,
      ];
      const quad: Vec[] = [
        offset(a, widthAt(t0), -1),
        offset(b, widthAt(t1), -1),
        offset(b, widthAt(t1), 1),
        offset(a, widthAt(t0), 1),
      ];
      let facet = faceNormal([quad[0]!, quad[1]!, quad[2]!]);
      if (facet[2] < 0) facet = [-facet[0], -facet[1], -facet[2]];
      const normal = normalize(mix(facet, [0, 0, 1], 0.4));
      const occlusion: Vec = [0.75 + 0.25 * t0, 0.75 + 0.25 * t1, 0.75 + 0.25 * t1];
      const shade = frond % 3 === 0 ? -0.5 : frond % 3 === 1 ? 0.2 : 0.6;
      triangle(
        out,
        [quad[0]!, quad[1]!, quad[2]!],
        [normal, normal, normal],
        tileflowTreeParts.fronds,
        shade,
        occlusion,
      );
      triangle(
        out,
        [quad[0]!, quad[2]!, quad[3]!],
        [normal, normal, normal],
        tileflowTreeParts.fronds,
        shade,
        [occlusion[0], occlusion[2], occlusion[0]],
      );
    }
  }
}

function triangle(
  out: Builder,
  points: readonly [Vec, Vec, Vec],
  normals: readonly [Vec, Vec, Vec],
  part: number,
  shade: number,
  occlusion: readonly [number, number, number] | Vec,
): void {
  for (let index = 0; index < 3; index += 1) {
    out.positions.push(...points[index]!);
    out.normals.push(...normals[index]!);
    out.parts.push(part);
    out.shades.push(shade);
    out.occlusion.push(Math.min(1, Math.max(0, occlusion[index]!)));
  }
}

function pack(out: Builder): TileflowTreeMesh {
  const count = out.positions.length / 3;
  const bytes = new Uint8Array(count * tileflowTreeVertexBytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < count; index += 1) {
    const at = index * tileflowTreeVertexBytes;
    view.setFloat32(at, out.positions[index * 3]!, true);
    view.setFloat32(at + 4, out.positions[index * 3 + 1]!, true);
    view.setFloat32(at + 8, out.positions[index * 3 + 2]!, true);
    for (let axis = 0; axis < 3; axis += 1)
      view.setInt8(
        at + 12 + axis,
        Math.round(Math.max(-1, Math.min(1, out.normals[index * 3 + axis]!)) * 127),
      );
    bytes[at + 15] = out.parts[index]!;
    bytes[at + 16] = Math.round(((Math.max(-1, Math.min(1, out.shades[index]!)) + 1) / 2) * 255);
    bytes[at + 17] = Math.round(out.occlusion[index]! * 255);
  }
  return {vertices: bytes, count};
}

const golden = (1 + Math.sqrt(5)) / 2;
const icosahedron = {
  corners: (
    [
      [-1, golden, 0],
      [1, golden, 0],
      [-1, -golden, 0],
      [1, -golden, 0],
      [0, -1, golden],
      [0, 1, golden],
      [0, -1, -golden],
      [0, 1, -golden],
      [golden, 0, -1],
      [golden, 0, 1],
      [-golden, 0, -1],
      [-golden, 0, 1],
    ] as Vec[]
  ).map((corner) => normalize(corner) as Vec),
  faces: [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ] as [number, number, number][],
};
const octahedron = {
  corners: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as Vec[],
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ] as [number, number, number][],
};

function faceNormal([a, b, c]: readonly [Vec, Vec, Vec] | readonly Vec[]): Vec {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  return normalize([
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ]);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function normalize(v: readonly number[]): Vec {
  const size = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / size, v[1]! / size, v[2]! / size];
}

function mix(a: readonly number[], b: readonly number[], t: number): Vec {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function fraction(value: number): number {
  const s = Math.sin(value) * 43758.5453;
  return s - Math.floor(s);
}
