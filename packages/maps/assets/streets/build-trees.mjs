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

const profiles = {
  round: {
    r: [3.5, 3.55, 3.2],
    y: 6.55,
    power: 0.83,
    lobes: 0.1,
    taper: 0.08,
    lean: 0.16,
    phase: 0.4,
  },
  open: {
    r: [4.2, 2.65, 3.65],
    y: 6.35,
    power: 0.78,
    lobes: 0.13,
    taper: 0.09,
    lean: -0.18,
    phase: 1.2,
  },
  tall: {
    r: [2.6, 4.4, 2.35],
    y: 7.2,
    power: 0.94,
    lobes: 0.075,
    taper: 0.16,
    lean: 0.28,
    phase: 2.3,
  },
  conifer: {
    r: [3.0, 4.75, 2.8],
    y: 6.35,
    power: 0.74,
    lobes: 0.035,
    taper: 0.6,
    lean: -0.1,
    phase: 0.8,
  },
  columnar: {
    r: [1.35, 5.5, 1.2],
    y: 6.2,
    power: 1.04,
    lobes: 0.035,
    taper: 0.22,
    lean: 0.13,
    phase: 1.6,
  },
};
const crownVolumes = {
  round: [
    {c: [-1.3, -0.25, 0.15], r: [2.3, 2.5, 2.2]},
    {c: [1.4, -0.4, 0], r: [2.2, 2.35, 2.1]},
    {c: [0.1, 1.5, -0.3], r: [2.4, 2.7, 2.3]},
  ],
  open: [
    {c: [-1.75, -0.25, 0.2], r: [2.65, 2.1, 2.45]},
    {c: [1.65, -0.2, 0.1], r: [2.6, 2.3, 2.4]},
    {c: [-0.1, 0.7, -0.45], r: [2.9, 2.5, 2.6]},
  ],
  tall: [
    {c: [-0.15, 1.25, -0.15], r: [2.25, 3.35, 2.05]},
    {c: [-1.0, -1.4, 0.2], r: [1.8, 2.1, 1.7]},
    {c: [1.1, -0.85, 0.1], r: [1.8, 2.35, 1.75]},
  ],
};
// Restore depth to the compact crowns; their original lobes were laid out
// mainly side to side, leaving a flat, elongated footprint from above.
const crownDepth = {round: 1.45, open: 1.52, tall: 1.3};
function blendedRadius(direction, volumes) {
  const hits = volumes.map(({c, r}) => {
    let a = 0,
      b = 0,
      d = -1;
    for (let i = 0; i < 3; i++) {
      a += (direction[i] / r[i]) ** 2;
      b -= (2 * direction[i] * c[i]) / r[i] ** 2;
      d += (c[i] / r[i]) ** 2;
    }
    return (-b + Math.sqrt(Math.max(0, b * b - 4 * a * d))) / (2 * a);
  });
  // A smooth union keeps the lobes readable in one continuous canopy skin.
  return hits.reduce((a, b) => Math.max(a, b) + 0.2 * Math.log1p(Math.exp(-Math.abs(a - b) / 0.2)));
}

function compactCrown(m, p, form, far) {
  const sides = far ? 12 : 20,
    rings = far ? 5 : 10;
  const point = (latitude, angle) => {
    const up = Math.cos(latitude),
      reach = Math.max(0, Math.sin(latitude));
    if (crownVolumes[form]) {
      const direction = [reach * Math.cos(angle), up, reach * Math.sin(angle)];
      const radius = blendedRadius(direction, crownVolumes[form]);
      return [
        direction[0] * radius,
        p.y + direction[1] * radius,
        direction[2] * radius * crownDepth[form],
      ];
    }
    const lobes =
      1 +
      p.lobes * Math.cos(3 * angle + p.phase) * reach * reach +
      0.025 * Math.sin(2 * angle + p.phase) * reach;
    const tier = form === 'conifer' ? 0.88 * (1 + 0.055 * Math.cos(latitude * 6)) : 1;
    const radius = Math.pow(reach, p.power) * (1 - p.taper * up) * lobes * tier;
    return [
      p.r[0] * radius * Math.cos(angle) + p.lean * up,
      p.y + p.r[1] * up,
      p.r[2] * radius * Math.sin(angle) + 0.08 * up,
    ];
  };
  const normal = (latitude, angle) => {
    const e = 0.0001;
    const around = sub(point(latitude, angle + e), point(latitude, angle - e));
    const down = sub(point(latitude + e, angle), point(latitude - e, angle));
    return unit(cross(around, down));
  };
  const top = vertex(m, point(0, 0), [0, 1, 0], 1.015);
  const bottom = vertex(m, point(Math.PI, 0), [0, -1, 0], 0.985);
  const rows = [];
  for (let row = 1; row < rings; row++) {
    const latitude = (row / rings) * Math.PI;
    rows.push(
      Array.from({length: sides}, (_, side) => {
        const angle = (side / sides) * tau;
        return vertex(
          m,
          point(latitude, angle),
          normal(latitude, angle),
          1 + 0.015 * Math.cos(latitude),
        );
      }),
    );
  }
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    face(m, top, rows[0][side], rows[0][next], [0, 1, 0]);
    for (let row = 0; row < rows.length - 1; row++) {
      const outward = normal(((row + 1.5) / rings) * Math.PI, ((side + 0.5) / sides) * tau);
      face(m, rows[row][side], rows[row + 1][side], rows[row + 1][next], outward);
      face(m, rows[row][side], rows[row + 1][next], rows[row][next], outward);
    }
    face(m, bottom, rows.at(-1)[next], rows.at(-1)[side], [0, -1, 0]);
  }
}

function compactTree(form, far) {
  const p = profiles[form],
    bark = mesh('bark'),
    leaves = mesh('leaves');
  const slim = form === 'columnar' || form === 'conifer';
  const crownBottom = p.y - p.r[1],
    fork = Math.max(1.5, crownBottom + (slim ? 0.35 : -0.65));
  const sides = far ? 3 : 8;
  branch(bark, [0, 0, 0], [0, fork, 0], slim ? 0.28 : 0.48, slim ? 0.16 : 0.3, sides);
  if (slim) branch(bark, [0, fork, 0], [0, p.y, 0], 0.16, 0.06, sides);
  else
    for (const [sign, z] of [
      [-1, -0.18],
      [1, 0.15],
    ]) {
      branch(bark, [0, fork, 0], [sign * p.r[0] * 0.46, crownBottom + 1.25, z], 0.24, 0.1, sides);
    }
  compactCrown(leaves, p, form, far);
  return [bark, leaves];
}

export function buildStreetsTrees() {
  const files = new Map();
  const catalogue = [];
  for (const form of ['round', 'open', 'tall', 'conifer', 'columnar', 'palm-feather', 'palm-fan']) {
    const build = (far) => (form.startsWith('palm') ? palm(form, far) : compactTree(form, far));
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
