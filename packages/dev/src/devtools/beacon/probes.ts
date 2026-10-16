import type {Map as MapLibreMap} from 'maplibre-gl';

/** Version-isolated renderer observations. All temporary hooks are restored on disposal. */
export function rendererProbe(map: MapLibreMap) {
  const internal = map as any,
    style = internal.style;
  const gl = map.getCanvas().getContext('webgl2');
  const restore: (() => void)[] = [];
  let calls = 0,
    placement = 0,
    custom = 0,
    last: number | undefined,
    sampling = false;
  const frames: number[] = [],
    drawCalls: number[] = [],
    placementMs: number[] = [],
    customMs: number[] = [];
  const hook = (
    owner: any,
    name: string,
    measure: (fn: (...args: any[]) => any, args: any[]) => any,
  ) => {
    if (typeof owner?.[name] !== 'function') return false;
    const original = owner[name],
      own = Object.getOwnPropertyDescriptor(owner, name);
    const wrapped = function (this: any, ...args: any[]) {
      return measure(original.bind(this), args);
    };
    try {
      owner[name] = wrapped;
    } catch {
      return false;
    }
    if (owner[name] !== wrapped) return false;
    restore.push(() => {
      if (owner[name] === wrapped) {
        if (own) Object.defineProperty(owner, name, own);
        else delete owner[name];
      }
    });
    return true;
  };
  let drawsSupported = false;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
    drawsSupported =
      hook(gl, name, (fn, args) => {
        if (sampling) calls++;
        return fn(...args);
      }) || drawsSupported;
  const placementSupported = hook(style, '_updatePlacement', (fn, args) => {
    const start = performance.now();
    try {
      return fn(...args);
    } finally {
      if (sampling) placement += performance.now() - start;
    }
  });
  for (const id of map.getLayersOrder()) {
    const layer = map.getLayer(id) as any;
    if (layer?.type !== 'custom' || id.startsWith('__tileflow-devtools')) continue;
    const target = layer.implementation ?? layer;
    hook(target, 'render', (fn, args) => {
      const start = performance.now();
      try {
        return fn(...args);
      } finally {
        if (sampling) custom += performance.now() - start;
      }
    });
  }
  const render = () => {
    if (!sampling) return;
    const now = performance.now();
    if (last !== undefined) {
      frames.push(now - last);
      drawCalls.push(calls);
      placementMs.push(placement);
      customMs.push(custom);
    }
    last = now;
    calls = placement = custom = 0;
    map.triggerRepaint();
  };
  map.on('render', render);
  return {
    frames,
    drawCalls,
    placementMs,
    customMs,
    drawsSupported,
    placementSupported,
    start() {
      calls = placement = custom = 0;
      last = undefined;
      sampling = true;
      map.triggerRepaint();
    },
    stop() {
      sampling = false;
      last = undefined;
    },
    dispose() {
      sampling = false;
      map.off('render', render);
      for (const undo of restore.reverse()) undo();
    },
  };
}

export function placementObservation(map: MapLibreMap) {
  const style = (map as any).style,
    placements = style?.placement?.placements;
  if (!placements) return undefined;
  const ids = new Set<number>();
  let candidates = 0,
    dropped = 0,
    lineDropped = 0;
  for (const manager of Object.values(style.tileManagers ?? {}) as any[])
    for (const tile of manager?._inViewTiles?.getAllTiles?.() ?? [])
      for (const bucket of new Set(Object.values(tile.buckets ?? {})) as Set<any>) {
        const instances = bucket.symbolInstances;
        if (!instances?.get) continue;
        for (let i = 0; i < Math.min(instances.length, 20000); i++) {
          const instance = instances.get(i),
            id = instance.crossTileID,
            placed = placements[id];
          if (
            !id ||
            ids.has(id) ||
            !placed ||
            placed.skipFade ||
            !(instance.numHorizontalGlyphVertices || instance.numVerticalGlyphVertices)
          )
            continue;
          ids.add(id);
          candidates++;
          if (!placed.text) {
            dropped++;
            if (bucket.layers?.some((l: any) => l.layout?.get('symbol-placement') === 'line'))
              lineDropped++;
          }
        }
      }
  return {candidates, dropped, lineDropped};
}

export function glyphObservation(map: MapLibreMap) {
  const entries = (map as any).style?.glyphManager?.entries;
  if (!entries) return undefined;
  const missing: string[] = [];
  let total = 0;
  for (const [font, entry] of Object.entries(entries) as [string, any][])
    for (const glyphs of Object.values(entry.glyphs ?? {}) as any[])
      for (const [character, glyph] of Object.entries(glyphs)) {
        total++;
        if (glyph === null && character.trim()) missing.push(`${font}: ${character}`);
      }
  return {total, missing};
}

/** GPU allocation estimate from resident renderer resources, excluding inaccessible driver allocations. */
export function residentGpuBytes(map: MapLibreMap): number | undefined {
  const gl = map.getCanvas().getContext('webgl2');
  if (!gl) return undefined;
  const internal = map as any;
  const seen = new Set<object>(),
    buffers = new Set<WebGLBuffer>(),
    textures = new Set<object>();
  let bytes = 0,
    visited = 0;
  const bufferType = map.getCanvas().ownerDocument.defaultView?.WebGLBuffer;
  const walk = (value: any, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 9 || visited++ > 30000)
      return;
    seen.add(value);
    if (bufferType && value instanceof bufferType) {
      buffers.add(value);
      return;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Element)
      return;
    if (
      value.texture &&
      Number.isFinite(value.size?.[0]) &&
      Number.isFinite(value.size?.[1]) &&
      !textures.has(value.texture)
    ) {
      textures.add(value.texture);
      bytes += value.size[0] * value.size[1] * 4;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        [
          'map',
          '_map',
          'context',
          'gl',
          'dispatcher',
          'actor',
          'workerPool',
          '_eventedParent',
          '_listeners',
          '_oneTimeListeners',
        ].includes(key)
      )
        continue;
      walk(child, depth + 1);
    }
  };
  walk(internal.style?.tileManagers, 0);
  walk(internal.painter?.imageManager, 0);
  walk(internal.painter?.glyphManager, 0);
  const before = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  try {
    for (const buffer of buffers) {
      if (gl.isBuffer(buffer)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        bytes += gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) || 0;
      }
    }
  } finally {
    gl.bindBuffer(gl.ARRAY_BUFFER, before);
  }
  return bytes || undefined;
}

/** Native overdraw shader saturates at eight passes. Read inside render, before the buffer is discarded. */
export function sampleOverdraw(
  map: MapLibreMap,
  signal: AbortSignal,
): Promise<{average: number; hot: number; samples: number} | undefined> {
  const canvas = map.getCanvas(),
    gl = canvas.getContext('webgl2');
  if (!gl || gl.isContextLost()) return Promise.resolve(undefined);
  const previous = map.showOverdrawInspector;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (value?: {average: number; hot: number; samples: number}, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      map.off('render', read);
      signal.removeEventListener('abort', abort);
      map.showOverdrawInspector = previous;
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(undefined, new Error('Audit cancelled.'));
    const read = () => {
      try {
        // Sample a regular grid of scanlines; bounded to 256 KiB of pixel storage.
        const width = Math.min(canvas.width, 4096),
          rows = Math.min(canvas.height, 16),
          pixels = new Uint8Array(width * 4);
        let sum = 0,
          hot = 0,
          samples = 0;
        for (let y = 0; y < rows; y++) {
          gl.readPixels(
            Math.floor((canvas.width - width) / 2),
            Math.floor(((y + 0.5) * canvas.height) / rows),
            width,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 256))) {
            const passes = Math.round((pixels[x * 4] * 8) / 255);
            sum += passes;
            hot += Number(passes >= 8);
            samples++;
          }
        }
        finish({average: sum / samples, hot: hot / samples, samples});
      } catch {
        finish();
      }
    };
    const timer = setTimeout(() => finish(), 2000);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) {
      abort();
      return;
    }
    map.showOverdrawInspector = true;
    map.once('render', read);
    map.triggerRepaint();
  });
}
