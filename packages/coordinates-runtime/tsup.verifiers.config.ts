import {defineConfig} from 'tsup';

export default defineConfig({
  entry: [
    'packages/coordinates-runtime/test/analytical-runtime.conformance.ts',
    'packages/coordinates-runtime/test/axis.conformance.ts',
    'packages/coordinates-runtime/test/native.conformance.ts',
    'packages/coordinates-runtime/test/runtime.conformance.ts',
  ],
  format: ['esm'],
  platform: 'node',
  removeNodeProtocol: false,
  target: 'node24',
  outExtension: () => ({js: '.mjs'}),
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/^@tileflow\/coordinates(?:\/|$)/u, /^zod(?:\/|$)/u],
});
