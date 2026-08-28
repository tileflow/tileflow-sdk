import assert from 'node:assert/strict';
import test from 'node:test';
import {zoom} from '../src/cartography/values';
import {tileflowWorld} from '../src/data';
import {createStyleResult, parseTileflowMap} from '../src/map';
import {
  defineMap,
  disable,
  refine,
  reset,
  resolveMap,
  type TileflowMap,
  type TileflowModulePatch,
} from '../src/maps';
import {roads} from '../src/modules';
import {defineTheme} from '../src/themes';
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
  const streets = defineMap({
    id: 'streets',
    name: 'Streets',
    version: 1,
    defaultTheme: 'light',
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
  assert.equal('root' in resolved, false);
  assert.equal('extends' in resolved, false);
  assert.equal('basemap' in resolved, false);
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

test('falls back to the normalized map id as its name', () => {
  const root = defineMap({
    id: 'root',
    name: 'Root',
    version: 1,
    defaultTheme: 'light',
    themes: {light: testLightTheme},
  });
  const child = defineMap({id: 'child', version: 1, extends: root});

  assert.equal(resolveMap(child).name, 'child');
});

test('inherits icon directories by omission and replaces them atomically when declared', () => {
  const root = defineMap({
    id: 'root',
    version: 1,
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

test('supports canonical replace, refine, reset, and disable module operations', () => {
  const root = defineMap({
    id: 'operations-root',
    version: 1,
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    modules: {
      poi: {type: 'poi', categories: ['food-drink', 'retail']},
      roads: roads({
        detail: 'all',
        classes: {
          primary: {surface: {fill: {color: '#111111', dash: [1, 2], width: 4}}},
          secondary: {surface: {fill: {color: '#222222', width: 2}}},
        },
      }),
    },
  });
  const refined = defineMap({
    id: 'operations-refined',
    version: 1,
    extends: root,
    modules: {
      poi: disable(),
      roads: refine(
        {
          detail: 'major',
          classes: {
            primary: {surface: {fill: {color: reset(), dash: [9, 8]}}},
          },
        },
        {
          classes: {
            tertiary: {surface: {fill: {color: '#333333', width: 1}}},
          },
        },
      ),
    },
  });
  const replaced = defineMap({
    id: 'operations-replaced',
    version: 1,
    extends: refined,
    modules: {roads: roads({hierarchy: 'strong'})},
  });

  const resolved = resolveMap(refined);
  assert.deepEqual(resolved.modules?.poi, {enabled: false, type: 'poi'});
  assert.equal(resolved.modules?.roads?.detail, 'major');
  assert.equal(resolved.modules?.roads?.classes?.primary?.surface?.fill?.color, undefined);
  assert.deepEqual(resolved.modules?.roads?.classes?.primary?.surface?.fill?.dash, [9, 8]);
  assert.equal(resolved.modules?.roads?.classes?.primary?.surface?.fill?.width, 4);
  assert.equal(resolved.modules?.roads?.classes?.secondary?.surface?.fill?.color, '#222222');
  assert.equal(resolved.modules?.roads?.classes?.tertiary?.surface?.fill?.color, '#333333');
  assert.deepEqual(resolveMap(replaced).modules?.roads, roads({hierarchy: 'strong'}));
});

test('fails closed for invalid module operation ownership and reset placement', () => {
  const root = defineMap({
    id: 'operation-validation-root',
    version: 1,
    defaultTheme: 'light',
    themes: {light: testLightTheme},
  });

  assert.throws(
    () =>
      resolveMap({
        id: 'refine-without-base',
        version: 1,
        extends: root,
        modules: {roads: refine({detail: 'major'})},
      }),
    /at \/modules\/roads: Cannot refine this domain because no inherited module exists/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'wrong-owner',
        version: 1,
        extends: root,
        modules: {roads: {type: 'water'}},
      } as unknown as TileflowMap),
    /at \/modules\/roads\/type: Expected "roads"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'reset-in-replacement',
        version: 1,
        extends: root,
        modules: {roads: {type: 'roads', detail: reset()}},
      } as unknown as TileflowMap),
    /reset\(\) is only valid inside refine\(\)/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'removed-set-operation',
        version: 1,
        extends: root,
        modules: {roads: {op: 'set', value: roads({detail: 'major'})}},
      } as unknown as TileflowMap),
    /Unsupported operation "set"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'reserved-module-enabled',
        version: 1,
        extends: root,
        modules: {roads: {type: 'roads', enabled: false}},
      } as unknown as TileflowMap),
    /at \/modules\/roads\/enabled: enabled is compiler-owned state; use disable\(\)/,
  );
  const baseWithRoads = defineMap({
    id: 'reserved-refine-enabled-base',
    version: 1,
    extends: root,
    modules: {roads: roads()},
  });
  assert.throws(
    () =>
      resolveMap({
        id: 'reserved-refine-enabled',
        version: 1,
        extends: baseWithRoads,
        modules: {roads: refine({enabled: false})},
      } as unknown as TileflowMap),
    /at \/modules\/roads\/patches\/0\/enabled: enabled is compiler-owned state; use disable\(\)/,
  );

  const nestedCapability = resolveMap({
    id: 'nested-capability-enabled',
    version: 1,
    extends: root,
    modules: {roads: roads({classes: {primary: {enabled: false}}})},
  });
  assert.equal(nestedCapability.modules?.roads?.classes?.primary?.enabled, false);

  const diagnostic = createStyleResult({
    id: 'diagnostic-refine-without-base',
    version: 1,
    extends: root,
    modules: {roads: refine({detail: 'major'})},
  });
  assert.equal(diagnostic.ok, false);
  assert.deepEqual(diagnostic.diagnostics[0], {
    code: 'TILEFLOW_REFINE_WITHOUT_BASE',
    message:
      'Invalid Tileflow map "diagnostic-refine-without-base" at /modules/roads: Cannot refine this domain because no inherited module exists; declare it directly on a base map first.',
    path: '/modules/roads',
    phase: 'input',
    severity: 'error',
  });
});

test('module refinements reserve root ownership but preserve nested type and enabled options', () => {
  const root = defineMap({
    id: 'nested-homonymous-options-root',
    version: 1,
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    modules: {
      roads: {
        ...roads({classes: {primary: {enabled: false}}}),
        nestedFixture: {enabled: true, type: 'editorial'},
      } as never,
    },
  });
  const refined = resolveMap({
    id: 'nested-homonymous-options-refined',
    version: 1,
    extends: root,
    modules: {
      roads: refine({
        classes: {primary: {enabled: reset()}},
        nestedFixture: {enabled: false, type: reset()},
      }),
    },
  } as unknown as TileflowMap);
  const roadsModule = refined.modules?.roads as Record<string, unknown>;
  assert.equal(
    (roadsModule.classes as Record<string, Record<string, unknown>>).primary?.enabled,
    undefined,
  );
  assert.deepEqual(roadsModule.nestedFixture, {enabled: false});

  for (const type of ['roads', reset()]) {
    assert.throws(
      () =>
        resolveMap({
          id: 'root-type-refinement',
          version: 1,
          extends: root,
          modules: {roads: refine({type})},
        } as unknown as TileflowMap),
      /patches\/0\/type: type is immutable module ownership/u,
    );
  }
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
    () => resolveMap({id: 'invalid', version: 1, extends: null} as unknown as TileflowMap),
    /extends must reference another map object/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'invalid',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
      } as unknown as TileflowMap),
    /unrecognized key "root"/,
  );

  const root = defineMap({
    id: 'depth-root',
    version: 1,
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
    defaultTheme: 'light',
    themes: {light: testLightTheme},
    projection: 'sphere',
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
    extends: defineMap({
      id: 'valid-root',
      version: 1,
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
        basemap: {type: 'streets'},
      } as unknown as TileflowMap),
    /unrecognized key "basemap"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'legacy-sprite',
        version: 1,
        sprite: 'https://assets.example.test/sprite',
      } as unknown as TileflowMap),
    /unrecognized key "sprite"/,
  );
  assert.throws(
    () =>
      resolveMap({
        id: 'legacy-overrides',
        version: 1,
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
        }) as TileflowMap,
      ),
    /map object/,
  );
});

type SyntheticModuleWithHomonymousOptions = {
  readonly enabled?: boolean;
  readonly nested?: {readonly enabled?: boolean; readonly type?: string};
  readonly type: 'synthetic';
};

const nestedHomonymousPatch: TileflowModulePatch<SyntheticModuleWithHomonymousOptions> = {
  nested: {enabled: false, type: reset()},
};
const forbiddenRootTypePatch: TileflowModulePatch<SyntheticModuleWithHomonymousOptions> = {
  // @ts-expect-error module ownership is immutable at the refinement root.
  type: 'synthetic',
};
const forbiddenRootEnabledPatch: TileflowModulePatch<SyntheticModuleWithHomonymousOptions> = {
  // @ts-expect-error compiler visibility is immutable at the refinement root.
  enabled: false,
};

void [nestedHomonymousPatch, forbiddenRootTypePatch, forbiddenRootEnabledPatch];
