import {defineConfig} from 'tsup';

export default defineConfig({
  clean: false,
  dts: true,
  entry: ['src/native-profile.ts'],
  format: ['esm'],
  noExternal: [/^@maplibre\/maplibre-gl-style-spec\/dist\/latest\.json$/u],
  splitting: false,
});
