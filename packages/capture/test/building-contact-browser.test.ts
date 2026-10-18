import assert from 'node:assert/strict';
import test from 'node:test';
import {meshTileflowBuildings} from '../../core/src/buildings-3d-mesh';
import {
  buildingContactFragment,
  buildingContactSegments,
  buildingContactVertex,
  createBuildingContactMask,
  createBuildingContactVao,
  tileflowBuildingOcclusion,
} from '../../core/src/buildings-3d-occlusion';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'ground contact uses a smooth union, preserves GL state and resizes its mask',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const mesh = meshTileflowBuildings(
      {
        extent: 8192,
        features: [
          {
            type: 'Polygon',
            properties: {render_height: 20},
            geometry: [[2048, 2048, 6144, 2048, 6144, 6144, 2048, 6144, 2048, 2048]],
          },
        ],
      },
      {tileMetres: 16},
    )!;
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="128" height="128"></canvas>');
      // tsx preserves function names in the test callback sent to the browser.
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const result = await page.evaluate(
        ({vertex, fragment, maskSource, vaoSource, segments, defaults}) => {
          const canvas = document.querySelector('canvas')!;
          const gl = canvas.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          // Execute the production helpers, with the segment bytes supplied by the production mesher.
          const helpers = new Function(
            '__name',
            'buildingContactSegments',
            `return {mask: (${maskSource})(), vao: ${vaoSource}}`,
          )(
            (fn: unknown) => fn,
            (bytes: number[] | null) => new Uint8Array(bytes ?? segments),
          );
          const mask = helpers.mask as ReturnType<typeof createBuildingContactMask>;
          const shader = (type: number, source: string) => {
            const value = gl.createShader(type)!;
            gl.shaderSource(value, source);
            gl.compileShader(value);
            if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(value)!);
            return value;
          };
          const program = gl.createProgram()!;
          gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
          gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(program)!);
          gl.useProgram(program);
          gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), 1);
          gl.uniform1f(gl.getUniformLocation(program, 'u_metres'), 1 / 512);
          gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), 1);
          gl.uniform1f(gl.getUniformLocation(program, 'u_band'), defaults.ground);
          gl.uniform1f(gl.getUniformLocation(program, 'u_band_strength'), defaults.groundStrength);
          let buffers = helpers.vao(gl, null) as ReturnType<typeof createBuildingContactVao>;
          gl.bindVertexArray(buffers.vao);
          gl.enable(gl.BLEND);
          gl.enable(gl.DEPTH_TEST);
          gl.enable(gl.CULL_FACE);
          gl.enable(gl.STENCIL_TEST);
          gl.enable(gl.SCISSOR_TEST);
          gl.clearColor(0.2, 0.4, 0.6, 0.8);
          gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_REVERSE_SUBTRACT);
          const state = () => [
            gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
            ...[gl.DEPTH_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.SCISSOR_TEST].map((cap) =>
              gl.isEnabled(cap),
            ),
            gl.getParameter(gl.BLEND_EQUATION_RGB),
            gl.getParameter(gl.BLEND_EQUATION_ALPHA),
            ...gl.getParameter(gl.COLOR_CLEAR_VALUE),
          ];
          const before = state();
          let restored = true;
          const read = (copies: number, width = 128) => {
            const texture = mask.render(gl, () => {
              for (let index = 0; index < copies; index++)
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buffers.count);
            });
            restored &&= JSON.stringify(state()) === JSON.stringify(before);
            const reader = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, reader);
            gl.framebufferTexture2D(
              gl.READ_FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              texture,
              0,
            );
            const pixels = new Uint8Array(width * 128 * 4);
            gl.readPixels(0, 0, width, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.deleteFramebuffer(reader);
            return [...pixels.filter((_, index) => index % 4 === 0)];
          };
          const single = read(1);
          const overlap = read(8);
          const renderSegments = (walls: number[][]) => {
            gl.deleteVertexArray(buffers.vao);
            gl.deleteBuffer(buffers.vbo);
            const bytes = new Uint8Array(walls.length * 16);
            const view = new DataView(bytes.buffer);
            walls.forEach(([ax, ay, bx, by, cuts = 0, base = 0], index) => {
              [ax!, ay!, bx!, by!, base, 200].forEach((value, field) =>
                view.setUint16(index * 16 + field * 2, value, true),
              );
              bytes[index * 16 + 13] = cuts;
            });
            buffers = helpers.vao(gl, [...bytes]);
            gl.bindVertexArray(buffers.vao);
            return read(1);
          };
          const continuous = renderSegments([[1500, 2000, 6500, 6000]]);
          const split = renderSegments([
            [1500, 2000, 4000, 4000, 2],
            [4000, 4000, 6500, 6000, 1],
          ]);
          const raised = renderSegments([[1500, 2000, 6500, 6000, 0, 40]]);
          renderSegments([[1500, 2000, 6500, 6000]]);
          const zooms = [16, 17, 18, 19, 20, 21, 22].map((zoom) => {
            const scale = 2 ** (zoom - 20);
            gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), scale);
            gl.uniform1f(gl.getUniformLocation(program, 'u_metres'), 1 / 128);
            const pixels = renderSegments([[3950, 4096, 4240, 4096]]);
            const radius = defaults.ground * 2 * scale;
            const column = Array.from({length: 64}, (_, y) => pixels[(64 + y) * 128 + 64]!);
            return {
              zoom,
              radius,
              darkest: Math.min(...column),
              outsideClear: column.every((value, y) => y + 0.5 < radius || value === 255),
            };
          });
          gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), 1);
          gl.uniform1f(gl.getUniformLocation(program, 'u_metres'), 1 / 512);
          let threw = false;
          try {
            mask.render(gl, () => {
              throw new Error('interrupted draw');
            });
          } catch {
            threw = true;
          }
          restored &&= JSON.stringify(state()) === JSON.stringify(before);
          canvas.width = 160;
          gl.viewport(0, 0, 160, 128);
          const resized = read(1, 160);
          mask.release(gl);
          mask.release(gl);
          return {
            single,
            overlap,
            continuous,
            split,
            raised,
            zooms,
            resized,
            restored,
            threw,
            error: gl.getError(),
          };
        },
        {
          vertex: buildingContactVertex(
            'precision highp float; uniform float u_zoom; vec4 projectTileFor3D(vec2 p, float z) { return vec4((p / 4096.0 - 1.0) * u_zoom, z, 1.0); }',
          ),
          defaults: tileflowBuildingOcclusion,
          fragment: buildingContactFragment,
          maskSource: createBuildingContactMask.toString(),
          vaoSource: createBuildingContactVao.toString(),
          segments: [...buildingContactSegments(mesh)],
        },
      );
      assert.equal(result.error, 0, 'WebGL must accept the mask and instanced segment draw');
      assert.deepEqual(
        result.single,
        result.overlap,
        'overlapping walls must not accumulate darkness',
      );
      assert.ok(
        result.continuous.every((pixel, index) => Math.abs(pixel - result.split[index]!) <= 1),
        'a wall crossing a tile boundary must keep a continuous contact shadow',
      );
      assert.ok(
        result.raised.every((pixel) => pixel === 255),
        'raised parts must not shade the ground',
      );
      assert.equal(result.restored, true, 'mask drawing must preserve the map render state');
      assert.equal(result.threw, true);
      assert.ok(Math.min(...result.single) >= 214, 'contact strength must stay bounded at corners');
      for (const [index, zoom] of result.zooms.entries()) {
        assert.equal(
          zoom.outsideClear,
          true,
          `z${zoom.zoom}: contact reach must remain three metres`,
        );
        assert.ok(zoom.darkest >= 214, `z${zoom.zoom}: contact must never exceed 16 percent`);
        if (index)
          assert.ok(
            result.zooms[index - 1]!.darkest >= zoom.darkest,
            'zooming out must fade subpixel contact smoothly',
          );
      }
      const sample = (x: number, y: number) => result.single[y * 128 + x]!;
      assert.ok(sample(97, 64) < sample(104, 64));
      assert.ok(sample(104, 64) < sample(112, 64));
      assert.equal(sample(121, 64), 255, 'the band fades completely outside its radius');
      assert.ok(sample(100, 100) < 255, 'convex corners must have round joins, without gaps');
      assert.ok(
        result.resized.some((value) => value < 255),
        'resizing must retain the shade',
      );
    } finally {
      await browser.close();
    }
  },
);
