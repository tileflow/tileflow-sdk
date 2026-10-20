import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuildingContactMask} from '../../core/src/buildings-3d-occlusion';
import {
  buildingArchitecturalFloodFragment,
  buildingArchitecturalFloodVertex,
} from '../../core/src/buildings-3d-shaders';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'architectural ground light respects height, radius and non-accumulating attenuation',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="32" height="128"></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const result = await page.evaluate(
        ({vertex, fragment, maskSource}) => {
          const gl = document.querySelector('canvas')!.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          const mask = new Function('__name', `return (${maskSource})()`)(
            (fn: unknown) => fn,
          ) as ReturnType<typeof createBuildingContactMask>;
          const program = gl.createProgram()!;
          for (const [type, source] of [
            [gl.VERTEX_SHADER, vertex],
            [gl.FRAGMENT_SHADER, fragment],
          ] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
              throw new Error(gl.getShaderInfoLog(shader)!);
            gl.attachShader(program, shader);
          }
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(program)!);
          gl.useProgram(program);
          const buffer = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 1]),
            gl.STATIC_DRAW,
          );
          for (const [name, count, offset] of [
            ['a_pos', 2, 0],
            ['a_flags', 1, 8],
          ] as const) {
            const at = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(at);
            gl.vertexAttribPointer(at, count, gl.FLOAT, false, 12, offset);
          }
          gl.vertexAttrib2f(gl.getAttribLocation(program, 'a_normal'), 0, 1);
          gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), 1);
          gl.uniform1f(gl.getUniformLocation(program, 'u_metres'), 50);
          gl.uniform1f(gl.getUniformLocation(program, 'u_min_height'), 30);
          gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), 0.3);
          gl.uniform2f(gl.getUniformLocation(program, 'u_radius'), 30, 100);
          gl.enable(gl.BLEND);
          const read = (height: number, base = 0, seed = 0, copies = 1) => {
            gl.vertexAttrib2f(gl.getAttribLocation(program, 'a_height'), base * 10, height * 10);
            gl.vertexAttrib2f(gl.getAttribLocation(program, 'a_wave'), seed, 0);
            const texture = mask.render(gl, () => {
              for (let i = 0; i < copies; i++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            });
            const reader = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, reader);
            gl.framebufferTexture2D(
              gl.READ_FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              texture,
              0,
            );
            const pixels = new Uint8Array(32 * 128 * 4);
            gl.readPixels(0, 0, 32, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.deleteFramebuffer(reader);
            return Array.from({length: 128}, (_, y) => pixels[(y * 32 + 16) * 4]!);
          };
          const result = {
            low: read(29.9),
            threshold: read(30),
            overlap: read(30, 0, 0, 8),
            raised: read(30, 0.6),
            wide: read(30, 0, 1),
          };
          mask.release(gl);
          return {...result, error: gl.getError()};
        },
        {
          vertex: buildingArchitecturalFloodVertex(
            'precision highp float; vec4 projectTileFor3D(vec2 p, float z) { return vec4(p.x, p.y - 1.0, z, 1.0); }',
          ),
          fragment: buildingArchitecturalFloodFragment,
          maskSource: createBuildingContactMask.toString(),
        },
      );
      assert.equal(result.error, 0);
      assert.ok(result.low.every((value) => value === 255));
      assert.ok(result.raised.every((value) => value === 255));
      assert.deepEqual(result.threshold, result.overlap, 'overlapping lights must not accumulate');
      for (const [radius, pixels] of [
        [30, result.threshold],
        [100, result.wide],
      ] as const) {
        for (let y = 0; y < 128; y++) {
          const distance = ((y + 0.5) / 128) * 100;
          const expected = 255 * (1 - 0.3 * Math.max(0, 1 - distance / radius) ** 2.101);
          assert.ok(Math.abs(pixels[y]! - expected) <= 1, `${radius} m radius, row ${y}`);
        }
      }
    } finally {
      await browser.close();
    }
  },
);
