import {modelEmitterGeometry} from './models-3d-emitters';
import {type TileflowModelMaterial, tileflowModelTextureChannels} from './models-3d-materials';
import type {TileflowModelBytes, TileflowModelLevelBytes} from './models-3d-model';
import {tileflowModelAttributes} from './models-3d-shaders';

export type TileflowModelImages = readonly (readonly ImageBitmap[])[];
export type TileflowModelSurfaceBuffers = {
  /** The surface attributes that differ from vertex to vertex, when any does. */
  vbo?: WebGLBuffer;
  /** By surface attribute, the value every vertex shares, set before drawing, or undefined. */
  shared: readonly (Float32Array | undefined)[];
  textures: WebGLTexture[];
  emitters: ReturnType<typeof modelEmitterGeometry>[];
  centres: Float32Array;
};

/** Decode before making a model resident; a bad image leaves the ordinary buildings standing. */
export async function readModelImages(
  model: TileflowModelBytes,
  signal: AbortSignal,
): Promise<TileflowModelImages> {
  const buffers = new Map<ArrayBufferLike, number>();
  const pending = new Map<string, Promise<ImageBitmap>>();
  const levels = model.levels.map((level) =>
    (level.surface?.textures ?? []).map((texture) => {
      const {bytes} = texture;
      if (!buffers.has(bytes.buffer)) buffers.set(bytes.buffer, buffers.size);
      const key = `${buffers.get(bytes.buffer)}:${bytes.byteOffset}:${bytes.byteLength}`;
      let image = pending.get(key);
      if (!image) {
        image = createImageBitmap(new Blob([bytes.slice().buffer], {type: texture.mimeType}), {
          imageOrientation: 'none',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        }).then((bitmap) => {
          if (bitmap.width !== texture.width || bitmap.height !== texture.height) {
            bitmap.close();
            throw new RangeError('Model texture dimensions changed during decoding.');
          }
          return bitmap;
        });
        pending.set(key, image);
      }
      return image;
    }),
  );
  const settled = await Promise.allSettled(pending.values());
  if (signal.aborted || settled.some((result) => result.status === 'rejected')) {
    for (const result of settled) if (result.status === 'fulfilled') result.value.close();
    signal.throwIfAborted();
    throw new RangeError('A model texture could not be decoded.');
  }
  return Promise.all(levels.map((level) => Promise.all(level)));
}

export function closeModelImages(images: TileflowModelImages | undefined): void {
  for (const image of new Set(images?.flat())) image.close();
}

/** Called with the model VAO bound. Images remain available for WebGL context restoration. */
export function uploadModelSurface(
  gl: WebGL2RenderingContext,
  level: TileflowModelLevelBytes,
  images: readonly ImageBitmap[],
): TileflowModelSurfaceBuffers | undefined {
  if (!level.surface) return undefined;
  // A value every vertex shares is not uploaded: its attribute stays off, and drawing sets it.
  const streams = [level.surface.uv, level.surface.rgba];
  const shared = streams.map((stream) => (stream.length === 4 ? stream : undefined));
  const bytes = streams.reduce(
    (sum, stream) => sum + (stream.length > 4 ? stream.byteLength : 0),
    0,
  );
  let vbo: WebGLBuffer | undefined;
  if (bytes > 0) {
    vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
  }
  let offset = 0;
  for (const [index, stream] of streams.entries()) {
    const location = index + tileflowModelAttributes.length;
    if (stream.length === 4) {
      gl.disableVertexAttribArray(location);
      continue;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, offset, stream);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 16, offset);
    offset += stream.byteLength;
  }
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  // Occlusion reads only red: a texture no other channel uses takes one byte a texel.
  const coloured = new Set<number>();
  for (const material of level.surface.materials)
    for (const channel of tileflowModelTextureChannels)
      if (channel !== 'occlusionTexture' && material[channel])
        coloured.add(material[channel].texture);
  try {
    const textures = level.surface.textures.map((source, index) => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, source.wrapS ?? gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, source.wrapT ?? gl.REPEAT);
      const min = source.minFilter ?? gl.LINEAR_MIPMAP_LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, source.magFilter ?? gl.LINEAR);
      if (coloured.has(index))
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, images[index]!);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, images[index]!);
      if (min >= gl.NEAREST_MIPMAP_NEAREST) gl.generateMipmap(gl.TEXTURE_2D);
      return texture;
    });
    const vertices = new DataView(
      level.vertices.buffer,
      level.vertices.byteOffset,
      level.vertices.byteLength,
    );
    const centres = new Float32Array(level.surface.ranges.length * 3);
    for (const [index, range] of level.surface.ranges.entries()) {
      const centre = [0, 0, 0];
      for (let at = range.from; at < range.from + range.count; at++)
        for (let axis = 0; axis < 3; axis++)
          centre[axis]! +=
            level.centre[axis]! +
            vertices.getInt16(level.indices[at]! * 16 + axis * 2, true) * level.step;
      centres.set(
        [centre[0]! / range.count, -centre[2]! / range.count, centre[1]! / range.count],
        index * 3,
      );
    }
    return {
      ...(vbo ? {vbo} : {}),
      shared,
      textures,
      centres,
      emitters: (level.surface.emitters ?? []).map(modelEmitterGeometry),
    };
  } finally {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  }
}

/** Sets the surface attributes every vertex of a level shares; drawing the level reads them. */
export function bindModelSurfaceShared(
  gl: WebGL2RenderingContext,
  buffers: TileflowModelSurfaceBuffers,
): void {
  for (const [index, value] of buffers.shared.entries())
    if (value) gl.vertexAttrib4fv(index + tileflowModelAttributes.length, value);
}

/** The same alpha and texture bindings serve the colour and solar-shadow programs. */
export function bindModelMaterial(
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
  material: TileflowModelMaterial | undefined,
  buffers: TileflowModelSurfaceBuffers | undefined,
  blank: WebGLTexture,
): void {
  const at = (name: string) => uniforms[name] ?? null;
  gl.uniform1i(at('u_physical'), material ? 1 : 0);
  const enabled = new Float32Array(5),
    transforms = new Float32Array(20);
  const rotations = new Float32Array(5),
    coordinates = new Float32Array(5);
  for (const [index, channel] of tileflowModelTextureChannels.entries()) {
    const ref = material?.[channel];
    gl.activeTexture(gl.TEXTURE0 + 2 + index);
    gl.bindTexture(gl.TEXTURE_2D, ref ? buffers!.textures[ref.texture]! : blank);
    gl.uniform1i(at(`u_material_texture${index}`), 2 + index);
    enabled[index] = ref ? 1 : 0;
    transforms.set([...(ref?.offset ?? [0, 0]), ...(ref?.scale ?? [1, 1])], index * 4);
    rotations[index] = ref?.rotation ?? 0;
    coordinates[index] = ref?.texCoord ?? 0;
  }
  gl.uniform1fv(at('u_texture_enabled'), enabled);
  gl.uniform4fv(at('u_texture_transform'), transforms);
  gl.uniform1fv(at('u_texture_rotation'), rotations);
  gl.uniform1fv(at('u_texture_coord'), coordinates);
  gl.uniform4fv(at('u_base_colour'), material?.baseColorFactor ?? [1, 1, 1, 1]);
  gl.uniform1f(at('u_metallic'), material?.metallicFactor ?? 1);
  gl.uniform1f(at('u_roughness'), material?.roughnessFactor ?? 1);
  gl.uniform3fv(
    at('u_emissive'),
    (material?.emissiveFactor ?? [0, 0, 0]).map((c) => c * (material?.emissiveStrength ?? 1)),
  );
  gl.uniform1f(at('u_normal_strength'), material?.normalTexture?.strength ?? 1);
  gl.uniform1f(at('u_occlusion_strength'), material?.occlusionTexture?.strength ?? 1);
  gl.uniform1i(at('u_unlit'), material?.unlit ? 1 : 0);
  gl.uniform1i(
    at('u_alpha_mode'),
    material?.alphaMode === 'MASK' ? 1 : material?.alphaMode === 'BLEND' ? 2 : 0,
  );
  gl.uniform1f(at('u_alpha_cutoff'), material?.alphaCutoff ?? 0.5);
  if (material && !material.doubleSided) {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  } else gl.disable(gl.CULL_FACE);
}
