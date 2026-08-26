import {defineConfig} from 'tsup';

export default defineConfig({
  banner: {
    js: "'use client';",
  },
  clean: true,
  dts: true,
  entry: {
    index: 'src/index.ts',
    static: 'src/static.ts',
  },
  external: ['maplibre-gl', 'react', 'react-dom'],
  format: ['esm'],
});
