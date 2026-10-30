import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowBuildingOcclusion} from '../../core/src/buildings-3d-occlusion';
import {tileflowBuildingFragment} from '../../core/src/buildings-3d-shaders';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'facade contact fades up the wall without stacking gradients, dark roofs or raised-part rims',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="64" height="512"></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const result = await page.evaluate(
        ({fragment, defaults}) => {
          const canvas = document.querySelector('canvas')!;
          const gl = canvas.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          const program = gl.createProgram()!;
          for (const [type, source] of [
            [
              gl.VERTEX_SHADER,
              `#version 300 es
precision highp float;
uniform float u_test_base;
uniform float u_test_wall;
uniform float u_test_corners;
out vec3 v_colour;
out float v_base;
out vec3 v_facade;
out vec2 v_surface;
out vec4 v_building;
out vec3 v_normal;
out vec3 v_shadow;
flat out vec3 v_wall;
out vec3 v_edge;
flat out float v_outline;
out float v_haze_depth;
void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  // No sky: the haze stays off.
  v_haze_depth = 0.0;
  v_colour = vec3(0.8);
  v_base = u_test_base;
  v_facade = vec3(uv.x * 20.0, u_test_base + uv.y * 12.0, u_test_base + 12.0);
  v_surface = uv * 20.0;
  v_building = vec4(0.0, 0.0, u_test_wall, 0.0);
  v_normal = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, -1.0, 0.0), u_test_wall);
  v_shadow = vec3(0.0);
  v_wall = vec3(0.0, u_test_corners, 20.0);
  v_edge = vec3(uv.x, 0.0, 0.0);
  v_outline = 0.0;
}`,
            ],
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
          const scalar = (name: string, value: number) =>
            gl.uniform1f(gl.getUniformLocation(program, name), value);
          for (const name of ['u_sky_light', 'u_style_light_colour'])
            gl.uniform3f(gl.getUniformLocation(program, name), 1, 1, 1);
          scalar('u_occlusion_radius', defaults.wallRadius);
          scalar('u_corner', defaults.corner);
          const read = (
            occlusion: boolean,
            gradient: boolean,
            {base = 0, wall = 1, corners = 0} = {},
          ) => {
            scalar('u_occlusion', occlusion ? defaults.wall : 0);
            scalar('u_style_gradient', gradient ? 1 : 0);
            scalar('u_test_base', base);
            scalar('u_test_wall', wall);
            scalar('u_test_corners', corners);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return Array.from(
              {length: canvas.height},
              (_, y) => pixels[(y * canvas.width + (corners ? 0 : 32)) * 4]!,
            );
          };
          const modes = [0, 1].map((lighting) => {
            scalar('u_sun_lighting', lighting);
            return [128, 256, 512].map((resolution) => {
              canvas.height = resolution;
              gl.viewport(0, 0, 64, resolution);
              return {
                resolution,
                plain: read(false, false),
                contact: read(true, false),
                combined: read(true, true),
                corners: read(true, true, {corners: 3}),
                roof: read(true, true, {wall: 0}),
                plainRoof: read(false, false, {wall: 0}),
                raised: read(true, false, {base: 6}),
              };
            });
          });
          return {modes, error: gl.getError()};
        },
        {fragment: tileflowBuildingFragment, defaults: tileflowBuildingOcclusion},
      );
      assert.equal(result.error, 0, 'the production facade shader must render without GL errors');
      for (const modes of result.modes) {
        for (const view of modes) {
          const strength = (pixels: number[], height: number) => {
            const row = Math.min(view.resolution - 1, Math.floor((height / 12) * view.resolution));
            return 1 - pixels[row]! / view.plain[row]!;
          };
          // Legacy style lighting also changes the whole wall's brightness when its authored
          // gradient is on. Compare the profile relative to that wall's upper colour.
          const lightingRatio = view.combined.at(-1)! / view.contact.at(-1)!;
          assert.ok(
            view.contact.every(
              (pixel, index) => Math.abs(pixel * lightingRatio - view.combined[index]!) <= 2,
            ),
            'vertical gradient must not double the AO',
          );
          assert.deepEqual(view.roof, view.plainRoof, 'facade AO must not darken roofs');
          assert.ok(strength(view.contact, 0) > 0.12 && strength(view.contact, 0) < 0.15);
          assert.ok(strength(view.contact, 3) > 0.04 && strength(view.contact, 3) < 0.065);
          assert.ok(strength(view.contact, 6) > 0.01 && strength(view.contact, 6) < 0.03);
          assert.ok(strength(view.contact, 9) < 0.015, 'the tail must become imperceptible');
          assert.ok(
            1 - view.corners[0]! / (view.plain[0]! * lightingRatio) < 0.15,
            'corners must not compound base darkness',
          );
          assert.ok(strength(view.raised, 0) < 0.03, 'raised parts must use height above ground');
          assert.ok(
            view.contact.every((pixel, index) => index === 0 || pixel >= view.contact[index - 1]!),
            'the gradient must fade monotonically at every display scale',
          );
        }
      }
    } finally {
      await browser.close();
    }
  },
);
