import {readFile} from 'node:fs/promises';
import {build, defineConfig} from 'tsup';

export default defineConfig(async () => {
  await build({
    entry: ['src/buildings-3d-worker.ts'],
    outDir: 'dist/worker',
    format: ['iife'],
    platform: 'browser',
    minify: true,
    splitting: false,
    dts: false,
  });
  return {
    entry: ['src/browser.ts'],
    format: ['esm'],
    platform: 'browser',
    dts: true,
    splitting: false,
    define: {
      TILEFLOW_BUILDING_WORKER_SOURCE: JSON.stringify(
        await readFile('dist/worker/buildings-3d-worker.global.js', 'utf8'),
      ),
    },
  };
});
