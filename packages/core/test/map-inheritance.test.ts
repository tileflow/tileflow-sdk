import assert from 'node:assert/strict';
import test from 'node:test';
import {zoom} from '../src/cartography/values';
import {tileflowWorld} from '../src/data';
import {parseTileflowMap} from '../src/map';
import {defineTheme} from '../src/themes';
import {
  defineMap,
  defineRootMap,
  resolveMap,
  type TileflowMap,
  tileflowStreetsCompilerVersion,
} from '../src/maps';
import {roads} from '../src/modules';
import {testLightTheme} from './map-fixture';

test('resolves a lineage to one standalone map with field-specific merge semantics', () => {
  const rootTheme = defineTheme(testLightTheme, {
    id: 'root-light',
    version: 1,
    colorScheme: 'light',
    tokens: {color: {'surface.water': '#001122'}},
    typography: {
      fallbacks: ['Root Sans Fallback', 'sans-serif'],
      font: 'Root Sans Regular',
      places: {letterSpacing: 0.02},
    },
    lighting: {
      anchor: 'map',
      color: '#FFFFFF',
      intensity: 0.4,
      position: [1, 180, 35],
    },
  });
  const customTheme = defineTheme(rootTheme, {
    id: 'custom-dark',
    version: 1,
    colorScheme: 'dark',
    tokens: {color: {'surface.land': '#223344'}},
    typography: {
      fallbacks: ['Child Sans Regular'],
      places: {letterSpacing: 0.08},
    },
    lighting: {intensity: 0.8},
  });
  const rootDarkTheme = defineTheme(rootTheme, {
    id: 'root-dark',
    version: 1,
    colorScheme: 'dark',
  });
  const streets = defineRootMap({
    id: 'streets',
    name: 'Streets',
    version: 1,
    root: {compiler: 'streets', compilerVersion: tileflowStreetsCompilerVersion},
    defaultTheme: 'light',
    delivery: {hosted: {allowedOrigins: ['https://root.example.test']}},
    data: tileflowWorld({
      release: {
        descriptorSha256: 'a'.repeat(64),
        releaseId: 'world-v1-root-data',
      },
    }),
    glyphs: {
      kind: 'url',
      url: 'https://root.example.test/glyphs/{fontstack}/{range}.pbf',
      fontStacks: ['Root Sans Regular,Root Sans Fallback,sans-serif'],
    },
    icons: ['./root-icons'],
    modules: {
      poi: {type: 'poi', categories: ['food-drink', 'retail']},
      roads: roads({
        detail: 'all',
        classes: {
          primary: {
            surface: {
              fill: {
                color: '#111111',
                dash: [1, 2],
                width: zoom.exponential(1.5, [
                  [5, 1],
                  [10, 2],
                ]),
              },
            },
          },
        },
      }),
    },
    projection: 'globe',
    terrain: {exaggeration: 2, mode: '3d', url: 'https://root.example.test/terrain'},
    systemThemes: {dark: 'dark', light: 'light'},
    themes: {dark: rootDarkTheme, light: rootTheme},
    view: {center: [-3.7, 40.4], pitch: 30, zoom: 10},
  });
  const custom = defineMap({
    id: 'custom',
    name: 'Custom',
    version: 7,
    extends: streets,
    delivery: {hosted: {allowedOrigins: ['https://child.example.test']}},
    data: tileflowWorld(),
    glyphs: {
      kind: 'url',
      url: 'https://child.example.test/glyphs/{fontstack}/{range}.pbf',
      fontStacks: ['Root Sans Regular,Child Sans Regular'],
    },
    icons: ['./child-icons'],
    defaultTheme: 'dark',
    modules: {
      poi: {type: 'poi', categories: ['arts-entertainment']},
      roads: roads({
        hierarchy: 'strong',
        classes: {
          primary: {
            surface: {
              fill: {
                dash: [9, 8],
                width: zoom.linear([
                  [6, 3],
                  [12, 6],
                ]),
              },
            },
          },
        },
      }),
    },
    projection: 'mercator',
    terrain: {mode: 'hillshade'},
    themes: {dark: customTheme},
    view: {zoom: 14},
  });

  const resolved = resolveMap(custom);

  assert.equal(resolved.id, 'custom');
  assert.equal(resolved.name, 'Custom');
  assert.equal(resolved.version, 7);
  assert.deepEqual(resolved.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal('extends' in resolved, false);
  assert.equal('basemap' in resolved, false);
  assert.deepEqual(resolved.delivery, {
    hosted: {allowedOrigins: ['https://child.example.test']},
  });

  assert.deepEqual(resolved.data, tileflowWorld());
  assert.deepEqual(resolved.glyphs, {
    kind: 'url',
    url: 'https://child.example.test/glyphs/{fontstack}/{range}.pbf',
    fontStacks: ['Root Sans Regular,Child Sans Regular'],
  });
  assert.equal(resolved.projection, 'mercator');
  assert.deepEqual(resolved.terrain, {mode: 'hillshade'});

  assert.deepEqual(resolved.icons, ['./child-icons']);
  assert.deepEqual(resolved.view, {center: [-3.7, 40.4], pitch: 30, zoom: 14});
  assert.equal(resolved.defaultTheme, 'dark');
  assert.deepEqual(resolved.themes, {dark: customTheme});
  assert.equal(resolved.systemThemes, undefined);

  const primary = resolved.modules?.roads?.classes?.primary?.surface?.fill;
  assert.equal(resolved.modules?.roads?.detail, undefined);
  assert.equal(resolved.modules?.roads?.hierarchy, 'strong');
  assert.equal(primary?.color, undefined);
  assert.deepEqual(primary?.dash, [9, 8]);
  assert.deepEqual(
    primary?.width,
    zoom.linear([
      [6, 3],
      [12, 6],
    ]),
  );
  assert.equal('base' in (primary?.width as object), false);
  assert.deepEqual(resolved.modules?.poi?.categories, ['arts-entertainment']);

  assert.deepEqual(streets.icons, ['./root-icons']);
  assert.equal(streets.modules.roads.classes?.primary?.surface?.fill?.color, '#111111');
});

test('keeps delivery leaf-only and falls back to the normalized map id as its name', () => {
  const root = defineRootMap({
    id: 'root',
    name: 'Root',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    delivery: {hosted: {allowedOrigins: ['https://root.example.test']}},
  });
  const child = defineMap({id: 'child', version: 1, extends: root});

  assert.equal(resolveMap(child).name, 'child');
  assert.equal(resolveMap(child).delivery, undefined);
});

test('inherits icon directories by omission and replaces them atomically when declared', () => {
  const root = defineRootMap({
    id: 'root',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    icons: ['./root-icons'],
  });
  const mapped = defineMap({
    id: 'mapped',
    version: 1,
    extends: root,
  });
  const replaced = defineMap({
    id: 'replaced',
    version: 1,
    extends: mapped,
    icons: ['./brand-icons'],
  });
  const disabled = defineMap({
    id: 'disabled',
    version: 1,
    extends: mapped,
    icons: [],
  });

  assert.deepEqual(resolveMap(mapped).icons, ['./root-icons']);
  assert.deepEqual(resolveMap(replaced).icons, ['./brand-icons']);
  assert.deepEqual(resolveMap(disabled).icons, []);
});

test('fails closed for malformed, circular, and over-deep inheritance', () => {
  const left: Record<string, unknown> = {id: 'left', version: 1};
  const right: Record<string, unknown> = {id: 'right', version: 1};
  left.extends = right;
  right.extends = left;

  assert.throws(
    () => resolveMap(left as unknown as TileflowMap),
    /Circular Tileflow map inheritance: left -> right -> left/,
  );
  assert.throws(
    () => resolveMap({id: 'invalid', version: 1} as TileflowMap),
    /exactly one of root or extends/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'invalid',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
        extends: {id: 'parent'},
      } as unknown as TileflowMap),
    /exactly one of root or extends/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'unsupported',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 2},
      } as unknown as TileflowMap),
    /unsupported root/,
  );

  const root = defineRootMap({
    id: 'depth-root',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    defaultTheme: 'light',
    themes: {light: testLightTheme},
  });
  const middle = defineMap({id: 'depth-middle', version: 1, extends: root});
  const leaf = defineMap({id: 'depth-leaf', version: 1, extends: middle});
  assert.throws(() => resolveMap(leaf, {maxDepth: 2}), /exceeds maxDepth 2/);
  assert.doesNotThrow(() => resolveMap(leaf, {maxDepth: 3}));
  assert.throws(() => resolveMap(root, {maxDepth: 0}), /positive integer/);

  for (const modules of [null, false, 0, []]) {
    assert.throws(
      () =>
        resolveMap({
          id: 'invalid-modules',
          version: 1,
          extends: root,
          modules,
        } as unknown as TileflowMap),
      /modules must be a plain object/,
    );
  }

  for (const icons of [null, false, 0, './icons', {source: './icons'}]) {
    assert.throws(
      () =>
        resolveMap({
          id: 'invalid-icons',
          version: 1,
          extends: root,
          icons,
        } as unknown as TileflowMap),
      /icons must be an array of directories/,
    );
  }
  assert.deepEqual(
    resolveMap({id: 'without-icons', version: 1, extends: root, icons: []}).icons,
    [],
  );
});

test('validates every map in the extends lineage before applying child replacements', () => {
  const invalidRoot = {
    id: 'invalid-root',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    projection: 'sphere',
    delivery: {hosted: {unknown: true}},
    modules: {roads: {type: 'roads', detail: 'invalid'}},
  } as unknown as TileflowMap;
  const child = defineMap({
    id: 'valid-looking-child',
    version: 1,
    extends: invalidRoot,
    projection: 'mercator',
    modules: {roads: roads({detail: 'major'})},
  });

  assert.equal(resolveMap(child).projection, 'mercator');
  assert.throws(() => parseTileflowMap(child), /invalid-root|projection|sphere/u);

  const invalidMiddle = {
    id: 'invalid-middle',
    version: 1,
    extends: defineRootMap({
      id: 'valid-root',
      version: 1,
      root: {compiler: 'streets', compilerVersion: 1},
      defaultTheme: 'light',
      themes: {light: testLightTheme},
    }),
    modules: {roads: {type: 'roads', detail: 'invalid'}},
  } as unknown as TileflowMap;
  const replacingLeaf = defineMap({
    id: 'replacing-leaf',
    version: 1,
    extends: invalidMiddle,
    modules: {roads: roads({detail: 'major'})},
  });

  assert.throws(() => parseTileflowMap(replacingLeaf), /invalid-middle|modules\.roads\.detail/u);
});

test('rejects legacy and unknown authoring keys instead of silently ignoring them', () => {
  assert.throws(
    () =>
      resolveMap({
        id: 'legacy',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
        basemap: {type: 'streets'},
      } as unknown as TileflowMap),
    /unrecognized key "basemap"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'legacy-sprite',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
        sprite: 'https://assets.example.test/sprite',
      } as unknown as TileflowMap),
    /unrecognized key "sprite"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'legacy-overrides',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
        overrides: [],
      } as unknown as TileflowMap),
    /unrecognized key "overrides"/,
  );
  assert.throws(
    () =>
      resolveMap(
        Object.assign(Object.create({}), {
          id: 'inherited',
          version: 1,
          root: {compiler: 'streets', compilerVersion: 1},
        }) as TileflowMap,
      ),
    /map object/,
  );
});
