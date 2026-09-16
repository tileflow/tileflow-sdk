import {defineConfig} from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: 'src/index.ts',
    'internal/native-appearance': 'src/native-appearance.ts',
    'internal/initial-view': 'src/initial-view.ts',
    'internal/source-state': 'src/source-state.ts',
    'internal/camera': 'src/camera-controller.ts',
    'internal/session': 'src/session-controller.ts',
    'internal/native-admission': 'src/native-admission-owner.ts',
    'internal/native-admission-bridge': 'src/native-admission-bridge.ts',
    'internal/hosted-binding': 'src/hosted-binding.ts',
    'internal/native-configuration-bridge': 'src/native-configuration-bridge.ts',
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
