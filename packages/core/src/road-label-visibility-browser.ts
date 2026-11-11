/**
 * Whole-name visibility for MapLibre's line labels. The renderer still owns shaping, anchors,
 * collisions, repeated names and placement fades. A small, asynchronous depth query at each
 * retained anchor decides whether its complete glyph run can be read around the 3D scene.
 * No feature filters, tile data or shared renderer prototypes are changed.
 */
export const roadLabelVisibilityLayerId = 'tileflow-road-label-visibility';

type TileId = {canonical: {x: number; y: number; z: number}; wrap: number};
type OpacityArray = {length: number; uint32: Uint32Array};
type OpacityBuffer = {buffer?: WebGLBuffer; updateData(array: OpacityArray): void};
type SymbolInstance = {
  anchorX: number;
  anchorY: number;
  numHorizontalGlyphVertices: number;
  numVerticalGlyphVertices: number;
};
type Bucket = {
  symbolInstances: {length: number; get(index: number): SymbolInstance};
  text: {opacityVertexArray: OpacityArray; opacityVertexBuffer: OpacityBuffer};
};
type Tile = {tileID: TileId; getBucket(layer: unknown): Bucket | undefined};
type TileManager = {
  getRenderableIds(symbols: boolean): unknown[];
  getTileByID(id: unknown): Tile | undefined;
};
type Projection = {
  mainMatrix: ArrayLike<number>;
  projectionTransition: number;
};
type RenderArgs = {getProjectionData(args: {tileID: TileId}): Projection};

export type RoadLabelVisibilityMap = {
  addLayer?(layer: object, beforeId?: string): unknown;
  removeLayer?(id: string): unknown;
  moveLayer?(id: string, beforeId?: string): unknown;
  getLayer(id: string): unknown;
  getLayersOrder?(): string[];
  getPitch(): number;
  getTerrain?(): unknown;
  getCanvas?(): {width: number; clientWidth: number};
  triggerRepaint?(): void;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};

/** Standard's signed screen distance: negative towards the camera, in viewport heights. */
export function roadLabelWithinView(pitch: number, distance: number): boolean {
  if (!Number.isFinite(distance)) return false;
  return pitch <= 40 || (pitch < 55 ? distance < 1 : pitch < 60 ? distance < 0 : distance <= -0.2);
}

type Probe = {query?: WebGLQuery; visible: boolean};
type Record = {
  base: Uint32Array;
  array: OpacityArray;
  buffer: OpacityBuffer;
  gpu: WebGLBuffer;
  update: OpacityBuffer['updateData'];
  wrapped: OpacityBuffer['updateData'];
  probes: Probe[];
};

const vertex = `#version 300 es
uniform vec4 u_position;
uniform float u_size;
void main() { gl_Position = u_position; gl_PointSize = u_size; }
`;
const fragment = `#version 300 es
precision highp float;
out vec4 color;
void main() { color = vec4(0.0); }
`;

/**
 * The only renderer-private bridge. Supported GL JS versions expose sourceCaches or
 * tileManagers. Check the capabilities before touching a bucket; an unknown
 * renderer keeps complete foreground text instead of clipping or hiding all its names.
 */
function roadBuckets(map: RoadLabelVisibilityMap, ids: readonly string[]) {
  const style = (
    map as RoadLabelVisibilityMap & {
      style?: {
        tileManagers?: {[id: string]: TileManager};
        sourceCaches?: {[id: string]: TileManager};
      };
    }
  ).style;
  const managers = style?.tileManagers ?? style?.sourceCaches;
  const result: {bucket: Bucket; tile: Tile}[] = [];
  const seen = new Set<Bucket>();
  for (const id of ids) {
    const layer = map.getLayer(id) as {source?: string} | undefined;
    const manager = layer?.source && managers?.[layer.source];
    if (!manager || !manager.getRenderableIds || !manager.getTileByID) continue;
    for (const tileId of manager.getRenderableIds(true)) {
      const tile = manager.getTileByID(tileId);
      const bucket = tile?.getBucket?.(layer);
      if (
        !tile ||
        !bucket ||
        seen.has(bucket) ||
        typeof bucket.symbolInstances?.get !== 'function' ||
        !(bucket.text?.opacityVertexArray?.uint32 instanceof Uint32Array) ||
        !bucket.text.opacityVertexBuffer?.buffer ||
        typeof bucket.text.opacityVertexBuffer?.updateData !== 'function'
      )
        continue;
      let glyphs = 0;
      for (let index = 0; index < bucket.symbolInstances.length; index++) {
        const symbol = bucket.symbolInstances.get(index);
        const count = (symbol.numHorizontalGlyphVertices + symbol.numVerticalGlyphVertices) / 4;
        if (!Number.isInteger(count) || count < 0) {
          glyphs = -1;
          break;
        }
        glyphs += count;
      }
      if (glyphs !== bucket.text.opacityVertexArray.length) continue;
      seen.add(bucket);
      result.push({bucket, tile});
    }
  }
  return result;
}

export function createRoadLabelVisibility(map: RoadLabelVisibilityMap) {
  let targets: readonly string[] = [];
  let gl: WebGL2RenderingContext | undefined;
  let program: WebGLProgram | undefined;
  let position: WebGLUniformLocation | null = null;
  let pointSize: WebGLUniformLocation | null = null;
  let disposed = false;
  let dirty = true;
  let requestedFrame = false;
  const records = new Map<Bucket, Record>();
  let stats = {candidates: 0, visible: 0, pending: 0, supported: false};
  const events = ['move', 'sourcedata', 'styledata'];
  const invalidate = () => {
    dirty = true;
  };
  for (const event of events) map.on(event, invalidate);

  function upload(record: Record) {
    if (!gl || gl.isContextLost() || !gl.isBuffer(record.gpu)) return;
    // A custom render pass owns raw GL state. Do not use MapLibre's cached binding here:
    // a retired tile may already have destroyed its buffer, and its cache may be stale.
    const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.ARRAY_BUFFER, record.gpu);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, record.array.uint32.subarray(0, record.array.length));
    gl.bindBuffer(gl.ARRAY_BUFFER, previous);
  }

  function releaseRecord(record: Record, restore: boolean) {
    for (const probe of record.probes)
      if (probe.query && gl && !gl.isContextLost()) gl.deleteQuery(probe.query);
    if (record.buffer.updateData === record.wrapped) record.buffer.updateData = record.update;
    if (restore && gl && !gl.isContextLost()) {
      record.array.uint32.set(record.base);
      upload(record);
    }
  }

  function releaseGraphics() {
    for (const record of records.values()) releaseRecord(record, true);
    records.clear();
    if (program && gl && !gl.isContextLost()) gl.deleteProgram(program);
    program = undefined;
    gl = undefined;
    requestedFrame = false;
  }

  function recordFor(bucket: Bucket): Record {
    let record = records.get(bucket);
    const {opacityVertexArray: array, opacityVertexBuffer: buffer} = bucket.text;
    if (record && record.buffer === buffer) return record;
    if (record) releaseRecord(record, false);
    const update = buffer.updateData;
    record = {
      array,
      buffer,
      gpu: buffer.buffer!,
      update,
      base: array.uint32.slice(0, array.length),
      probes: [],
      wrapped(next) {
        // Capture only writes made by placement, including duplicate suppression and fades.
        record!.array = next;
        record!.base = next.uint32.slice(0, next.length);
        return update.call(this, next);
      },
    };
    buffer.updateData = record.wrapped;
    records.set(bucket, record);
    return record;
  }

  const layer = {
    id: roadLabelVisibilityLayerId,
    type: 'custom',
    renderingMode: '3d',
    metadata: {'tileflow:scene-kind': 'labels'},
    inspect: () => stats,
    onAdd(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      releaseGraphics();
      if (!('beginQuery' in context)) return;
      gl = context;
      const candidate = gl.createProgram();
      if (!candidate) return;
      const shaders: WebGLShader[] = [];
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) continue;
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(candidate, shader);
      }
      gl.linkProgram(candidate);
      for (const shader of shaders) gl.deleteShader(shader);
      if (!gl.getProgramParameter(candidate, gl.LINK_STATUS)) {
        gl.deleteProgram(candidate);
        return;
      }
      program = candidate;
      position = gl.getUniformLocation(program, 'u_position');
      pointSize = gl.getUniformLocation(program, 'u_size');
      dirty = true;
    },
    render(_: WebGLRenderingContext | WebGL2RenderingContext, args: RenderArgs) {
      if (!gl || !program || gl.isContextLost() || !args.getProjectionData) return;
      if (map.getTerrain?.()) {
        for (const record of records.values()) releaseRecord(record, true);
        records.clear();
        stats = {candidates: 0, visible: 0, pending: 0, supported: false};
        requestedFrame = false;
        return;
      }
      // Natural renders recheck changed geometry. A requested completion frame only collects
      // results; it never starts another cycle, so a settled map reaches idle.
      const sample = dirty || !requestedFrame;
      dirty = false;
      requestedFrame = false;
      const pitch = map.getPitch();
      const canvas = map.getCanvas?.();
      const dpr = canvas?.clientWidth ? canvas.width / canvas.clientWidth : 1;
      const buckets = roadBuckets(map, targets);
      const retained = new Set(buckets.map(({bucket}) => bucket));
      for (const [bucket, record] of records)
        if (!retained.has(bucket)) {
          releaseRecord(record, true);
          records.delete(bucket);
        }
      gl.useProgram(program);
      gl.colorMask(false, false, false, false);
      gl.depthMask(false);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.STENCIL_TEST);
      // A small neighbourhood lets an anchor at a facade's edge keep its complete name.
      gl.uniform1f(pointSize, 6 * dpr);
      let candidates = 0,
        visible = 0,
        pending = 0,
        issued = 0;
      try {
        for (const {bucket, tile} of buckets) {
          const projection = args.getProjectionData({tileID: tile.tileID});
          // Street detail is planar. Globe labels keep the engine's own visibility until
          // their nonlinear projection can be tested accurately.
          if (projection.projectionTransition > 0) {
            const record = records.get(bucket);
            if (record) {
              releaseRecord(record, true);
              records.delete(bucket);
            }
            continue;
          }
          const matrix = projection.mainMatrix;
          const record = recordFor(bucket);
          const array = record.array;
          let offset = 0,
            changed = false;
          for (let index = 0; index < bucket.symbolInstances.length; index++) {
            const symbol = bucket.symbolInstances.get(index);
            const count = (symbol.numHorizontalGlyphVertices + symbol.numVerticalGlyphVertices) / 4;
            const end = offset + count;
            if (!Number.isInteger(end) || end > record.base.length) break;
            const probe = record.probes[index] ?? (record.probes[index] = {visible: true});
            const x = symbol.anchorX,
              y = symbol.anchorY;
            const cx = matrix[0]! * x + matrix[4]! * y + matrix[12]!;
            const cy = matrix[1]! * x + matrix[5]! * y + matrix[13]!;
            const cz = matrix[2]! * x + matrix[6]! * y + matrix[14]!;
            const cw = matrix[3]! * x + matrix[7]! * y + matrix[15]!;
            const near =
              cw > 0 &&
              Math.abs(cx / cw) < 1.1 &&
              Math.abs(cy / cw) < 1.1 &&
              roadLabelWithinView(pitch, cy / cw / 2);
            let eligible = false;
            for (let at = offset; at < end; at++) eligible ||= record.base[at] !== 0;
            if (probe.query && gl.getQueryParameter(probe.query, gl.QUERY_RESULT_AVAILABLE)) {
              probe.visible = Boolean(gl.getQueryParameter(probe.query, gl.QUERY_RESULT));
              gl.deleteQuery(probe.query);
              probe.query = undefined;
            }
            if (near && eligible && pitch >= 10 && sample && !probe.query && issued < 512) {
              const query = gl.createQuery();
              if (query) {
                probe.query = query;
                // Bias above the ground to avoid coplanar depth noise, not above a building.
                gl.uniform4f(position, cx, cy, cz - 0.00001 * cw, cw);
                gl.beginQuery(gl.ANY_SAMPLES_PASSED, query);
                gl.drawArrays(gl.POINTS, 0, 1);
                gl.endQuery(gl.ANY_SAMPLES_PASSED);
                issued++;
              }
            }
            if (probe.query) pending++;
            const show = near && (pitch < 10 || probe.visible);
            if (eligible) {
              candidates++;
              if (show) visible++;
            }
            for (let at = offset; at < end; at++) {
              const opacity = show ? record.base[at]! : 0;
              if (array.uint32[at] !== opacity) {
                array.uint32[at] = opacity;
                changed = true;
              }
            }
            offset = end;
          }
          if (changed) upload(record);
        }
      } finally {
        gl.colorMask(true, true, true, true);
      }
      stats = {candidates, visible, pending, supported: buckets.length > 0};
      if (pending) {
        requestedFrame = true;
        map.triggerRepaint?.();
      }
    },
    onRemove: releaseGraphics,
  };

  return {
    sync(ids: readonly string[]) {
      if (disposed) return;
      targets = ids;
      if (!ids.length) {
        if (map.getLayer(layer.id)) map.removeLayer?.(layer.id);
        return;
      }
      if (!map.getLayer(layer.id)) map.addLayer?.(layer, ids[0]);
      else {
        const order = map.getLayersOrder?.();
        if (order && order.indexOf(layer.id) !== order.indexOf(ids[0]!) - 1)
          map.moveLayer?.(layer.id, ids[0]);
      }
    },
    dispose(removed = false) {
      if (disposed) return;
      disposed = true;
      for (const event of events) map.off(event, invalidate);
      if (!removed && map.getLayer(layer.id)) map.removeLayer?.(layer.id);
      else releaseGraphics();
    },
  };
}
