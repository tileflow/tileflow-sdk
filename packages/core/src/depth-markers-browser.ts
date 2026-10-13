// Markers drawn in the map's 3D scene: images pinned to positions that 3D buildings and other 3D
// layers hide behind them, unlike DOM markers, which always float on top. A MapLibre custom layer
// draws them in the depth buffer the map's extrusions share, so a pin behind a tower disappears
// behind it as the camera moves. Screen markers face the viewer at a size in CSS pixels; ground
// markers lie flat on the ground at a size in metres, in the camera's perspective.

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowDepthMarkerMap = {
  addLayer(layer: unknown, beforeId?: string): unknown;
  getLayer(id: string): unknown;
  removeLayer(id: string): unknown;
  getCanvas(): HTMLCanvasElement;
  getPixelRatio?(): number;
  triggerRepaint(): void;
  on(event: 'styledata', listener: () => void): unknown;
  off(event: 'styledata', listener: () => void): unknown;
};

export type TileflowDepthMarker = Readonly<{
  /** `[longitude, latitude]`. */
  lngLat: readonly [number, number];
  /** The marker's picture. Pass it again to `update` after drawing into it. */
  image: TexImageSource;
  /** Width and height: CSS pixels for a screen marker, metres for a ground marker. */
  size: readonly [number, number];
  /**
   * `screen` (the default) faces the viewer at a fixed size in pixels, as a pin does; `ground`
   * lies flat on the ground at a size in metres, as a ring or an arrow on the street does.
   */
  alignment?: 'screen' | 'ground';
  /** The point of the image that sits on the position: `center` (the default) or `bottom`. */
  anchor?: 'center' | 'bottom';
  /** A screen marker's shift in CSS pixels, right and down. */
  offset?: readonly [number, number];
  /** Degrees clockwise: from the screen's up for a screen marker, from north for a ground one. */
  rotation?: number;
  /** Metres above the ground; defaults to 0. */
  altitude?: number;
  /** From 0 to 1 (the default). */
  opacity?: number;
  /** Whether nearer 3D content hides the marker; defaults to true. */
  occlude?: boolean;
}>;

export type TileflowDepthMarkerHandle = {
  /** Changes the marker; an `image` passed again is uploaded again. */
  update(change: Partial<TileflowDepthMarker>): void;
  remove(): void;
};

export type TileflowDepthMarkersOptions = Readonly<{
  /** The custom layer's id; defaults to `tileflow-depth-markers`. */
  id?: string;
  /** The layer the markers are drawn under, or a function that finds it after a style change. */
  beforeId?: string | (() => string | undefined);
}>;

export type TileflowDepthMarkers = {
  add(marker: TileflowDepthMarker): TileflowDepthMarkerHandle;
  /** Removes the markers' layer and releases its GPU resources. */
  dispose(): void;
};

/** Markers are placed in tiles of this zoom, which keeps their positions precise in 32-bit floats. */
const placementZoom = 16;
const extent = 8192;
const earthCircumference = 40075016.686;

/** Where a marker sits: its tile and its position there in tile units, and metres in tile units. */
export function tileflowDepthMarkerPlacement(lngLat: readonly [number, number]): {
  tile: {x: number; y: number; z: number};
  position: [number, number];
  unitsPerMetre: number;
} {
  const [lng, lat] = lngLat;
  const count = 2 ** placementZoom;
  const clamped = Math.min(85.0511287798066, Math.max(-85.0511287798066, lat));
  const radians = (clamped * Math.PI) / 180;
  const x = ((lng + 180) / 360) * count;
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * count;
  const tileX = Math.min(count - 1, Math.max(0, Math.floor(x)));
  const tileY = Math.min(count - 1, Math.max(0, Math.floor(y)));
  const tileMetres = (earthCircumference * Math.cos(radians)) / count;
  return {
    tile: {x: tileX, y: tileY, z: placementZoom},
    position: [(x - tileX) * extent, (y - tileY) * extent],
    unitsPerMetre: extent / tileMetres,
  };
}

type Entry = {
  marker: TileflowDepthMarker;
  placement: ReturnType<typeof tileflowDepthMarkerPlacement>;
};

type ShaderData = {variantName: string; vertexShaderPrelude: string; define: string};
type ProjectionData = {
  mainMatrix: Float32Array | number[];
  tileMercatorCoords: Float32Array | number[];
  clippingPlane: Float32Array | number[];
  projectionTransition: number;
  fallbackMatrix: Float32Array | number[];
};
type RenderInput = {
  shaderData: ShaderData;
  getProjectionData(params: {
    tileID: {wrap: number; canonical: {x: number; y: number; z: number}};
  }): ProjectionData;
};

/**
 * Draws markers in the map's 3D scene, hidden by nearer 3D buildings. Needs a MapLibre GL JS map
 * on WebGL 2 (GL JS 5 or later). The layer puts itself back after a style change.
 */
export function createTileflowDepthMarkers(
  map: TileflowDepthMarkerMap,
  options: TileflowDepthMarkersOptions = {},
): TileflowDepthMarkers {
  const id = options.id ?? 'tileflow-depth-markers';
  const entries: Entry[] = [];
  // Each image's version, bumped when it is passed again, so markers sharing it upload it once.
  const versions = new Map<TexImageSource, number>();
  let disposed = false;
  let gpu: Gpu | undefined;

  const layer = {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map: unknown, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      gpu =
        typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
          ? createGpu(gl)
          : undefined;
    },
    onRemove() {
      gpu?.release();
      gpu = undefined;
    },
    render(gl: WebGLRenderingContext | WebGL2RenderingContext, input: RenderInput) {
      if (!gpu || gl !== gpu.gl || entries.length === 0) return;
      const pixelRatio = map.getPixelRatio?.() ?? 1;
      const canvas = map.getCanvas();
      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      if (!(width > 0 && height > 0)) return;
      gpu.draw(entries, versions, input, [2 / width, 2 / height]);
    },
  };

  function beforeId() {
    const before = typeof options.beforeId === 'function' ? options.beforeId() : options.beforeId;
    return before && map.getLayer(before) ? before : undefined;
  }
  function attach() {
    if (disposed || entries.length === 0 || map.getLayer(id)) return;
    try {
      map.addLayer(layer, beforeId());
    } catch {
      // The style is mid-update; the next style event attaches the layer.
    }
  }
  // A style change drops runtime layers; the markers put their layer back while they show.
  const onStyle = () => attach();
  map.on('styledata', onStyle);

  return {
    add(marker) {
      if (disposed) throw new Error('Tileflow depth markers are disposed.');
      const entry: Entry = {
        marker: validated(marker),
        placement: tileflowDepthMarkerPlacement(marker.lngLat),
      };
      if (!versions.has(marker.image)) versions.set(marker.image, 0);
      entries.push(entry);
      attach();
      map.triggerRepaint();
      return {
        update(change) {
          if (!entries.includes(entry)) return;
          const next = validated({...entry.marker, ...change});
          if (next.lngLat !== entry.marker.lngLat)
            entry.placement = tileflowDepthMarkerPlacement(next.lngLat);
          if (change.image) versions.set(change.image, (versions.get(change.image) ?? 0) + 1);
          entry.marker = next;
          map.triggerRepaint();
        },
        remove() {
          const index = entries.indexOf(entry);
          if (index < 0) return;
          entries.splice(index, 1);
          const image = entry.marker.image;
          if (!entries.some((other) => other.marker.image === image)) {
            versions.delete(image);
            gpu?.forget(image);
          }
          map.triggerRepaint();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.length = 0;
      map.off('styledata', onStyle);
      if (map.getLayer(id)) map.removeLayer(id);
    },
  };
}

function validated(marker: TileflowDepthMarker): TileflowDepthMarker {
  const {lngLat, image, size} = marker;
  if (!Array.isArray(lngLat) || lngLat.length !== 2 || !lngLat.every(Number.isFinite))
    throw new TypeError('A depth marker needs lngLat: [longitude, latitude].');
  if (!image) throw new TypeError('A depth marker needs an image.');
  if (!Array.isArray(size) || size.length !== 2 || !size.every((value) => value > 0 && value < 1e6))
    throw new TypeError('A depth marker needs a positive size: [width, height].');
  if (
    marker.alignment !== undefined &&
    marker.alignment !== 'screen' &&
    marker.alignment !== 'ground'
  )
    throw new TypeError('A depth marker alignment is screen or ground.');
  if (marker.anchor !== undefined && marker.anchor !== 'center' && marker.anchor !== 'bottom')
    throw new TypeError('A depth marker anchor is center or bottom.');
  if (marker.opacity !== undefined && !(marker.opacity >= 0 && marker.opacity <= 1))
    throw new TypeError('A depth marker opacity runs from 0 to 1.');
  for (const name of ['rotation', 'altitude'] as const)
    if (marker[name] !== undefined && !Number.isFinite(marker[name]))
      throw new TypeError(`A depth marker ${name} must be a finite number.`);
  if (
    marker.offset !== undefined &&
    !(
      Array.isArray(marker.offset) &&
      marker.offset.length === 2 &&
      marker.offset.every(Number.isFinite)
    )
  )
    throw new TypeError('A depth marker offset is [right, down] in CSS pixels.');
  return marker;
}

type Gpu = {
  gl: WebGL2RenderingContext;
  draw(
    entries: readonly Entry[],
    versions: ReadonlyMap<TexImageSource, number>,
    input: RenderInput,
    pixel: [number, number],
  ): void;
  forget(image: TexImageSource): void;
  release(): void;
};

const uniformNames = [
  'u_projection_matrix',
  'u_projection_tile_mercator_coords',
  'u_projection_clipping_plane',
  'u_projection_transition',
  'u_projection_fallback_matrix',
  'u_anchor',
  'u_altitude',
  'u_size',
  'u_origin',
  'u_offset',
  'u_rotation',
  'u_ground',
  'u_pixel',
  'u_opacity',
  'u_image',
] as const;

function createGpu(gl: WebGL2RenderingContext): Gpu {
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const vao = gl.createVertexArray();
  const textures = new Map<TexImageSource, {texture: WebGLTexture; version: number}>();
  let program: WebGLProgram | undefined;
  let variant: string | undefined;
  let uniforms: Record<(typeof uniformNames)[number], WebGLUniformLocation | null> | undefined;
  let failed = false;

  function link(shaderData: ShaderData) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource(shaderData));
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const next = gl.createProgram()!;
    gl.attachShader(next, vertex);
    gl.attachShader(next, fragment);
    gl.bindAttribLocation(next, 0, 'a_corner');
    gl.linkProgram(next);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
      gl.deleteProgram(next);
      failed = true;
      return;
    }
    if (program) gl.deleteProgram(program);
    program = next;
    variant = shaderData.variantName;
    uniforms = Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(next, name)]),
    ) as typeof uniforms;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function texture(image: TexImageSource, version: number): WebGLTexture | undefined {
    let known = textures.get(image);
    if (known && known.version === version) return known.texture;
    if (!known) {
      const created = gl.createTexture();
      if (!created) return undefined;
      known = {texture: created, version: -1};
      textures.set(image, known);
    }
    gl.bindTexture(gl.TEXTURE_2D, known.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return undefined;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    known.version = version;
    return known.texture;
  }

  return {
    gl,
    draw(entries, versions, input, pixel) {
      if (failed) return;
      if (variant !== input.shaderData.variantName) link(input.shaderData);
      if (!program || !uniforms) return;
      const u = uniforms;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.u_image, 0);
      gl.uniform2f(u.u_pixel, pixel[0], pixel[1]);
      // Markers test against the scene's depth but do not write it, so they never hide each other.
      gl.depthMask(false);
      for (const entry of entries) {
        const {marker, placement} = entry;
        const ground = marker.alignment === 'ground';
        const target = texture(marker.image, versions.get(marker.image) ?? 0);
        if (!target || (marker.opacity ?? 1) <= 0) continue;
        const projection = input.getProjectionData({
          tileID: {wrap: 0, canonical: placement.tile},
        });
        gl.uniformMatrix4fv(u.u_projection_matrix, false, projection.mainMatrix);
        gl.uniform4fv(u.u_projection_tile_mercator_coords, projection.tileMercatorCoords);
        gl.uniform4fv(u.u_projection_clipping_plane, projection.clippingPlane);
        gl.uniform1f(u.u_projection_transition, projection.projectionTransition);
        gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, projection.fallbackMatrix);
        gl.uniform2f(u.u_anchor, placement.position[0], placement.position[1]);
        gl.uniform1f(u.u_altitude, marker.altitude ?? 0);
        const scale = ground ? placement.unitsPerMetre : 1;
        gl.uniform2f(u.u_size, marker.size[0] * scale, marker.size[1] * scale);
        gl.uniform2f(u.u_origin, 0.5, marker.anchor === 'bottom' ? 1 : 0.5);
        gl.uniform2f(u.u_offset, marker.offset?.[0] ?? 0, marker.offset?.[1] ?? 0);
        gl.uniform1f(u.u_rotation, ((marker.rotation ?? 0) * Math.PI) / 180);
        gl.uniform1f(u.u_ground, ground ? 1 : 0);
        gl.uniform1f(u.u_opacity, marker.opacity ?? 1);
        if (marker.occlude === false) gl.disable(gl.DEPTH_TEST);
        else gl.enable(gl.DEPTH_TEST);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    forget(image) {
      const known = textures.get(image);
      if (!known) return;
      gl.deleteTexture(known.texture);
      textures.delete(image);
    },
    release() {
      for (const {texture: owned} of textures.values()) gl.deleteTexture(owned);
      textures.clear();
      if (program) gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(corners);
      program = undefined;
    },
  };
}

const vertexSource = ({vertexShaderPrelude, define}: ShaderData) => `#version 300 es
${vertexShaderPrelude}
${define}
in vec2 a_corner; // 0 to 1 across the image, from its top left
uniform vec2 u_anchor; // tile units
uniform float u_altitude; // metres
uniform vec2 u_size; // CSS pixels on screen, tile units on the ground
uniform vec2 u_origin; // the image point on the position, 0 to 1
uniform vec2 u_offset; // CSS pixels, right and down
uniform float u_rotation; // radians clockwise
uniform float u_ground;
uniform vec2 u_pixel; // clip units per CSS pixel
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  // Image space runs right and down, as screen space and tile units (east and south) do.
  vec2 local = (a_corner - u_origin) * u_size;
  float c = cos(u_rotation);
  float s = sin(u_rotation);
  vec2 turned = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  if (u_ground > 0.5) {
    gl_Position = projectTileFor3D(u_anchor + turned, u_altitude);
    return;
  }
  vec4 clip = projectTileFor3D(u_anchor, u_altitude);
  if (clip.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 screen = turned + u_offset;
  clip.xy += vec2(screen.x, -screen.y) * u_pixel * clip.w;
  gl_Position = clip;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 colour = texture(u_image, v_uv) * u_opacity;
  if (colour.a < 0.004) discard;
  fragColor = colour;
}`;
