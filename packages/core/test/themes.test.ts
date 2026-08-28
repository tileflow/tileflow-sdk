import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditTileflowMapThemeValues,
  auditTileflowThemeValues,
  classifyTileflowVisualProperty,
  color,
  createStyle,
  defineMap,
  defineTheme,
  disable,
  fixed,
  land,
  parseTileflowMap,
  resolveThemeSelection,
  resolveThemeValues,
  resolveTileflowTheme,
  token,
  zoom,
} from '../src';
import {expression} from '../src/cartography/values';
import {assertTileflowMapThemeValues, TileflowThemeAuditError} from '../src/themes';
import {extendStreets, testLightTheme} from './map-fixture';

test('defineTheme materializes a flat theme and resolves typed derivations deterministically', () => {
  const theme = defineTheme({
    id: 'graphite',
    version: 3,
    colorScheme: 'dark',
    tokens: {
      color: {
        accent: '#FF0000',
        mixed: color.mix(token.color('accent'), '#0000FF', {amount: 0.5}),
        translucent: color.alpha(token.color('mixed'), 0.4),
      },
      font: {body: 'Noto Sans Regular'},
      image: {marker: 'pin-dark'},
      number: {quiet: 0.42},
    },
    typography: {font: token.font('body'), letterSpacing: token.number('quiet')},
    lighting: {color: token.color('mixed'), intensity: token.number('quiet')},
  });

  assert.deepEqual(Object.keys(theme.tokens).sort(), ['color', 'font', 'image', 'number']);
  assert.equal('extends' in theme, false);
  const resolved = resolveTileflowTheme(theme);
  assert.equal(resolved.tokens.color.mixed, '#ba00c2');
  assert.equal(resolved.tokens.color.translucent, 'rgba(186, 0, 194, 0.4)');
  assert.equal(resolved.typography.font, 'Noto Sans Regular');
  assert.equal(resolved.typography.roads.font, 'Noto Sans Regular');
  assert.equal(resolved.typography.letterSpacing, 0.42);
  assert.deepEqual(resolved.lighting, {color: '#ba00c2', intensity: 0.42});
});

test('defineTheme(base, definition) returns an inheritance-free complete document', () => {
  const dark = defineTheme(testLightTheme, {
    id: 'test-dark',
    version: 1,
    colorScheme: 'dark',
    tokens: {
      color: {'surface.land': '#151E2D'},
      image: {marker: 'pin-dark'},
    },
  });

  assert.equal(dark.tokens.color['surface.land'], '#151E2D');
  assert.equal(dark.tokens.color['surface.water'], '#A9D3F5');
  assert.equal(dark.tokens.image.marker, 'pin-dark');
  assert.equal('extends' in dark, false);
  assert.notEqual(dark.tokens, testLightTheme.tokens);
});

test('theme identities are concrete portable names across authoring and selection', () => {
  for (const id of ['system', 'CON', 'Dark', 'dark_mode', 'd'.repeat(65)]) {
    assert.throws(
      () =>
        defineTheme({
          id,
          version: 1,
          colorScheme: 'dark',
        }),
      /theme id.*portable identifier/i,
      id,
    );
  }

  assert.throws(
    () => resolveThemeSelection({defaultTheme: 'light', themes: {light: testLightTheme}}, 'system'),
    /browser-only selector.*concrete theme/i,
  );
});

test('theme refs resolve recursively in zooms, expressions, fixed values and symbol carriers', () => {
  const carrier = Symbol.for('test/theme-carrier');
  const authored = {
    modules: {
      roads: {
        color: zoom.linear([
          [8, token.color('surface.land')],
          [
            12,
            color.alpha(
              token.color('labels.primary'),
              fixed(0.5, {reason: 'Active-road emphasis contract'}),
            ),
          ],
        ]),
        fill: {
          color: expression([
            'case',
            ['boolean', ['feature-state', 'active'], false],
            token.color('labels.primary'),
            token.color('labels.muted'),
          ]),
        },
        image: fixed('physical-marking', {reason: 'A real road marking'}),
        dash: fixed([2, 1], {reason: 'Physical road-marking cadence'}),
        offset: [token.number('quiet'), fixed(1, {reason: 'Physical road-marking displacement'})],
      },
    },
    [carrier]: [{paint: {color: token.color('surface.water')}}],
  };
  const metricTheme = defineTheme(testLightTheme, {
    id: 'test-light-metrics',
    version: 1,
    colorScheme: 'light',
    tokens: {number: {quiet: 0.42}},
  });
  const resolved = resolveThemeValues(authored, metricTheme, 'map.demo');

  assert.deepEqual(resolved.modules.roads.color.stops, [
    [8, '#F1F3ED'],
    [12, 'rgba(60, 64, 67, 0.5)'],
  ]);
  assert.deepEqual(resolved.modules.roads.fill.color.value.slice(-2), ['#3C4043', '#727B84']);
  assert.equal(resolved.modules.roads.image, 'physical-marking');
  assert.deepEqual(resolved.modules.roads.dash, [2, 1]);
  assert.deepEqual(resolved.modules.roads.offset, [0.42, 1]);
  assert.equal(resolved[carrier][0]?.paint.color, '#A9D3F5');
});

test('unknown refs, cycles and contextual type mismatches fail with actionable paths', () => {
  assert.throws(
    () =>
      defineTheme({
        id: 'unknown',
        version: 1,
        colorScheme: 'light',
        tokens: {color: {broken: token.color('missing')}},
      }),
    /Unknown Tileflow color token "missing".*theme\.tokens\.color\.broken/,
  );
  assert.throws(
    () =>
      defineTheme({
        id: 'cycle',
        version: 1,
        colorScheme: 'light',
        tokens: {color: {a: token.color('b'), b: token.color('a')}},
      }),
    /Circular Tileflow theme token reference: color\.a -> color\.b -> color\.a/,
  );
  assert.throws(
    () => resolveThemeValues({paint: {color: token.font('default')}}, testLightTheme, 'module'),
    /type mismatch at module\.paint\.color; expected color, received font token "default"/,
  );
});

test('theme authoring and resolution reject unknown structural fields instead of dropping them', () => {
  const identity = {colorScheme: 'dark', id: 'strict-dark', version: 1} as const;
  const invalidDefinitions: readonly [unknown, RegExp][] = [
    [{...identity, palette: {}}, /Unknown Tileflow theme field "palette" at theme\./],
    [
      {...identity, tokens: {colors: {accent: '#123456'}}},
      /Unknown Tileflow theme field "colors" at theme\.tokens\./,
    ],
    [
      {...identity, typography: {roads: {weight: 600}}},
      /Unknown Tileflow theme field "weight" at theme\.typography\.roads\./,
    ],
    [
      {...identity, lighting: {colour: '#123456'}},
      /Unknown Tileflow theme field "colour" at theme\.lighting\./,
    ],
  ];
  for (const [definition, expected] of invalidDefinitions) {
    assert.throws(() => defineTheme(definition as never), expected);
  }

  const invalidDocuments: readonly [unknown, RegExp][] = [
    [{...testLightTheme, palette: {}}, /Unknown Tileflow theme field "palette" at theme\./],
    [
      {...testLightTheme, tokens: {...testLightTheme.tokens, colors: {}}},
      /Unknown Tileflow theme field "colors" at theme\.tokens\./,
    ],
    [
      {
        ...testLightTheme,
        typography: {...testLightTheme.typography, roads: {font: 'Noto Sans Regular', weight: 600}},
      },
      /Unknown Tileflow theme field "weight" at theme\.typography\.roads\./,
    ],
    [
      {...testLightTheme, lighting: {...testLightTheme.lighting, colour: '#123456'}},
      /Unknown Tileflow theme field "colour" at theme\.lighting\./,
    ],
  ];
  for (const [theme, expected] of invalidDocuments) {
    assert.throws(() => resolveTileflowTheme(theme as never), expected);
  }
});

test('theme value nodes require exact canonical shapes, names, and auditable fixed reasons', () => {
  const withAccent = (accent: unknown) =>
    defineTheme({
      id: 'strict-nodes',
      version: 1,
      colorScheme: 'dark',
      tokens: {color: {accent}},
    } as never);

  assert.throws(
    () => withAccent({kind: 'theme-fixed', reason: '   ', value: '#123456'}),
    /fixed value at theme\.tokens\.color\.accent requires a non-empty reason/,
  );
  assert.throws(
    () => withAccent({kind: 'theme-fixed', reason: 'Brand contract'}),
    /Missing Tileflow theme field "value" at theme\.tokens\.color\.accent/,
  );
  assert.throws(
    () =>
      withAccent({extra: true, kind: 'theme-fixed', reason: 'Brand contract', value: '#123456'}),
    /Unknown Tileflow theme field "extra" at theme\.tokens\.color\.accent/,
  );
  assert.throws(
    () => withAccent({category: 'color', extra: true, kind: 'theme-token', token: 'accent'}),
    /Unknown Tileflow theme field "extra" at theme\.tokens\.color\.accent/,
  );
  assert.throws(
    () => withAccent({category: 'color', kind: 'theme-token'}),
    /Missing Tileflow theme field "token" at theme\.tokens\.color\.accent/,
  );
  assert.throws(
    () => withAccent({category: 'colour', kind: 'theme-token', token: 'accent'}),
    /theme\.tokens\.color\.accent\.category; expected color, font, image, or number/,
  );
  assert.throws(
    () => withAccent({category: 'color', kind: 'theme-token', token: 'bad token'}),
    /Invalid Tileflow color token "bad token"/,
  );
  assert.throws(
    () =>
      resolveTileflowTheme({
        ...testLightTheme,
        tokens: {
          ...testLightTheme.tokens,
          color: {
            ...testLightTheme.tokens.color,
            broken: {kind: 'theme-fixed', reason: '', value: '#123456'},
          },
        },
      } as never),
    /fixed value at theme\.tokens\.color\.broken requires a non-empty reason/,
  );
});

test('theme token definitions preserve reference categories before primitive resolution', () => {
  const shared = {
    color: {accent: '#123456'},
    font: {body: 'marker'},
    image: {marker: '#abcdef'},
    number: {spacing: 0.5},
  };
  const mismatches = [
    ['color', token.image('marker'), 'image', 'marker'],
    ['font', token.image('marker'), 'image', 'marker'],
    ['image', token.font('body'), 'font', 'body'],
    ['number', token.color('accent'), 'color', 'accent'],
  ] as const;

  for (const [category, reference, receivedCategory, name] of mismatches) {
    assert.throws(
      () =>
        defineTheme({
          id: `strict-${category}`,
          version: 1,
          colorScheme: 'dark',
          tokens: {
            ...shared,
            [category]: {...shared[category], broken: reference},
          },
        } as never),
      new RegExp(
        `type mismatch at theme\\.tokens\\.${category}\\.broken; expected ${category}, received ${receivedCategory} token "${name}"`,
      ),
    );
  }
});

test('forged runtime theme nodes cannot bypass audit or resolution', () => {
  const forgedValues = [
    {
      expected: /Unknown Tileflow theme field "extra" at map\.demo\.modules\.land\.fill\.color/,
      value: {
        extra: true,
        kind: 'theme-fixed',
        reason: 'Brand contract',
        value: '#123456',
      },
    },
    {
      expected: /fixed value at map\.demo\.modules\.land\.fill\.color requires a non-empty reason/,
      value: {kind: 'theme-fixed', reason: '   ', value: '#123456'},
    },
    {
      expected: /Unknown Tileflow theme field "extra" at map\.demo\.modules\.land\.fill\.color/,
      value: {category: 'color', extra: true, kind: 'theme-token', token: 'labels.primary'},
    },
    {
      expected: /Unknown Tileflow theme field "extra" at map\.demo\.modules\.land\.fill\.color/,
      value: {
        color: token.color('labels.primary'),
        extra: true,
        kind: 'theme-color',
        opacity: fixed(0.5, {reason: 'Contrast contract'}),
        operation: 'alpha',
      },
    },
  ] as const;

  for (const {expected, value} of forgedValues) {
    const input = {modules: {land: {fill: {color: value}}}};
    const diagnostics = auditTileflowThemeValues(input, 'map.demo');
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(
      diagnostics.map(({code, path, severity}) => ({code, path, severity})),
      [
        {
          code: 'THEME_IMPLICIT_FIXED',
          path: 'map.demo.modules.land.fill.color',
          severity: 'error',
        },
      ],
    );
    assert.throws(() => resolveThemeValues(input, testLightTheme, 'map.demo'), expected);
  }
});

test('theme nodes cannot control structural compiler fields', () => {
  assert.throws(
    () =>
      resolveThemeValues(
        {filter: ['==', ['get', 'class'], token.color('labels.primary')]},
        testLightTheme,
        'modules.land.renderStack.example',
      ),
    /outside a categorized visual property.*cannot control filters/u,
  );
});

test('resource expressions require explicit theme intent on every possible output', () => {
  const explicit = {
    fill: {
      color: expression([
        'case',
        ['boolean', ['get', 'selected'], false],
        token.color('labels.primary'),
        fixed('red', {reason: 'Selection color is a product invariant'}),
      ]),
    },
    icon: {
      image: expression([
        'match',
        ['get', 'kind'],
        'primary',
        token.image('marker.primary'),
        fixed('marker-fallback', {reason: 'Bundled fallback sprite'}),
      ]),
    },
    label: {
      font: expression([
        'coalesce',
        token.font('labels.primary'),
        fixed('Noto Sans Regular', {reason: 'Guaranteed bundled font'}),
      ]),
    },
  };
  assert.deepEqual(auditTileflowThemeValues(explicit, 'modules.poi'), []);

  const diagnostics = auditTileflowThemeValues(
    {
      convertedColor: expression(['to-color', ['get', 'tone']]),
      generatedColor: expression(['rgb', 255, 0, 0]),
      hslColor: 'hsl(210 50% 40%)',
      icon: {
        image: expression([
          'case',
          ['boolean', ['get', 'selected'], false],
          token.image('marker.selected'),
          'marker-default',
        ]),
      },
      label: {font: expression(['get', 'font'])},
      namedColor: 'red',
    },
    'modules.poi',
  );

  assert.deepEqual(
    diagnostics.map(({code, path, severity, value}) => ({code, path, severity, value})),
    [
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.convertedColor.value[1]',
        severity: 'error',
        value: 'get',
      },
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.generatedColor.value',
        severity: 'error',
        value: 'rgb',
      },
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.hslColor',
        severity: 'error',
        value: 'hsl(210 50% 40%)',
      },
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.icon.image.value[3]',
        severity: 'error',
        value: 'marker-default',
      },
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.label.font.value',
        severity: 'error',
        value: 'get',
      },
      {
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.namedColor',
        severity: 'error',
        value: 'red',
      },
    ],
  );
});

test('theme color operations expose every raw operand to the audit', () => {
  const diagnostics = auditTileflowThemeValues(
    {
      mixedColor: color.mix(token.color('surface.land'), '#ffffff', {amount: 0.25}),
      safeColor: color.alpha(
        token.color('labels.primary'),
        fixed(0.4, {reason: 'Halo contrast contract'}),
      ),
      shadowColor: color.alpha(token.color('labels.primary'), 0.5),
    },
    'modules.land',
  );

  assert.deepEqual(
    diagnostics.map(({category, path, severity, value}) => ({category, path, severity, value})),
    [
      {
        category: 'number',
        path: 'modules.land.mixedColor.amount',
        severity: 'error',
        value: 0.25,
      },
      {
        category: 'color',
        path: 'modules.land.mixedColor.to',
        severity: 'error',
        value: '#ffffff',
      },
      {
        category: 'number',
        path: 'modules.land.shadowColor.opacity',
        severity: 'error',
        value: 0.5,
      },
    ],
  );
});

test('selection is concrete and createStyle compiles the selected named theme', () => {
  const dark = defineTheme(testLightTheme, {
    id: 'test-dark',
    version: 1,
    colorScheme: 'dark',
    tokens: {
      color: {
        'surface.background': '#0B1220',
        'surface.land': '#151E2D',
      },
    },
  });
  const map = defineMap({
    id: 'themed-map',
    version: 1,
    extends: {
      id: 'themed-root',
      version: 1,
      defaultTheme: 'light',
      glyphs: {
        kind: 'url',
        url: 'https://example.test/glyphs/{fontstack}/{range}.pbf',
        fontStacks: ['Noto Sans Regular'],
      },
      modules: {poi: disable()},
      themes: {dark, light: testLightTheme},
    },
    defaultTheme: 'dark',
  });

  const resolvedMap = parseTileflowMap(map);
  assert.equal(resolveThemeSelection(resolvedMap, undefined).name, 'dark');
  assert.throws(
    () => resolveThemeSelection(resolvedMap, 'system'),
    /browser-only selector.*concrete theme/i,
  );
  const lightStyle = createStyle(map, {theme: 'light'});
  const darkStyle = createStyle(map);
  assert.equal(lightStyle.metadata?.['tileflow:theme'], 'light');
  assert.equal(darkStyle.metadata?.['tileflow:theme'], 'dark');
  assert.equal(darkStyle.metadata?.['tileflow:colorScheme'], 'dark');
  assert.notDeepEqual(lightStyle.layers, darkStyle.layers);
});

test('the AI audit distinguishes implicit visual literals from explicit intent', () => {
  const diagnostics = auditTileflowThemeValues(
    {
      fill: {color: '#123456', opacity: 0.7},
      icon: {image: 'restaurant'},
      label: {font: fixed('Brand Sans', {reason: 'Brand contract'})},
      minZoom: 8,
      strokeColor: token.color('labels.primary'),
    },
    'modules.poi',
  );

  assert.deepEqual(
    diagnostics.map(({category, code, path, phase, scope, severity, value}) => ({
      category,
      code,
      path,
      phase,
      scope,
      severity,
      value,
    })),
    [
      {
        category: 'color',
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.fill.color',
        phase: 'theme-audit',
        scope: 'module',
        severity: 'error',
        value: '#123456',
      },
      {
        category: 'number',
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.fill.opacity',
        phase: 'theme-audit',
        scope: 'module',
        severity: 'warning',
        value: 0.7,
      },
      {
        category: 'image',
        code: 'THEME_IMPLICIT_FIXED',
        path: 'modules.poi.icon.image',
        phase: 'theme-audit',
        scope: 'module',
        severity: 'error',
        value: 'restaurant',
      },
    ],
  );
  assert.equal(
    diagnostics.every(({owner}) => owner === 'poi'),
    true,
  );
  assert.equal(
    diagnostics.every(({suggestion}) => suggestion.includes('fixed(value')),
    true,
  );
});

test('the blocking map audit throws structured resource errors but retains numbers as warnings', () => {
  const map = {
    modules: {
      poi: {
        fill: {color: '#123456', opacity: 0.7},
        icon: {image: 'restaurant'},
        label: {font: 'Noto Sans Regular'},
      },
    },
  };

  const diagnostics = auditTileflowMapThemeValues(map);
  assert.deepEqual(
    diagnostics.map(({category, severity}) => ({category, severity})),
    [
      {category: 'color', severity: 'error'},
      {category: 'number', severity: 'warning'},
      {category: 'image', severity: 'error'},
      {category: 'font', severity: 'error'},
    ],
  );
  assert.throws(
    () => assertTileflowMapThemeValues(map),
    (error: unknown) => {
      assert.ok(error instanceof TileflowThemeAuditError);
      assert.match(
        error.message,
        /3 blocking diagnostics; first error at modules\.poi\.fill\.color/,
      );
      assert.deepEqual(
        error.diagnostics.map(({category, path, severity}) => ({category, path, severity})),
        [
          {category: 'color', path: 'modules.poi.fill.color', severity: 'error'},
          {category: 'image', path: 'modules.poi.icon.image', severity: 'error'},
          {category: 'font', path: 'modules.poi.label.font', severity: 'error'},
        ],
      );
      return true;
    },
  );
  assert.doesNotThrow(() =>
    assertTileflowMapThemeValues({modules: {land: {fill: {opacity: 0.7}}}}),
  );
});

test('the map audit covers modules, terrain, and typed expression outputs', () => {
  const diagnostics = auditTileflowMapThemeValues({
    modules: {
      vegetation: {
        threeDimensional: {broadleafColors: ['#315f43', token.color('surface.park')]},
      },
      land: {fill: {color: '#123456', opacity: 0.72}, minZoom: 4},
      poi: {
        icon: {
          image: expression([
            'case',
            ['boolean', ['get', 'selected'], false],
            'selected-marker',
            'default-marker',
          ]),
        },
      },
    },
    terrain: {hillshade: {accentColor: '#654321', exaggeration: 0.42}, minZoom: 4},
  });

  assert.deepEqual(
    diagnostics.map(({category, path, scope, value}) => ({category, path, scope, value})),
    [
      {
        category: 'color',
        path: 'modules.land.fill.color',
        scope: 'module',
        value: '#123456',
      },
      {
        category: 'number',
        path: 'modules.land.fill.opacity',
        scope: 'module',
        value: 0.72,
      },
      {
        category: 'image',
        path: 'modules.poi.icon.image.value[2]',
        scope: 'module',
        value: 'selected-marker',
      },
      {
        category: 'image',
        path: 'modules.poi.icon.image.value[3]',
        scope: 'module',
        value: 'default-marker',
      },
      {
        category: 'color',
        path: 'modules.vegetation.threeDimensional.broadleafColors[0]',
        scope: 'module',
        value: '#315f43',
      },
      {
        category: 'color',
        path: 'terrain.hillshade.accentColor',
        scope: 'terrain',
        value: '#654321',
      },
      {
        category: 'number',
        path: 'terrain.hillshade.exaggeration',
        scope: 'terrain',
        value: 0.42,
      },
    ],
  );
  assert.equal(
    diagnostics.some(({path}) => /minZoom|filter/u.test(path)),
    false,
  );
});

test('data schema remaps stay structural when semantic field names resemble visual properties', () => {
  assert.deepEqual(
    auditTileflowMapThemeValues({
      data: {
        schema: {
          fields: {shieldTextColor: 'remapped_field_shieldTextColor'},
          layers: {roadShield: 'remapped_layer_roadShield'},
        },
      },
    }),
    [],
  );

  assert.ok(
    auditTileflowMapThemeValues({
      modules: {labels: {styles: {shields: {default: {text: {color: '#123456'}}}}}},
    }).some((diagnostic) => diagnostic.path.endsWith('.text.color')),
  );
});

test('POI color strategy stays structural while nested POI paint remains theme-aware', () => {
  assert.deepEqual(auditTileflowMapThemeValues({modules: {poi: {color: 'category'}}}), []);
  assert.throws(
    () =>
      resolveThemeValues(
        {modules: {poi: {color: token.color('labels.poi')}}},
        testLightTheme,
        'map.test',
      ),
    /outside a categorized visual property/u,
  );
  assert.equal(
    auditTileflowMapThemeValues({modules: {poi: {styles: {food: {text: {color: '#123456'}}}}}})[0]
      ?.path,
    'modules.poi.styles.food.text.color',
  );
});

test('the visual classifier shares plural, MapLibre, numeric, and structural semantics', () => {
  assert.equal(classifyTileflowVisualProperty('broadleafColors'), 'color');
  assert.equal(classifyTileflowVisualProperty('colors'), 'color');
  assert.equal(classifyTileflowVisualProperty('text-font'), 'font');
  assert.equal(classifyTileflowVisualProperty('fill-pattern'), 'image');
  assert.equal(classifyTileflowVisualProperty('opacity', 0.5), 'number');
  assert.equal(classifyTileflowVisualProperty('line-width', 2), 'number');
  for (const key of [
    'dash',
    'maxWidth',
    'offset',
    'padding',
    'patternWidths',
    'radialOffset',
    'rotate',
    'spacing',
    'text-offset',
    'symbol-spacing',
  ]) {
    assert.equal(classifyTileflowVisualProperty(key, [0, 1]), 'number', key);
  }
  for (const key of ['filter', 'maxZoom', 'minZoom', 'priority', 'symbol-sort-key', 'thresholds']) {
    assert.equal(classifyTileflowVisualProperty(key, 3), undefined, key);
  }
});

test('expression auditing follows typed outputs without reporting numeric conditions', () => {
  const diagnostics = auditTileflowThemeValues(
    {
      icon: {
        image: expression([
          'case',
          ['match', ['get', 'kind'], '#condition-label', true, false],
          'selected-marker',
          ['let', 'fallback', 'fallback-marker', ['var', 'fallback']],
        ]),
      },
      line: {
        width: expression(['case', ['>', ['get', 'rank'], 3], ['*', ['get', 'width'], 2], 0.5]),
      },
      raw: {image: ['string', ['get', 'icon'], 'raw-fallback']},
    },
    'modules.poi',
  );

  assert.deepEqual(
    diagnostics.map(({category, path, value}) => ({category, path, value})),
    [
      {
        category: 'image',
        path: 'modules.poi.icon.image.value[2]',
        value: 'selected-marker',
      },
      {
        category: 'image',
        path: 'modules.poi.icon.image.value[3][2]',
        value: 'fallback-marker',
      },
      {
        category: 'number',
        path: 'modules.poi.line.width.value[2][2]',
        value: 2,
      },
      {
        category: 'number',
        path: 'modules.poi.line.width.value[3]',
        value: 0.5,
      },
      {category: 'image', path: 'modules.poi.raw.image[1]', value: 'get'},
      {category: 'image', path: 'modules.poi.raw.image[2]', value: 'raw-fallback'},
    ],
  );
  assert.equal(
    diagnostics.some(({value}) =>
      ['#condition-label', 'kind', 'rank', 'string', '3'].includes(String(value)),
    ),
    false,
  );
});

test('numeric vectors and zoom outputs require visible invariant intent', () => {
  const diagnostics = auditTileflowThemeValues(
    {
      line: {
        dash: [2, 1],
        minZoom: 4,
        offset: [token.number('quiet'), fixed(1, {reason: 'Optical alignment'})],
        width: zoom.linear([
          [4, 0.5],
          [12, fixed(2, {reason: 'Maximum line weight'})],
        ]),
      },
      text: {offset: fixed([0, 1], {reason: 'Baseline alignment'})},
    },
    'modules.roads',
  );

  assert.deepEqual(
    diagnostics.map(({path, severity, value}) => ({path, severity, value})),
    [
      {path: 'modules.roads.line.dash[0]', severity: 'warning', value: 2},
      {path: 'modules.roads.line.dash[1]', severity: 'warning', value: 1},
      {path: 'modules.roads.line.width.stops[0][1]', severity: 'warning', value: 0.5},
    ],
  );
});
