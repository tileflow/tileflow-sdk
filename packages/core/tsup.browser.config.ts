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
    entry: ['src/browser.ts', 'src/3d.ts'],
    format: ['esm'],
    platform: 'browser',
    dts: true,
    splitting: false,
    define: {
      TILEFLOW_CAMERA_TILE_WORKER_SOURCE: JSON.stringify(
        await readFile('dist/worker/camera-tile-worker.global.js', 'utf8'),
      ),
    },
  };
});
