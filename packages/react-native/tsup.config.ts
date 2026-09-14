import {defineConfig} from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: 'src/index.ts',
    'internal/native-appearance': 'src/native-appearance.ts',
    'internal/initial-view': 'src/initial-view.ts',
    'internal/source-state': 'src/source-state.ts',
  },
  external: [
    '@tileflow/core',
    '@tileflow/core/native',
    'react',
    'react-native',
    '@maplibre/maplibre-react-native',
  ],
  format: ['esm'],
  platform: 'neutral',
  target: 'es2020',
  splitting: false,
});
