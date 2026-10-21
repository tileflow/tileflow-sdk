import {type TileflowBuildingMesh, tileflowBuildingVertexBytes} from './buildings-3d-mesh';

// Shared by every map that enables building occlusion; reach is in metres, never screen pixels.
export const tileflowBuildingOcclusion = {
  ground: 3,
  groundStrength: 0.16,
  wall: 0.14,
  wallRadius: 3,
  corner: 3,
};

/** One 16-byte segment per wall: endpoints, heights, growth seed and tile cuts. */
export function buildingContactSegments(mesh: TileflowBuildingMesh): Uint8Array {
  const count = (mesh.indices.length - mesh.wallsFrom) / 6;
  const bytes = new Uint8Array(count * 16);
  for (let wall = 0; wall < count; wall += 1) {
    const index = mesh.wallsFrom + wall * 6;
    const start = mesh.indices[index]! * tileflowBuildingVertexBytes;
    const end = mesh.indices[index + 1]! * tileflowBuildingVertexBytes;
    // Roof and wall vertices are interleaved by building; only the index ranges are sorted.
    bytes.set(mesh.vertices.subarray(start, start + 4), wall * 16);
    bytes.set(mesh.vertices.subarray(end, end + 4), wall * 16 + 4);
    bytes.set(mesh.vertices.subarray(start + 4, start + 8), wall * 16 + 8);
    bytes[wall * 16 + 12] = mesh.vertices[start + 14]!;
    bytes[wall * 16 + 13] = mesh.vertices[start + 27]!;
  }
  return bytes;
}

// Distance to each segment gives round joins without relying on smoothed facade normals.
export function createBuildingContactVao(gl: WebGL2RenderingContext, segments: Uint8Array) {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, segments, gl.STATIC_DRAW);
  const offset = (first: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (const [location, size, type, normalised, byte] of [
      [0, 2, gl.UNSIGNED_SHORT, false, 0],
      [1, 2, gl.UNSIGNED_SHORT, false, 4],
      [2, 2, gl.UNSIGNED_SHORT, false, 8],
      [3, 1, gl.UNSIGNED_BYTE, true, 12],
      [4, 1, gl.UNSIGNED_BYTE, false, 13],
    ] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalised, 16, first * 16 + byte);
      gl.vertexAttribDivisor(location, 1);
    }
  };
  offset(0);
  gl.bindVertexArray(null);
  return {vao, vbo, count: segments.length / 16, offset};
}

export const buildingContactVertex = (projected: string): string => `#version 300 es
${projected}
layout(location=0) in vec2 a_start;
layout(location=1) in vec2 a_end;
layout(location=2) in vec2 a_heights;
layout(location=3) in float a_seed;
layout(location=4) in float a_cuts;
uniform float u_scale;
uniform float u_metres;
uniform float u_band;
out vec2 v_point;
flat out float v_length;
flat out float v_strength;
void main() {
  float p = clamp(u_scale * 1.25 - a_seed * 0.25, 0.0, 1.0);
  if (p <= 0.0 || a_heights.x > 5.0 || a_heights.y <= a_heights.x) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 edge = (a_end - a_start) * u_metres;
  v_length = length(edge);
  vec2 tangent = edge / max(v_length, 0.0001);
  // A tile cut continues in its neighbour; do not round that artificial endpoint.
  float startCap = mod(a_cuts, 2.0) < 0.5 ? u_band : 0.0;
  float endCap = a_cuts < 2.0 ? u_band : 0.0;
  v_point = vec2((gl_VertexID & 1) == 0 ? -startCap : v_length + endCap,
    gl_VertexID < 2 ? -u_band : u_band);
  vec2 point = a_start + (tangent * v_point.x + vec2(-tangent.y, tangent.x) * v_point.y) / u_metres;
  gl_Position = projectTileFor3D(point, 0.0);
  v_strength = p * p * (3.0 - 2.0 * p);
}`;

export const buildingContactFragment = `#version 300 es
precision highp float;
in vec2 v_point;
flat in float v_length;
flat in float v_strength;
uniform float u_band;
uniform float u_band_strength;
out vec4 fragColor;
void main() {
  float distance = length(v_point - vec2(clamp(v_point.x, 0.0, v_length), 0.0));
  float near = 1.0 - smoothstep(0.0, u_band, distance);
  float shade = 1.0 - u_band_strength * near * near * v_strength;
  fragColor = vec4(vec3(shade), 1.0);
}`;

export const buildingContactCompositeFragment = `#version 300 es
precision highp float;
uniform highp sampler2D u_contact;
out vec4 fragColor;
void main() {
  float shade = texelFetch(u_contact, ivec2(gl_FragCoord.xy), 0).r;
  fragColor = vec4(vec3(shade), 1.0);
}`;

/**
 * A single-channel screen mask: overlapping walls keep the strongest shade, never multiply it.
 * Drawn from a custom layer's prerender, before MapLibre binds the map's framebuffer for its main
 * pass: switching framebuffers within that pass forces tiled GPUs to store and reload the frame.
 */
export function createBuildingContactMask() {
  let target:
    | {texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number}
    | undefined;

  function release(gl: WebGL2RenderingContext) {
    if (!target) return;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
    target = undefined;
  }

  return {
    release,
    /**
     * Draws the mask at the drawing buffer's size and returns its texture. Sets every state it
     * relies on and leaves the map's framebuffer bound with the default blend equation; MapLibre
     * restores the rest of its own state after a prerender.
     */
    render(gl: WebGL2RenderingContext, draw: () => void): WebGLTexture {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      if (!target || target.width !== width || target.height !== height) {
        release(gl);
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D, null);
        const framebuffer = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        target = {texture, framebuffer, width, height};
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MIN);
      try {
        draw();
        return target.texture;
      } finally {
        gl.bindVertexArray(null);
        gl.blendEquation(gl.FUNC_ADD);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
      }
    },
  };
}
