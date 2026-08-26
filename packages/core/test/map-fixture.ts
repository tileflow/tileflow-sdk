import {defineMap, defineRootMap, type TileflowMapDesign, type TileflowMapScene} from '../src';

type TestMapOptions = TileflowMapDesign & {
  id?: string;
  name?: string;
  scenes?: Record<string, TileflowMapScene>;
  version?: number;
};

const testStreetsRoot = defineRootMap({
  id: 'test-streets-root',
  name: 'Test Streets root',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {
    kind: 'url',
    url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
  },
});

/** Create an isolated map that inherits the official Streets map. */
export function extendStreets<const TOptions extends TestMapOptions>(
  options: TOptions = {} as TOptions,
) {
  const {id = 'test-map', name, scenes, version = 1, ...design} = options;
  return defineMap({
    id,
    ...(name === undefined ? {} : {name}),
    version,
    extends: testStreetsRoot,
    ...design,
    ...(scenes === undefined ? {} : {scenes}),
  });
}
