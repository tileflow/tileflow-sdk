import {defineConfig} from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/build.ts', 'src/capture.ts', 'src/manifest.ts', 'src/runtime.ts'],
  format: ['esm'],
  noExternal: [/^@maplibre\/maplibre-gl-style-spec\/dist\/latest\.json$/u],
  splitting: false,
});
