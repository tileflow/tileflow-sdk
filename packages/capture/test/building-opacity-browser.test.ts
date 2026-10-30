import assert from 'node:assert/strict';
import test from 'node:test';
import {drawBuildingOpacity} from '../../core/src/buildings-3d-opacity';
import {tileflowSceneOpacity} from '../../core/src/scene-3d-visibility';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'zoom opacity blends nearest surfaces without grain or rear-wall bleed and leaves the opaque state',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="32" height="32"></canvas>');
      await page.addScriptTag({
        content: `window.__name = fn => fn; window.drawBuildingOpacity = ${drawBuildingOpacity.toString()};`,
      });
      const zooms = [14.99, 15, 15.0625, 15.125, 15.1875, 15.25, 16, 15.125, 15];
      const result = await page.evaluate(
        (opacities) => {
          const gl = document.querySelector('canvas')!.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          const program = gl.createProgram()!;
          for (const [type, source] of [
            [
              gl.VERTEX_SHADER,
              `#version 300 es
uniform float u_depth;
void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(uv * 2.0 - 1.0, u_depth, 1.0);
}`,
            ],
            [
              gl.FRAGMENT_SHADER,
              `#version 300 es
precision highp float;
uniform vec3 u_colour;
out vec4 fragColor;
void main() { fragColor = vec4(u_colour, 1.0); }`,
            ],
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
          const draw = (depth: number, colour: number[]) => {
            gl.uniform1f(gl.getUniformLocation(program, 'u_depth'), depth);
            gl.uniform3fv(gl.getUniformLocation(program, 'u_colour'), colour);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          };
          const render = (
            globalThis as unknown as {drawBuildingOpacity: typeof drawBuildingOpacity}
          ).drawBuildingOpacity;
          // The fade reads no GL state back: it starts from and leaves the buildings' opaque state.
          const state = () => [
            gl.isEnabled(gl.BLEND),
            gl.getParameter(gl.DEPTH_WRITEMASK),
            gl.getParameter(gl.DEPTH_FUNC),
            [...gl.getParameter(gl.COLOR_WRITEMASK)],
          ];
          return opacities.map((opacity) => {
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.depthFunc(gl.LEQUAL);
            gl.disable(gl.BLEND);
            gl.blendColor(0.1, 0.2, 0.3, 0.4);
            gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
            gl.clearColor(0.4, 0.4, 0.4, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            const before = state();
            let draws = 0;
            render(gl, opacity, () => {
              draws++;
              draw(0.5, [1, 0, 0]); // Rear wall; must never bleed through the nearest facade.
              draw(-0.5, [0, 1, 0]);
            });
            const after = state();
            const pixels = new Uint8Array(32 * 32 * 4);
            gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return {
              opacity,
              pixels: Array.from(pixels),
              draws,
              before,
              after,
              error: gl.getError(),
            };
          });
        },
        zooms.map((zoom) => tileflowSceneOpacity(zoom)),
      );
      for (const sample of result) {
        assert.equal(sample.error, 0);
        assert.deepEqual(sample.after, sample.before, "leave the buildings' opaque state");
        assert.equal(sample.draws, sample.opacity === 0 ? 0 : sample.opacity === 1 ? 1 : 2);
        const expected = [
          0.4 * (1 - sample.opacity),
          0.4 + 0.6 * sample.opacity,
          0.4 * (1 - sample.opacity),
          1,
        ].map((value) => Math.round(value * 255));
        for (let pixel = 0; pixel < sample.pixels.length; pixel += 4)
          for (let channel = 0; channel < 4; channel++)
            assert.ok(
              Math.abs(sample.pixels[pixel + channel]! - expected[channel]!) <= 1,
              `uniform opacity ${sample.opacity}, channel ${channel}: ${sample.pixels[pixel + channel]}`,
            );
      }
    } finally {
      await browser.close();
    }
  },
);
