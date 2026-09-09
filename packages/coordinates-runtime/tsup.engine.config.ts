import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['packages/coordinates-runtime/src/engine.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outExtension: () => ({js: '.mjs'}),
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/^@tileflow\/coordinates(?:\/|$)/u, /^zod(?:\/|$)/u],
});
