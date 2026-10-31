import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tileflowBuildingDepthFragment,
  tileflowBuildingDepthVertex,
  tileflowBuildingVertex,
} from '../../core/src/buildings-3d-shaders';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'building and shadow vertices retain foreground height across the view and fade only at its far edge',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const heights = await page.evaluate(
        ({vertices, fragment}) => {
          const gl = document.querySelector('canvas')!.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          const results: number[][] = [];
          for (const vertex of vertices) {
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
            gl.transformFeedbackVaryings(program, ['gl_Position'], gl.INTERLEAVED_ATTRIBS);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS))
              throw new Error(gl.getProgramInfoLog(program)!);
            gl.useProgram(program);
            const uniform = (name: string) => gl.getUniformLocation(program, name);
            gl.uniform1f(uniform('u_scale'), 1);
            gl.uniform1f(uniform('u_metres'), 1);
            gl.uniform1i(uniform('u_ring_directional'), 1);
            gl.uniformMatrix4fv(
              uniform('u_light_matrix'),
              false,
              [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            );
            gl.vertexAttrib2f(gl.getAttribLocation(program, 'a_height'), 0, 1000);
            gl.vertexAttrib2f(gl.getAttribLocation(program, 'a_flags'), 1, 0);
            const buffer = gl.createBuffer()!;
            gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
            gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 16, gl.STREAM_READ);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
            gl.enable(gl.RASTERIZER_DISCARD);
            const values: number[] = [];
            for (const [dx, dy] of [
              [0, -1],
              [1, 0],
            ]) {
              gl.uniform2f(uniform('u_ring_ahead'), dx!, dy!);
              for (const end of [20, -10]) {
                gl.uniform4f(uniform('u_ring'), 0, 0, end - 10, end);
                for (const across of [-100, 0, 100])
                  for (const along of [end - 20, end - 5, end]) {
                    gl.vertexAttrib2f(
                      gl.getAttribLocation(program, 'a_pos'),
                      along * dx! - across * dy!,
                      along * dy! + across * dx!,
                    );
                    gl.beginTransformFeedback(gl.POINTS);
                    gl.drawArrays(gl.POINTS, 0, 1);
                    gl.endTransformFeedback();
                    const position = new Float32Array(4);
                    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, position);
                    values.push(position[2]!);
                  }
              }
            }
            if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL height probe failed');
            results.push(values);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
          }
          return results;
        },
        {
          vertices: [
            tileflowBuildingDepthVertex,
            tileflowBuildingVertex(
              'vec4 projectTileFor3D(vec2 p, float height) { return vec4(p, height, 1.0); }',
            ),
          ],
          fragment: tileflowBuildingDepthFragment,
        },
      );
      for (const program of heights)
        for (let i = 0; i < program.length; i++)
          assert.ok(
            Math.abs(program[i]! - [100, 50, 0][i % 3]!) < 1e-4,
            `height ${i}: ${program[i]}`,
          );
    } finally {
      await browser.close();
    }
  },
);
