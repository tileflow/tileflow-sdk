import {defineConfig} from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {index: 'src/index.ts'},
  external: ['react', 'react-native', 'react-native/Libraries/Utilities/codegenNativeComponent'],
  format: ['esm'],
  platform: 'neutral',
  target: 'es2020',
  splitting: false,
});
