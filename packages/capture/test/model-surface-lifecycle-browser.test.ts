import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {build} from 'tsup';
import {encodeTileflowModels} from '../../core/src/models-3d-file';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'textured model loading, GPU upload and disposal use the prepared physical surface',
  {
    skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1',
  },
  async (t) => {
    // Exercise literal backslashes on POSIX too; Windows temporary paths contain them already.
    const prefix =
      process.platform === 'win32' ? 'tileflow-material-' : 'tileflow-material-\\literal-';
    const directory = await mkdtemp(join(tmpdir(), prefix));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const source = (file: string) =>
      JSON.stringify(fileURLToPath(new URL(`../../core/src/${file}.ts`, import.meta.url)));
    await writeFile(
      join(directory, 'fixture.ts'),
      `
export {createTileflowPlacedModels} from ${source('models-3d-browser')};
export {bindModelMaterial} from ${source('models-3d-materials-browser')};
export * from ${source('models-3d-emitters')};
export * from ${source('models-3d-shaders')};`,
    );
    await build({
      entry: {fixture: join(directory, 'fixture.ts')},
      outDir: directory,
      format: ['iife'],
      globalName: 'ModelFixture',
      platform: 'browser',
      dts: false,
      silent: true,
      clean: false,
    });
    const image = new PNG({width: 1, height: 1});
    image.data.set([128, 255, 0, 255]);
    const bytes = encodeTileflowModels([
      {
        id: 'textured',
        footprint: [[-1, -1, 1, -1, 0, 1, -1, -1]],
        levels: [
          {
            positions: [-1, -1, 1, 1, -1, 1, 0, 1, 1],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            parts: [0, 0, 0],
            shades: [0, 0, 0],
            occlusion: [1, 1, 1],
            indices: [0, 1, 2],
            surface: {
              attributes: [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 1],
              materials: [
                {
                  baseColorFactor: [0.8, 0.6, 0.4, 1],
                  unlit: true,
                  doubleSided: true,
                  baseColorTexture: {texture: 0},
                },
              ],
              textures: [
                {bytes: PNG.sync.write(image), width: 1, height: 1, mimeType: 'image/png'},
              ],
              ranges: [{from: 0, count: 3, material: 0}],
            },
          },
        ],
      },
    ]);
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="16" height="16"></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      await page.addScriptTag({
        content: await readFile(join(directory, 'fixture.global.js'), 'utf8'),
      });
      const result = await page.evaluate(
        async (data) => {
          const api = (
            window as unknown as {
              ModelFixture: typeof import('../../core/src/models-3d-browser') &
                typeof import('../../core/src/models-3d-materials-browser') &
                typeof import('../../core/src/models-3d-emitters') &
                typeof import('../../core/src/models-3d-shaders');
            }
          ).ModelFixture;
          const gl = document.querySelector('canvas')!.getContext('webgl2')!;
          window.fetch = async () => new Response(new Uint8Array(data));
          const models = api.createTileflowPlacedModels({changed() {}});
          const placements = [
            {
              model: 'textured',
              url: 'https://models.example/fixture.glb',
              at: [0, 0] as const,
              heading: 0,
            },
          ];
          const tiles = [{x: 16384, y: 16384}];
          models.update(placements, undefined, tiles, 15, true);
          await models.settle({x: 16384, y: 16384, z: 15}, new AbortController().signal);
          models.update(placements, undefined, tiles, 15, true);
          models.upload(gl);
          const entry = models.shown()[0]!;
          if (!entry?.gl?.[0]?.surface)
            throw new Error('The textured model did not become resident.');
          const buffers = entry.gl[0],
            surface = buffers.surface!;
          const bitmap = entry.images![0]![0]!;
          const program = gl.createProgram()!;
          for (const [type, source] of [
            [
              gl.VERTEX_SHADER,
              api.tileflowModelVertex(
                'vec4 projectTileFor3D(vec2 p, float z) { return vec4(p.x, -p.y, 0.0, 1.0); }',
              ),
            ],
            [gl.FRAGMENT_SHADER, api.tileflowModelFragment],
          ] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(shader)!);
            gl.attachShader(program, shader);
          }
          for (const [index, [name]] of [
            ...api.tileflowModelAttributes,
            ...api.tileflowModelSurfaceAttributes,
          ].entries())
            gl.bindAttribLocation(program, index, name);
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(program)!);
          gl.useProgram(program);
          const uniforms: Record<string, WebGLUniformLocation | null> = {};
          for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
            const name = gl.getActiveUniform(program, i)!.name;
            uniforms[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, name);
          }
          api.bindModelMaterial(
            gl,
            uniforms,
            entry.model.levels[0]!.surface!.materials[0],
            surface,
            surface.textures[0]!,
          );
          gl.uniform3fv(uniforms.u_level_centre!, entry.model.levels[0]!.centre);
          gl.uniform1f(uniforms.u_level_step!, entry.model.levels[0]!.step);
          gl.uniform1f(uniforms.u_model_metres!, 1);
          gl.uniform1f(uniforms.u_scale!, 1);
          gl.uniform1f(uniforms.u_opacity!, 1);
          gl.uniform2f(uniforms.u_heading!, 1, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.DEPTH_COMPONENT32F,
            1,
            1,
            0,
            gl.DEPTH_COMPONENT,
            gl.FLOAT,
            new Float32Array([1]),
          );
          gl.bindVertexArray(buffers.vao);
          gl.drawElements(gl.TRIANGLES, 3, buffers.type, 0);
          const pixel = new Uint8Array(4);
          gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const emitterProgram = gl.createProgram()!;
          for (const [type, source] of [
            [
              gl.VERTEX_SHADER,
              api.modelEmitterVertex(
                'vec4 projectTileFor3D(vec2 p, float z) { return vec4(p.x / 4.0, p.y / 2.5 - 1.0, 0.0, 1.0); }',
              ),
            ],
            [gl.FRAGMENT_SHADER, api.modelEmitterFragment],
          ] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            gl.attachShader(emitterProgram, shader);
          }
          gl.linkProgram(emitterProgram);
          if (!gl.getProgramParameter(emitterProgram, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(emitterProgram)!);
          gl.useProgram(emitterProgram);
          const at = (name: string) => gl.getUniformLocation(emitterProgram, name);
          const geometry = api.modelEmitterGeometry({
            start: [-1, 0, 0],
            end: [1, 0, 0],
            height: 3,
            role: 'door',
            part: 'accent',
          });
          gl.uniform3fv(at('u_emitter_positions'), geometry.positions);
          gl.uniform4fv(at('u_emitter_coordinates'), geometry.coordinates);
          gl.uniform1f(at('u_scale'), 1);
          gl.uniform1f(at('u_model_metres'), 1);
          gl.uniform2f(at('u_heading'), 1, 0);
          gl.uniform3f(at('u_emitter_colour'), 1, 0.8, 0.6);
          gl.uniform1f(at('u_emitter_strength'), 1.5);
          gl.uniform1f(at('u_opacity'), 1);
          gl.bindVertexArray(null);
          const spill = (enabled: boolean) => {
            gl.uniform1f(at('u_emitter_strength'), enabled ? 1.5 : 0);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 12);
            const near = new Uint8Array(4),
              far = new Uint8Array(4);
            gl.readPixels(8, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, near);
            gl.readPixels(8, 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, far);
            return {near: [...near], far: [...far]};
          };
          const litSpill = spill(true),
            unlitSpill = spill(false);
          models.release(gl);
          // A context restoration reuses decoded images and recreates only GPU resources.
          const released = !gl.isBuffer(surface.vbo) && !gl.isTexture(surface.textures[0]!);
          models.upload(gl);
          const restored = Boolean(entry.gl?.[0]?.surface && bitmap.width === 1);
          models.release(gl);
          models.dispose();
          return {
            pixel: [...pixel],
            litSpill,
            unlitSpill,
            released,
            restored,
            closed: bitmap.width === 0,
            error: gl.getError(),
          };
        },
        [...bytes],
      );
      assert.equal(result.error, 0);
      assert.ok(result.pixel[0]! >= 113 && result.pixel[0]! <= 117);
      assert.ok(result.pixel[1]! >= 202 && result.pixel[1]! <= 205);
      assert.equal(result.pixel[2], 0);
      assert.ok(
        result.litSpill.near[0]! > result.litSpill.near[2]! && result.litSpill.near[3]! > 100,
      );
      assert.deepEqual(result.litSpill.far, [0, 0, 0, 0]);
      assert.deepEqual(result.unlitSpill.near, [0, 0, 0, 0]);
      assert.ok(result.released && result.restored && result.closed);
    } finally {
      await browser.close();
    }
  },
);
