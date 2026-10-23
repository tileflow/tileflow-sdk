// Original Streets tree artwork. Near/far glTF meshes and their top-down SVG crowns share
// one geometry description. Run `node packages/maps/assets/streets/build-trees.mjs [--check]`.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tau = Math.PI * 2;
const golden = Math.PI * (3 - Math.sqrt(5));
const add = (a, b) => a.map((n, i) => n + b[i]);
const mul = (v, n) => v.map((x) => x * n);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v) => mul(v, 1 / (Math.hypot(...v) || 1));
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const mesh = (material) => ({material, positions: [], normals: [], shades: [], indices: []});
function vertex(m, p, n, shade = 1) {
  m.positions.push(...p);
  m.normals.push(...unit(n));
  m.shades.push(shade);
  return m.shades.length - 1;
}
function face(m, a, b, c, outward) {
  const point = (i) => m.positions.slice(i * 3, i * 3 + 3);
  const normal = cross(sub(point(b), point(a)), sub(point(c), point(a)));
  if (dot(normal, outward) < 0) m.indices.push(a, c, b);
  else m.indices.push(a, b, c);
}

// Small irregular lobes, with a continuous normal field and a faceted silhouette. The
// variation is in the authored mesh, so it never shimmers or changes while the camera moves.
function crown(m, centre, radii, seed, far, farSides = 6) {
  const sides = far ? farSides : 7;
  const rings = far ? 2 : 4;
  const top = vertex(m, add(centre, [0, radii[1], 0]), [0, 1, 0], 1.07);
  const rows = [];
  for (let r = 1; r < rings; r++) {
    const latitude = (r / rings) * Math.PI;
    const row = [];
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * tau + seed * 0.7 + (r % 2) * 0.1;
      const ripple = 1 + 0.065 * Math.sin(angle * 3 + seed) + 0.035 * Math.cos(angle * 5 - seed);
      const n = [
        Math.sin(latitude) * Math.cos(angle),
        Math.cos(latitude),
        Math.sin(latitude) * Math.sin(angle),
      ];
      row.push(
        vertex(
          m,
          add(
            centre,
            n.map((v, i) => v * radii[i] * (i === 1 ? 1 : ripple)),
          ),
          n.map((v, i) => v / radii[i]),
          0.94 + 0.07 * n[1] + 0.025 * Math.sin(s * 2 + seed),
        ),
      );
    }
    rows.push(row);
  }
  const bottom = vertex(m, add(centre, [0, -radii[1], 0]), [0, -1, 0], 0.86);
  for (let s = 0; s < sides; s++) {
    const n = (s + 1) % sides;
    face(m, top, rows[0][s], rows[0][n], [0, 1, 0]);
    for (let r = 0; r + 1 < rows.length; r++) {
      const out = sub(m.positions.slice(rows[r][s] * 3, rows[r][s] * 3 + 3), centre);
      face(m, rows[r][s], rows[r + 1][s], rows[r + 1][n], out);
      face(m, rows[r][s], rows[r + 1][n], rows[r][n], out);
    }
    face(m, bottom, rows.at(-1)[n], rows.at(-1)[s], [0, -1, 0]);
  }
}

// Open foliage is a curved, two-sided blade with a raised midrib and drooping
// flanks. An ovate outline tapers to its tips, without a vertical, coin-like bevel.
function leafBlade(m, centre, radii, seed, far, tilt, shade) {
  const yaw = Math.atan2(centre[0], centre[2]) + Math.sin(seed * golden) * 0.22;
  const turn = ([x, y, z]) => {
    const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [x * Math.cos(yaw) + zz * Math.sin(yaw), yy, -x * Math.sin(yaw) + zz * Math.cos(yaw)];
  };
  const stations = far ? [-1, 0, 1] : [-1, -0.8, -0.45, 0, 0.45, 0.8, 1];
  const width = radii[2],
    length = radii[0];
  const rows = stations.map((t) => {
    const reach = Math.sqrt(1 - t * t) * (1 - t * 0.18);
    return (Math.abs(t) === 1 ? [0] : [-1, 0, 1]).map((s) => {
      const x = width * (s * reach + 0.08 * (1 - t * t));
      const z = length * t;
      const y =
        radii[1] * (1 - t * t) -
        length * (0.28 * t * t - 0.08 * t) -
        width * (0.28 * s * s * reach - 0.1 * s * t);
      return vertex(
        m,
        add(centre, turn([x, y, z])),
        turn([0.56 * s - 0.1 * t, 1, 0.65 * t - 0.08 - 0.1 * s]),
        shade * (1.02 - Math.abs(s) * 0.025),
      );
    });
  });
  const outward = turn([0, 1, 0]);
  for (let row = 0; row + 1 < rows.length; row++) {
    const a = rows[row],
      b = rows[row + 1];
    for (let flank = 0; flank < 2; flank++) {
      if (a.length === 1) face(m, a[0], b[flank], b[flank + 1], outward);
      else if (b.length === 1) face(m, a[flank], b[0], a[flank + 1], outward);
      else {
        face(m, a[flank], b[flank], b[flank + 1], outward);
        face(m, a[flank], b[flank + 1], a[flank + 1], outward);
      }
    }
  }
}

// Rounded ovoid crowns have smooth normals and an irregular low-poly silhouette.
function foliage(m, centre, radii, seed, far, {thin = false, tilt = 0, shade = 1} = {}) {
  if (thin) return leafBlade(m, centre, radii, seed, far, tilt, shade);
  const sides = far ? 8 : 10;
  const rings = far ? 2 : 6;
  const yaw = seed * golden;
  const turn = ([x, y, z]) => {
    const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [x * Math.cos(yaw) + zz * Math.sin(yaw), yy, -x * Math.sin(yaw) + zz * Math.cos(yaw)];
  };
  const point = (n) => add(centre, turn(n.map((v, axis) => v * radii[axis])));
  const top = vertex(m, point([0.08, 1, 0]), turn([0, 1, 0]), shade * 1.04);
  const bottom = vertex(m, point([-0.06, -1, 0.04]), turn([0, -1, 0]), shade * 0.94);
  const rows = [];
  for (let row = 1; row < rings; row++) {
    const latitude = (row * Math.PI) / rings;
    const y = Math.cos(latitude);
    const reach = Math.pow(Math.sin(latitude), 0.78);
    rows.push(
      Array.from({length: sides}, (_, side) => {
        const angle = (side * tau) / sides + seed * 0.32;
        const ripple = 1 + 0.07 * Math.sin(angle * 3 + seed) + 0.035 * Math.cos(angle * 5 - seed);
        const width = reach * ripple * (1 - y * 0.08);
        const x = Math.cos(angle) * width + y * 0.08;
        const z = Math.sin(angle) * width;
        const n = [
          (Math.cos(angle) * reach) / radii[0],
          y / radii[1],
          (Math.sin(angle) * reach) / radii[2],
        ];
        return vertex(m, point([x, y, z]), turn(n), shade * (0.98 + y * 0.04));
      }),
    );
  }
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    face(m, top, rows[0][side], rows[0][next], turn([0, 1, 0]));
    for (let row = 0; row + 1 < rows.length; row++) {
      const outward = turn([
        Math.cos((side * tau) / sides + seed * 0.32),
        0,
        Math.sin((side * tau) / sides + seed * 0.32),
      ]);
      face(m, rows[row][side], rows[row + 1][side], rows[row + 1][next], outward);
      face(m, rows[row][side], rows[row + 1][next], rows[row][next], outward);
    }
    face(m, bottom, rows.at(-1)[next], rows.at(-1)[side], turn([0, -1, 0]));
  }
}

function branch(m, from, to, base, tip, sides) {
  const axis = unit(sub(to, from));
  const u = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(axis, u);
  const rows = [from, to].map((p, r) =>
    Array.from({length: sides}, (_, s) => {
      const n = add(mul(u, Math.cos((s * tau) / sides)), mul(v, Math.sin((s * tau) / sides)));
      return vertex(
        m,
        add(p, mul(n, r ? tip : base)),
        n,
        0.94 + 0.06 * Math.cos((s * tau) / sides),
      );
    }),
  );
  for (let s = 0; s < sides; s++) {
    const n = (s + 1) % sides;
    const outward = sub(m.positions.slice(rows[0][s] * 3, rows[0][s] * 3 + 3), from);
    face(m, rows[0][s], rows[1][s], rows[1][n], outward);
    face(m, rows[0][s], rows[1][n], rows[0][n], outward);
  }
}

// Compact, upright and open trees have different branching architectures, not the
// same set of spheres stretched along an axis. Lobes carry a stable material shade.
const broadleaf = {
  round: [
    [-1.5, 6.9, 0.45, 2.25, 2.5, 2.0, -0.22, 1.05],
    [1.8, 6.15, 0.45, 2.05, 2.15, 1.8, 0.25, 0.82],
    [0.1, 7.7, -1.0, 2.0, 2.55, 1.85, 0.12, 1.13],
  ],
  tall: [
    [-0.55, 9.15, -0.25, 2.15, 3.3, 2.0, -0.1, 1.14],
    [1.8, 6.05, 0.5, 1.6, 1.75, 1.45, 0.32, 0.78],
    [-1.7, 5.45, 0.8, 1.45, 1.65, 1.4, -0.32, 0.91],
  ],
  open: [
    [-0.7, 8.1, -0.4, 1.3, 0.23, 1.05, 0.12, 1.13],
    [0.95, 7.9, -0.65, 1.45, 0.22, 1.15, 0.25, 1.08],
    [-2.0, 7.0, 0.65, 1.5, 0.22, 1.1, 0.55, 0.95],
    [0.1, 7.7, 1.15, 1.5, 0.24, 1.2, 0.38, 1.18],
    [2.0, 7.1, 0.3, 1.45, 0.2, 1.05, 0.6, 1.04],
    [-0.35, 7.3, -1.65, 1.35, 0.23, 1.15, 0.42, 1.0],
    [-1.85, 6.0, -0.65, 1.25, 0.24, 1.0, 0.85, 0.79],
    [1.65, 6.1, 1.0, 1.35, 0.22, 1.1, 0.9, 0.86],
    [-0.4, 6.6, 1.8, 1.2, 0.2, 1.0, 0.75, 0.93],
    [0.6, 6.2, -1.5, 1.3, 0.24, 1.0, 0.8, 0.75],
  ],
  conifer: [
    [-0.25, 10.1, 0.05, 1.05, 0.4, 0.95, 0.2, 1.14],
    [1.1, 8.8, -0.4, 1.5, 0.35, 1.15, -0.35, 1.06],
    [-1.35, 8.4, 0.25, 1.55, 0.35, 1.2, 0.45, 1.1],
    [0.1, 7.75, 1.4, 1.5, 0.3, 1.25, -0.3, 1.0],
    [-0.55, 7.35, -1.4, 1.55, 0.35, 1.25, 0.35, 0.98],
    [1.75, 6.4, 0.25, 1.65, 0.35, 1.25, -0.5, 0.88],
    [-1.85, 5.9, -0.25, 1.65, 0.35, 1.3, 0.45, 0.91],
    [0.35, 5.2, 1.65, 1.75, 0.3, 1.3, -0.6, 0.82],
    [-0.25, 4.8, -1.4, 1.65, 0.35, 1.2, 0.5, 0.8],
    [0, 6.7, 0.05, 1.25, 0.35, 1.1, -0.2, 0.95],
  ],
};

function deciduous(form, far) {
  const bark = mesh('bark');
  const thin = form === 'open' || form === 'conifer';
  const leaves = mesh(thin ? 'fronds' : 'leaves');
  const upright = form === 'tall' || form === 'conifer';
  const foot = [0, 0, 0];
  const waist = [0.08, 0.9, -0.02];
  const fork = [upright ? -0.18 : 0.16, upright ? 3.5 : 3.2, -0.08];
  const trunkSides = far ? 3 : 6;
  branch(bark, foot, waist, upright ? 0.47 : 0.55, 0.33, trunkSides);
  branch(bark, waist, fork, 0.33, 0.26, trunkSides);
  const limbs = thin
    ? [
        [-1.0, 7.3, 0.15],
        [1.1, 6.65, -0.25],
        [0.25, 5.0, 0.7],
      ]
    : broadleaf[form].map((lobe) => lobe.slice(0, 3));
  for (const [i, end] of limbs.entries()) {
    const elbow = add(fork, mul(sub(end, fork), 0.52));
    elbow[0] += i === 1 ? 0.18 : -0.15;
    if (far) branch(bark, fork, end, 0.21, 0.055, 3);
    else {
      branch(bark, fork, elbow, 0.24 - i * 0.035, 0.14, 4);
      branch(bark, elbow, end, 0.14, 0.045, 4);
    }
  }
  for (const [i, lobe] of broadleaf[form].entries()) {
    const centre = lobe.slice(0, 3);
    if (thin && !far) {
      const limb = limbs[i % limbs.length];
      const start = add(
        fork,
        mul(sub(limb, fork), Math.min(1, (centre[1] - fork[1]) / (limb[1] - fork[1]))),
      );
      branch(bark, start, centre, 0.1, 0.025, 3);
    }
    foliage(leaves, centre, lobe.slice(3, 6), i + form.length, far, {
      thin,
      tilt: lobe[6],
      shade: lobe[7],
    });
  }
  return [bark, leaves];
}

function evergreen(form, far) {
  const bark = mesh('bark');
  const leaves = mesh('leaves');
  const column = form === 'columnar';
  branch(bark, [0, 0, 0], [0, 8, 0], column ? 0.17 : 0.23, 0.06, far ? 4 : 6);
  const tiers = far ? 3 : column ? 5 : 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = column ? 1.35 - t * 0.65 : 3.2 - t * 2.4;
    const y = (column ? 3.5 : 3) + t * (column ? 7.4 : 7);
    if (column)
      crown(
        leaves,
        [0.12 * Math.sin(i * 2), y, 0.1 * Math.cos(i)],
        [radius, 2.1 - t * 0.7, radius],
        i + 2,
        far,
      );
    else {
      const sides = far ? 6 : 9;
      const top = vertex(leaves, [0, y + 2.6, 0], [0, 1, 0], 1.06);
      const bottom = vertex(leaves, [0, y - 0.25, 0], [0, -1, 0], 0.86);
      const ring = Array.from({length: sides}, (_, s) => {
        const a = (s * tau) / sides + i * golden;
        const r = radius * (1 + 0.07 * Math.sin(s * 3 + i));
        return vertex(
          leaves,
          [Math.cos(a) * r, y + 0.12 * Math.sin(s * 2), Math.sin(a) * r],
          [Math.cos(a), 0.45, Math.sin(a)],
          0.94 + 0.03 * Math.sin(s),
        );
      });
      for (let s = 0; s < sides; s++) {
        const n = (s + 1) % sides;
        face(leaves, top, ring[s], ring[n], [
          Math.cos((s * tau) / sides + i * golden),
          1,
          Math.sin((s * tau) / sides + i * golden),
        ]);
        face(leaves, bottom, ring[n], ring[s], [0, -1, 0]);
      }
    }
  }
  return [bark, leaves];
}

function palm(form, far) {
  const fan = form === 'palm-fan';
  const stem = mesh('stem');
  const leaves = mesh('leaves');
  const fronds = mesh('fronds');
  const height = fan ? 8.2 : 12;
  const sections = far ? 2 : 6;
  const centre = (t) => [0.36 * t * t, height * t, 0.14 * t * t];
  for (let r = 0; r < sections; r++)
    branch(
      stem,
      centre(r / sections),
      centre((r + 1) / sections),
      0.24 - (r / sections) * 0.06,
      0.24 - ((r + 1) / sections) * 0.06,
      far ? 4 : 7,
    );
  const top = centre(1);
  if (!fan) branch(leaves, top, add(top, [0, 1.05, 0]), 0.21, 0.1, far ? 4 : 7);
  const origin = add(top, [0, fan ? 0 : 1.05, 0]);
  const count = far ? 6 : fan ? 15 : 12;
  for (let f = 0; f < count; f++) {
    const a = f * golden;
    const age = f / (count - 1);
    const direction = [Math.cos(a), 0, Math.sin(a)];
    const side = [-Math.sin(a), 0, Math.cos(a)];
    const shade = 1.04 - age * 0.16;
    if (fan) {
      const end = add(origin, add(mul(direction, 1 + age * 0.8), [0, 1.15 - age * 1.8, 0]));
      branch(leaves, origin, end, 0.035, 0.015, 3);
      const mid = vertex(fronds, end, [0, 1, 0], shade);
      const folds = far ? 3 : 5;
      const rim = Array.from({length: folds + 1}, (_, i) => {
        const t = -1.35 + (i * 2.7) / folds;
        const p = add(end, add(mul(direction, Math.cos(t) * 1.05), mul(side, Math.sin(t) * 1.2)));
        p[1] += (i % 2 ? 0.12 : -0.12) - age * 0.4;
        return vertex(
          fronds,
          p,
          add([0, 1, 0], mul(side, i % 2 ? 0.3 : -0.3)),
          shade * (i % 2 ? 1.03 : 0.95),
        );
      });
      for (let i = 0; i < folds; i++) face(fronds, mid, rim[i], rim[i + 1], [0, 1, 0]);
    } else {
      const segments = far ? 2 : 6;
      const rows = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const width = s === segments ? 0.015 : 0.52 * Math.sin(Math.PI * (0.13 + t * 0.82));
        const p = add(
          origin,
          add(mul(direction, t * (3.4 + 0.3 * Math.sin(f))), [
            0,
            Math.sin(t * Math.PI * 0.8) * (1.7 - age) - t * t * (0.7 + age * 1.4),
            0,
          ]),
        );
        rows.push(
          [-1, 0, 1].map((flank) =>
            vertex(
              fronds,
              add(p, add(mul(side, width * flank), [0, -Math.abs(flank) * width * 0.55, 0])),
              add([0, 1, 0], mul(side, flank * 0.4)),
              shade * (flank ? 0.95 : 1.04),
            ),
          ),
        );
      }
      for (let s = 0; s < segments; s++)
        for (let side = 0; side < 2; side++) {
          face(fronds, rows[s][side], rows[s + 1][side], rows[s + 1][side + 1], [0, 1, 0]);
          face(fronds, rows[s][side], rows[s + 1][side + 1], rows[s][side + 1], [0, 1, 0]);
        }
    }
  }
  return [stem, leaves, fronds].filter((m) => m.indices.length);
}

function glb(parts, name) {
  const blocks = [],
    views = [],
    accessors = [];
  let offset = 0;
  const accessor = (array, type, componentType, target, bounds) => {
    const bytes = new Uint8Array(array.buffer);
    const block = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    block.set(bytes);
    blocks.push(block);
    views.push({buffer: 0, byteOffset: offset, byteLength: bytes.length, target});
    offset += block.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count: array.length / (type === 'VEC3' ? 3 : 1),
      type,
      ...bounds,
    });
    return accessors.length - 1;
  };
  const primitives = parts.map((m, material) => ({
    attributes: {
      POSITION: accessor(new Float32Array(m.positions), 'VEC3', 5126, 34962, {
        min: [0, 1, 2].map((axis) => Math.min(...m.positions.filter((_, i) => i % 3 === axis))),
        max: [0, 1, 2].map((axis) => Math.max(...m.positions.filter((_, i) => i % 3 === axis))),
      }),
      NORMAL: accessor(new Float32Array(m.normals), 'VEC3', 5126, 34962),
      COLOR_0: accessor(
        new Float32Array(m.shades.flatMap((s) => [s * 0.8, s * 0.8, s * 0.8])),
        'VEC3',
        5126,
        34962,
      ),
    },
    indices: accessor(new Uint16Array(m.indices), 'SCALAR', 5123, 34963),
    material,
  }));
  const json = {
    asset: {version: '2.0', generator: 'Tileflow Streets tree artwork'},
    scene: 0,
    scenes: [{nodes: [0]}],
    nodes: [{mesh: 0}],
    meshes: [{name, primitives}],
    materials: parts.map((m) => ({
      name: m.material,
      doubleSided: m.material === 'fronds',
      pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1},
    })),
    accessors,
    bufferViews: views,
    buffers: [{byteLength: offset}],
  };
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + offset, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bin = Buffer.alloc(8);
  bin.writeUInt32LE(offset, 0);
  bin.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, bin, ...blocks]);
}

function topView(parts, dark) {
  const foliage = parts.filter((m) => m.material === 'leaves' || m.material === 'fronds');
  const reach = Math.max(
    ...foliage.flatMap((m) => m.positions.filter((_, i) => i % 3 !== 1).map(Math.abs)),
  );
  const scale = 26 / reach;
  const light = unit([-0.6, 1, -0.7]);
  const base = dark ? [67, 91, 77] : [146, 186, 136];
  const triangles = [];
  for (const m of foliage)
    for (let i = 0; i < m.indices.length; i += 3) {
      const ids = m.indices.slice(i, i + 3);
      const points = ids.map((id) => m.positions.slice(id * 3, id * 3 + 3));
      const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      if (normal[1] < 0.01) continue;
      const luminance = 0.87 + 0.22 * Math.max(0, dot(normal, light));
      const fill =
        '#' +
        base
          .map((v) =>
            Math.round(Math.min(255, v * luminance))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
      triangles.push({
        height: points.reduce((n, p) => n + p[1], 0) / 3,
        path: `<path d="M${points.map((p) => `${(32 + p[0] * scale).toFixed(2)},${(32 + p[2] * scale).toFixed(2)}`).join('L')}Z" fill="${fill}" stroke="${fill}" stroke-width="0.35"/>`,
      });
    }
  triangles.sort((a, b) => a.height - b.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n<!-- Generated by build-trees.mjs. Original Tileflow crown artwork. -->\n${triangles.map((t) => t.path).join('\n')}\n</svg>\n`;
}

export function buildStreetsTrees() {
  const files = new Map();
  const catalogue = [];
  for (const form of ['round', 'open', 'tall', 'conifer', 'columnar', 'palm-feather', 'palm-fan']) {
    const build = (far) =>
      form.startsWith('palm')
        ? palm(form, far)
        : form in broadleaf
          ? deciduous(form, far)
          : evergreen(form, far);
    const near = build(false),
      far = build(true);
    const id = `streets-tree-${form}`;
    for (const [level, parts] of [
      ['near', near],
      ['far', far],
    ]) {
      const triangles = parts.reduce((n, m) => n + m.indices.length / 3, 0);
      if (triangles > (level === 'near' ? 700 : 120))
        throw new Error(`${id} ${level}: ${triangles} triangles exceeds the Streets budget`);
      files.set(`models/${id}${level === 'far' ? '.far' : ''}.glb`, glb(parts, id));
      catalogue.push({id, level, triangles});
    }
    files.set(`icons/${id}.pattern.svg`, topView(near, false));
    files.set(`icons/${id}-dark.pattern.svg`, topView(near, true));
  }
  return {files, catalogue};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const {files, catalogue} = buildStreetsTrees();
  const check = process.argv.includes('--check');
  for (const [path, content] of files) {
    const expected = Buffer.from(content);
    const target = join(here, path);
    if (check) {
      const actual = await readFile(target).catch(() => undefined);
      if (!actual?.equals(expected)) throw new Error(`Regenerate Streets tree artwork: ${path}`);
    } else {
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, expected);
    }
  }
  console.log(JSON.stringify({files: files.size, catalogue}, null, 2));
}
