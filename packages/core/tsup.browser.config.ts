import {readFile} from 'node:fs/promises';
import {build, defineConfig} from 'tsup';

export default defineConfig(async () => {
  await build({
    entry: ['src/camera-tile-worker.ts'],
    outDir: 'dist/worker',
    format: ['iife'],
    platform: 'browser',
    minify: true,
    splitting: false,
    dts: false,
  });
  return {
    // One browser bundle serves both `./browser` and `./internal`, so Tileflow's packages and the
    // application share a single module instance. Each subpath publishes its own types.
    entry: {browser: 'src/browser-bundle.ts', '3d': 'src/3d.ts'},
    format: ['esm'],
    platform: 'browser',
    dts: {entry: {browser: 'src/browser.ts', internal: 'src/internal.ts', '3d': 'src/3d.ts'}},
    splitting: false,
    define: {
      TILEFLOW_CAMERA_TILE_WORKER_SOURCE: JSON.stringify(
        await readFile('dist/worker/camera-tile-worker.global.js', 'utf8'),
      ),
    },
  };
});
