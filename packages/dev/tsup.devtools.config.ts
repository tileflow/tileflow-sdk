import {defineConfig} from 'tsup';

export default defineConfig({
  entry: {
    'devtools-browser': 'src/devtools/browser.ts',
    'devtools-observer': 'src/devtools/observer.ts',
  },
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  splitting: false,
  clean: false,
  noExternal: [
    '@maplibre/maplibre-gl-style-spec',
    '@mapbox/vector-tile',
    '@mapbox/point-geometry',
    'pbf',
  ],
});
