import {
  defineMap,
  defineRootMap,
  defineTheme,
  token,
  type TileflowMapDesign,
  type TileflowMapScene,
} from '../src';

export const testLightTheme = defineTheme({
  id: 'test-light',
  version: 1,
  colorScheme: 'light',
  tokens: {
    color: {
      'boundaries.default': '#C9D1D9',
      'labels.halo': '#FFFFFF',
      'labels.muted': '#727B84',
      'labels.primary': '#3C4043',
      'roads.casing': '#D9DEE2',
      'roads.default': '#FFFFFF',
      'roads.major': '#F4C95D',
      'surface.background': '#F6F7F3',
      'surface.building': '#E6E3DA',
      'surface.land': '#F1F3ED',
      'surface.park': '#CDE8B5',
      'surface.water': '#A9D3F5',
    },
    font: {default: 'Noto Sans Regular'},
  },
  typography: {font: token.font('default')},
});

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
  defaultTheme: 'light',
  glyphs: {
    kind: 'url',
    url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
  },
  themes: {light: testLightTheme},
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
