import assert from 'node:assert/strict';
import test from 'node:test';
import {
  color,
  defineTheme,
  expr,
  field,
  fixed,
  labels,
  land,
  landforms,
  parseTileflowMap as parseMap,
  poi,
  renderPass,
  roads,
  tileflowLandformClasses,
  tileflowRenderSelectorComparisons,
  tileflowRenderSelectorGeometries,
  tileflowRenderStackLimits,
  tileflowRenderStackPhases,
  tileflowRenderStackRenderers,
  tileflowRoadClasses,
  tileflowThemeLimits,
  tileflowThemeTokenCategories,
  tileflowWorldV1Schema,
  token,
  validateTileflowMap,
  vegetation,
  water,
  withRenderStack,
  zoom,
} from '../src';
import {tileflowLayerDomains} from '../src/cartography/domains';
import {extendStreets, testLightTheme} from './map-fixture';

function parseDesign(input: unknown) {
  return parseMap(extendStreets(input as Parameters<typeof extendStreets>[0]));
}

function validateDesign(input: unknown) {
  return validateTileflowMap(extendStreets(input as Parameters<typeof extendStreets>[0]));
}

test('requires exact bounded portable identity and falls back from name to id', () => {
  const normalized = parseMap(extendStreets({id: 'madrid', name: '  Madrid Map  '}));
  assert.equal(normalized.id, 'madrid');
  assert.equal(normalized.name, 'Madrid Map');

  const fallback = parseMap(extendStreets({id: 'unnamed'}));
  assert.equal(fallback.name, 'unnamed');
  assert.equal(parseMap(extendStreets({id: 'a'.repeat(64)})).id, 'a'.repeat(64));

  for (const id of [
    'a'.repeat(65),
    'Main',
    'con',
    'constructor',
    '__proto__',
    'not_portable',
    'not portable',
    '  madrid  ',
  ]) {
    assert.throws(() => parseMap(extendStreets({id})), /map id/i);
  }
});

test('requires concrete portable theme names in every map selector', () => {
  for (const name of ['system', 'CON', 'Dark', 'dark_mode', 'd'.repeat(65)]) {
    assert.throws(
      () =>
        parseDesign({
          defaultTheme: name,
          themes: {[name]: testLightTheme},
        }),
      /defaultTheme|themes|concrete theme|lowercase kebab-case|portable/i,
      name,
    );
  }
});

test('keeps the canonical theme vocabulary and collection limit aligned with validation', () => {
  assert.deepEqual(
    Object.keys(testLightTheme.tokens).sort(),
    [...tileflowThemeTokenCategories].sort(),
  );

  const themes = Object.fromEntries(
    Array.from({length: tileflowThemeLimits.maxThemes}, (_, index) => {
      const name = `theme-${index}`;
      return [name, {...testLightTheme, id: name}];
    }),
  );
  assert.equal(validateDesign({defaultTheme: 'theme-0', themes}).valid, true);
  assert.equal(
    validateDesign({
      defaultTheme: 'theme-0',
      themes: {
        ...themes,
        overflow: {...testLightTheme, id: 'overflow'},
      },
    }).valid,
    false,
  );
});

test('accepts the canonical singular map design and validates bounded controls', () => {
  const natural = defineTheme(testLightTheme, {
    id: 'natural',
    version: 1,
    colorScheme: 'light',
    tokens: {
      color: {
        'landcover.farmland': '#DCECCB',
        'landcover.rock': '#F7F4F0',
        'landcover.wetland': '#BFE2CF',
      },
    },
  });
  const design = {
    projection: 'globe' as const,
    defaultTheme: 'natural',
    themes: {natural},
    modules: {
      labels: labels({
        styles: {
          places: {
            city: {
              priority: 80,
              text: {
                keepUpright: true,
                maxAngle: 40,
                radialOffset: 1,
                variableAnchors: ['top', 'bottom'],
              },
            },
          },
        },
      }),
      roads: roads({hierarchy: 'strong'}),
    },
    view: {center: [-3.7038, 40.4168] as [number, number], pitch: 45, zoom: 15},
  };
  assert.deepEqual(parseDesign(design).themes, design.themes);
  const dark = defineTheme(natural, {
    id: 'natural-dark',
    version: 1,
    colorScheme: 'dark',
  });
  assert.equal(
    validateTileflowMap(extendStreets({...design, defaultTheme: 'dark', themes: {dark}})).valid,
    true,
  );
  assert.throws(() => parseDesign({view: {pitch: 86}}), /view\.pitch/);
  assert.throws(() => parseDesign({projection: 'sphere'} as never), /projection/);
  assert.throws(
    () =>
      parseDesign({
        themes: {light: {...testLightTheme, lighting: {intensity: 1.1}}},
      }),
    /lighting\.intensity/,
  );
});

test('accepts ordered icon-directory arrays and rejects provider objects or bare paths', () => {
  const canonicalDirectories = [
    './base',
    './nested/icons',
    '../shared',
    '../../shared/icons',
    `./${'a'.repeat(510)}`,
  ];
  assert.deepEqual(parseDesign({icons: canonicalDirectories}).icons, canonicalDirectories);
  assert.deepEqual(parseDesign({icons: []}).icons, []);

  for (const icons of [
    {source: './icons'},
    {builtin: 'streets'},
    './icons',
    ['icons'],
    ['./'],
    ['../'],
    ['./icons/'],
    ['./icons//nested'],
    ['././icons'],
    ['./icons/../other'],
    ['../shared/../other'],
    ['./icons\\nested'],
    ['./icons\0nested'],
    [`./${'a'.repeat(511)}`],
  ]) {
    assert.throws(() => parseDesign({icons} as never), /icons|array|directory/i);
  }
});

test('rejects repository-owned Hosted delivery policy', () => {
  assert.equal(
    validateDesign({
      delivery: {
        hosted: {allowedOrigins: ['https://maps.example.test']},
      },
    }).valid,
    false,
  );
  assert.equal(validateDesign({allowedOrigins: ['https://maps.example.test']}).valid, false);
});

test('rejects glyph URL fragments for absolute and relative providers', () => {
  for (const url of [
    '/fonts/{fontstack}/{range}.pbf#fragment',
    './fonts/{fontstack}/{range}.pbf#fragment',
    '../fonts/{fontstack}/{range}.pbf#fragment',
    'https://fonts.example.test/{fontstack}/{range}.pbf#fragment',
  ]) {
    assert.equal(
      validateDesign({
        glyphs: {kind: 'url', url, fontStacks: ['Noto Sans Regular']},
      }).valid,
      false,
      url,
    );
  }
});

test('requires exact unique NFC font faces', () => {
  assert.doesNotThrow(() =>
    defineTheme(testLightTheme, {
      id: 'font-theme',
      version: 1,
      colorScheme: 'light',
      typography: {
        font: 'Noto Sans Regular',
        fallbacks: ['Arial Unicode MS', 'sans-serif'],
      },
    }),
  );
  for (const typography of [
    {font: ' Noto Sans Regular'},
    {font: 'Noto Sans\\Regular'},
    {font: 'Cafe\u0301'},
    {fallbacks: ['sans-serif', 'sans-serif']},
  ]) {
    assert.throws(() =>
      defineTheme(testLightTheme, {
        id: 'invalid-font-theme',
        version: 1,
        colorScheme: 'light',
        typography,
      }),
    );
  }
});

test('accepts a resolved-map remap for the optional global land-cover extension', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: {
        type: 'openmaptiles',
        contractVersion: 1,
        layers: {globalLandcover: 'worldcover_lowzoom'},
      },
      url: '/tiles.json',
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.globalLandcover, 'worldcover_lowzoom');
  assert.equal(map.data.schema.layers.landcover, 'landcover');
});

test('accepts the typed Tileflow World V1 bathymetry extension at runtime', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: tileflowWorldV1Schema(),
      url: '/tiles.json',
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.bathymetry, 'bathymetry');
  assert.equal(map.data.schema.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(map.data.schema.fields.bathymetrySortKey, 'sort_key');
});

test('accepts detailed cartographic module styles and their optional data bindings', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: tileflowWorldV1Schema({
        fields: {
          circularInnerRadiusMeters: 'inner_radius_m',
          circularKind: 'circle_kind',
          circularOuterRadiusMeters: 'outer_radius_m',
          circularRadiusAtZoom15: 'radius_px_z15',
          circularRadiusMeters: 'radius_m',
          direction: 'direction',
          importanceTier: 'importance_tier',
        },
        layers: {
          circularFeature: 'circular_feature',
          sidewalk: 'sidewalk',
          streetFurniture: 'street_furniture',
        },
      }),
      url: '/tiles.json',
    },
    modules: {
      land: land({globalLandcover: {color: '#123456'}}),
      roads: roads({
        crossings: {image: 'crosswalk'},
        roundabouts: {fill: {strokeColor: '#234567'}},
        sidewalks: {pattern: {pattern: 'sidewalk-dot'}},
      }),
      vegetation: vegetation({
        flat: {color: '#345678'},
        mode: '3d',
        threeDimensional: {
          barkColor: '#456789',
          broadleafColors: ['#56789A'],
          coniferColors: ['#6789AB'],
          crownScale: 1.2,
          heightScale: 1.4,
        },
      }),
      water: water({
        bathymetry: {color: '#789ABC'},
        bathymetryContours: {
          color: '#56789A',
          dash: [2, 1],
          maxZoom: 10,
          minZoom: 3,
          width: 0.75,
        },
        bathymetryLabels: {
          maxZoom: 9,
          minZoom: 4,
          priority: 12,
          spacing: 96,
          text: {
            color: '#6789AB',
            field: 'depth-floor',
            font: 'Noto Sans Bold',
            size: 11,
          },
          zOrder: 'source',
        },
      }),
    },
  });

  assert.equal(map.modules?.land?.globalLandcover?.color, '#123456');
  assert.equal(map.modules?.roads?.crossings?.image, 'crosswalk');
  assert.equal(map.modules?.vegetation?.threeDimensional?.heightScale, 1.4);
  assert.equal(map.modules?.water?.bathymetry?.color, '#789ABC');
  assert.deepEqual(map.modules?.water?.bathymetryContours, {
    color: '#56789A',
    dash: [2, 1],
    maxZoom: 10,
    minZoom: 3,
    width: 0.75,
  });
  assert.deepEqual(map.modules?.water?.bathymetryLabels, {
    maxZoom: 9,
    minZoom: 4,
    priority: 12,
    spacing: 96,
    text: {
      color: '#6789AB',
      field: 'depth-floor',
      font: 'Noto Sans Bold',
      size: 11,
    },
    zOrder: 'source',
  });
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.circularFeature, 'circular_feature');
  assert.equal(map.data.schema.fields.direction, 'direction');

  assert.throws(
    () =>
      parseDesign({
        modules: {vegetation: vegetation({threeDimensional: {heightScale: 11}})},
      }),
    /heightScale/,
  );
});

test('accepts category-safe theme values, expressions, and zoom ramps in style slots', () => {
  const map = parseDesign({
    modules: {
      land: land({
        background: {
          color: color.alpha(token.color('surface.background'), 0.85),
          opacity: zoom.linear([
            [0, token.number('style.opacity.low')],
            [12, token.number('style.opacity.high')],
          ]),
          pattern: zoom.step([
            [0, token.image('surface.pattern.small')],
            [12, fixed('surface-pattern-large', {reason: 'Authored sprite identity'})],
          ]),
        },
        globalLandcover: {
          color: expr.case(
            [
              {
                when: expr.toBoolean(expr.featureState('active'), false),
                value: token.color('surface.active'),
              },
            ],
            color.alpha(token.color('surface.land'), 0.9),
          ),
          opacity: expr.coalesce(expr.get(field('confidence')), token.number('style.opacity.high')),
          pattern: expr.coalesce(expr.get(field('surface')), token.image('surface.pattern.small')),
        },
      }),
      roads: roads({crossings: {image: token.image('roads.crossing')}}),
      labels: labels({
        styles: {
          shields: {
            default: {
              icon: {
                image: 'road-shield',
                textFit: 'width',
                textFitPadding: [0, token.number('labels.shieldPadding'), 0, 5],
              },
              text: {color: token.color('labels.primary')},
            },
            detail: {spacing: token.number('labels.shieldSpacing')},
            kinds: {blue: {image: token.image('roads.shield.blue')}},
            overview: {priority: 90},
            textColors: {light: {color: token.color('labels.shieldLight')}},
          },
        },
      }),
      water: water({
        bathymetryContours: {
          cap: zoom.step([
            [0, 'butt'],
            [10, 'round'],
          ]),
          dash: zoom.linear([
            [0, fixed([1, 1], {reason: 'Bathymetry dash cadence'})],
            [10, [2, 1]],
          ]),
        },
        bathymetryLabels: {
          text: {
            color: token.color('labels.primary'),
            field: zoom.step([
              [0, 'depth-short'],
              [10, 'depth-long'],
            ]),
            offset: [token.number('labels.offset.x'), fixed(1, {reason: 'Depth-label baseline'})],
            size: token.number('labels.size'),
          },
        },
      }),
    },
  });

  assert.deepEqual(map.modules?.roads?.crossings?.image, token.image('roads.crossing'));
  assert.deepEqual(map.modules?.labels?.styles?.shields?.default?.icon?.textFitPadding, [
    0,
    token.number('labels.shieldPadding'),
    0,
    5,
  ]);
  assert.deepEqual(
    map.modules?.labels?.styles?.shields?.kinds?.blue?.image,
    token.image('roads.shield.blue'),
  );
  assert.deepEqual(
    map.modules?.labels?.styles?.shields?.textColors?.light?.color,
    token.color('labels.shieldLight'),
  );
  assert.deepEqual(map.modules?.water?.bathymetryLabels?.text?.offset, [
    token.number('labels.offset.x'),
    fixed(1, {reason: 'Depth-label baseline'}),
  ]);
  assert.deepEqual(
    map.modules?.water?.bathymetryLabels?.text?.field,
    zoom.step([
      [0, 'depth-short'],
      [10, 'depth-long'],
    ]),
  );
});

test('serialized zoom ramps require ordered finite stops and interpolation-specific bases', () => {
  const validateRamp = (value: unknown) =>
    validateDesign({
      modules: {land: {type: 'land', background: {opacity: value}}},
    }).valid;
  const stops = [
    [0, 0.25],
    [12, 0.75],
  ];

  assert.equal(validateRamp({kind: 'zoom', interpolation: 'exponential', base: 1.5, stops}), true);
  assert.equal(validateRamp({kind: 'zoom', interpolation: 'linear', stops}), true);
  assert.equal(validateRamp({kind: 'zoom', interpolation: 'step', stops}), true);

  for (const invalid of [
    {kind: 'zoom', interpolation: 'exponential', stops},
    {kind: 'zoom', interpolation: 'exponential', base: 0, stops},
    {kind: 'zoom', interpolation: 'linear', base: 1.5, stops},
    {kind: 'zoom', interpolation: 'step', base: 1.5, stops},
    {
      kind: 'zoom',
      interpolation: 'linear',
      stops: [
        [8, 0.25],
        [8, 0.75],
      ],
    },
    {
      kind: 'zoom',
      interpolation: 'linear',
      stops: [
        [12, 0.25],
        [8, 0.75],
      ],
    },
    {kind: 'zoom', interpolation: 'linear', stops: [[Number.POSITIVE_INFINITY, 0.5]]},
  ]) {
    assert.equal(validateRamp(invalid), false, JSON.stringify(invalid));
  }
});

test('closes render-stack feature and selector fields over the semantic data vocabulary', () => {
  const validPass = renderPass({
    attachTo: 'water.bodies.fill',
    feature: 'water',
    phase: 'overlay',
    renderer: 'fill',
    selector: {field: 'class', kind: 'compare', operator: 'eq', value: 'lake'},
    style: {opacity: 0.5},
  });
  assert.equal(
    validateDesign({modules: {water: withRenderStack(water(), {lakeOverlay: validPass})}}).valid,
    true,
  );

  for (const operation of [
    {...validPass, feature: 'physical_source_layer'},
    {
      ...validPass,
      selector: {field: 'physical_column', kind: 'compare', operator: 'eq', value: 'lake'},
    },
  ]) {
    assert.equal(
      validateDesign({
        modules: {
          water: {
            ...water(),
            renderStack: {lakeOverlay: operation},
          },
        },
      }).valid,
      false,
    );
  }
});

test('uses the V1 semantic-target and single-segment render-stack name grammar', () => {
  const pass = renderPass({
    attachTo: 'water.bodies.fill',
    phase: 'overlay',
    renderer: 'fill',
    style: {opacity: 0.5},
  });
  const validatesTarget = (target: string) =>
    validateDesign({
      modules: {water: {...water(), renderStack: {lakeOverlay: {...pass, attachTo: target}}}},
    }).valid;
  const validatesName = (name: string) =>
    validateDesign({
      modules: {water: {...water(), renderStack: {[name]: pass}}},
    }).valid;

  for (const target of [
    'water',
    'water.bodies.fill',
    'water.render.lakeOverlay',
    'water.2d',
    'water._underlay',
  ]) {
    assert.equal(validatesTarget(target), true, target);
  }
  for (const target of [
    'Water.bodies.fill',
    '1water.bodies.fill',
    'water..fill',
    '.water.fill',
    'water body.fill',
  ]) {
    assert.equal(validatesTarget(target), false, target);
  }

  for (const name of ['lakeOverlay', 'lake-overlay', 'lake_overlay', 'lake2']) {
    assert.equal(validatesName(name), true, name);
  }
  for (const name of ['LakeOverlay', '2lake', '_lake', 'lake.overlay', 'lake overlay']) {
    assert.equal(validatesName(name), false, name);
  }
});

test('accepts every value from the canonical render, roads, and landforms vocabularies', () => {
  const validatesOperation = (operation: unknown) =>
    validateDesign({
      modules: {water: {...water(), renderStack: {canonical: operation}}},
    }).valid;
  const pass = {
    attachTo: 'water.bodies.fill',
    kind: 'render-pass',
    phase: 'overlay',
    renderer: 'fill',
    style: {},
  };

  for (const geometry of tileflowRenderSelectorGeometries) {
    assert.equal(
      validatesOperation({...pass, selector: {geometry, kind: 'geometry'}}),
      true,
      geometry,
    );
  }
  for (const operator of tileflowRenderSelectorComparisons) {
    assert.equal(
      validatesOperation({
        ...pass,
        selector: {field: 'class', kind: 'compare', operator, value: 'water'},
      }),
      true,
      operator,
    );
  }
  for (const phase of tileflowRenderStackPhases) {
    assert.equal(validatesOperation({...pass, phase}), true, phase);
  }
  for (const renderer of tileflowRenderStackRenderers) {
    assert.equal(validatesOperation({...pass, renderer}), true, renderer);
  }

  assert.equal(
    validateDesign({
      modules: {
        roads: roads({classes: Object.fromEntries(tileflowRoadClasses.map((name) => [name, {}]))}),
      },
    }).valid,
    true,
  );
  assert.equal(
    validateDesign({
      modules: {
        landforms: landforms({
          classes: Object.fromEntries(tileflowLandformClasses.map((name) => [name, {}])),
        }),
      },
    }).valid,
    true,
  );
});

test('keeps serialized render-stack limits identical to builder and runtime limits', () => {
  const literal = () => ({kind: 'literal' as const, value: true});
  const nestedSelector = (nodes: number): unknown => {
    let selector: unknown = literal();
    for (let index = 1; index < nodes; index += 1) {
      selector = {kind: 'not', selector};
    }
    return selector;
  };
  const pass = renderPass({
    attachTo: 'water.bodies.fill',
    phase: 'overlay',
    renderer: 'fill',
    style: {opacity: 0.5},
  });
  const validatesSelector = (selector: unknown) =>
    validateDesign({
      modules: {
        water: {...water(), renderStack: {limited: {...pass, selector}}},
      },
    }).valid;
  const validatesRequirements = (requirements: readonly string[]) =>
    validateDesign({
      modules: {
        water: {...water(), renderStack: {limited: {...pass, requirements}}},
      },
    }).valid;

  assert.equal(
    validatesSelector({
      kind: 'all',
      selectors: Array.from({length: tileflowRenderStackLimits.maxSelectorChildren}, literal),
    }),
    true,
  );
  assert.equal(
    validatesSelector({
      kind: 'all',
      selectors: Array.from({length: tileflowRenderStackLimits.maxSelectorChildren + 1}, literal),
    }),
    false,
  );

  const scalarValues = Array.from(
    {length: tileflowRenderStackLimits.maxScalarValues},
    (_, index) => `value-${index}`,
  );
  assert.equal(validatesSelector({field: 'class', kind: 'in', values: scalarValues}), true);
  assert.equal(
    validatesSelector({field: 'class', kind: 'in', values: [...scalarValues, 'overflow']}),
    false,
  );
  assert.equal(
    validatesSelector({
      branches: [{result: true, values: scalarValues}],
      field: 'class',
      kind: 'match',
      otherwise: false,
    }),
    true,
  );
  assert.equal(
    validatesSelector({
      branches: [{result: true, values: [...scalarValues, 'overflow']}],
      field: 'class',
      kind: 'match',
      otherwise: false,
    }),
    false,
  );
  const branches = Array.from({length: tileflowRenderStackLimits.maxMatchBranches}, (_, index) => ({
    result: index % 2 === 0,
    values: [`branch-${index}`],
  }));
  assert.equal(
    validatesSelector({branches, field: 'class', kind: 'match', otherwise: false}),
    true,
  );
  assert.equal(
    validatesSelector({
      branches: [...branches, {result: true, values: ['overflow']}],
      field: 'class',
      kind: 'match',
      otherwise: false,
    }),
    false,
  );

  const stops = Array.from({length: tileflowRenderStackLimits.maxStepStops}, (_, zoom) => ({
    selector: literal(),
    zoom,
  }));
  assert.equal(validatesSelector({fallback: literal(), kind: 'step', stops}), true);
  for (const invalidStops of [
    [...stops, {selector: literal(), zoom: stops.length}],
    [
      {selector: literal(), zoom: 2},
      {selector: literal(), zoom: 2},
    ],
    [
      {selector: literal(), zoom: 3},
      {selector: literal(), zoom: 2},
    ],
    [{selector: literal(), zoom: Number.POSITIVE_INFINITY}],
  ]) {
    assert.equal(
      validatesSelector({fallback: literal(), kind: 'step', stops: invalidStops}),
      false,
    );
  }

  assert.equal(validatesSelector(nestedSelector(tileflowRenderStackLimits.maxSelectorDepth)), true);
  assert.equal(
    validatesSelector(nestedSelector(tileflowRenderStackLimits.maxSelectorDepth + 1)),
    false,
  );
  const exactNodeBudget = {
    kind: 'all',
    selectors: [...Array.from({length: 15}, () => nestedSelector(16)), nestedSelector(15)],
  };
  const overflowingNodeBudget = {
    kind: 'all',
    selectors: Array.from({length: 16}, () => nestedSelector(16)),
  };
  assert.equal(validatesSelector(exactNodeBudget), true);
  assert.equal(validatesSelector(overflowingNodeBudget), false);

  assert.equal(validatesRequirements(tileflowLayerDomains), true);
  assert.equal(validatesRequirements(['roads', 'roads']), false);
  assert.equal(validatesRequirements([...tileflowLayerDomains, 'water']), false);

  const operations = Object.fromEntries(
    Array.from({length: tileflowRenderStackLimits.maxOperations}, (_, index) => [
      `operation${index}`,
      pass,
    ]),
  );
  assert.equal(
    validateDesign({modules: {water: {...water(), renderStack: operations}}}).valid,
    true,
  );
  assert.equal(
    validateDesign({
      modules: {
        water: {...water(), renderStack: {...operations, operationOverflow: pass}},
      },
    }).valid,
    false,
  );
});

test('rejects forged expression arrays and physical data bindings', () => {
  for (const value of [
    {kind: 'expression', value: ['get', 'class']},
    {
      kind: 'expression',
      value: ['get', {kind: 'tileflow-data-field', name: 'physical_column'}],
    },
    {kind: 'expression', value: ['paint-the-map', '#ff00ff']},
  ]) {
    assert.throws(
      () =>
        parseDesign({
          modules: {
            land: land({globalLandcover: {color: value as never}}),
          },
        }),
      /closed Tileflow expression|registered semantic field|semantic field|unsupported Tileflow/iu,
    );
  }
});

test('rejects wrong theme-token categories in direct and zoom-dependent style values', () => {
  const invalidStyles = [
    {
      label: 'image token in color',
      path: 'modules.land.background.color',
      modules: {land: {type: 'land', background: {color: token.image('wrong')}}},
    },
    {
      label: 'font token in color',
      path: 'modules.land.background.color',
      modules: {land: {type: 'land', background: {color: token.font('wrong')}}},
    },
    {
      label: 'number token in color',
      path: 'modules.land.background.color',
      modules: {land: {type: 'land', background: {color: token.number('wrong')}}},
    },
    {
      label: 'color token in image',
      path: 'modules.land.background.pattern',
      modules: {land: {type: 'land', background: {pattern: token.color('wrong')}}},
    },
    {
      label: 'font token in image',
      path: 'modules.land.background.pattern',
      modules: {land: {type: 'land', background: {pattern: token.font('wrong')}}},
    },
    {
      label: 'color operation in image',
      path: 'modules.land.background.pattern',
      modules: {
        land: {type: 'land', background: {pattern: color.alpha('#ffffff', 0.5)}},
      },
    },
    {
      label: 'color token in number',
      path: 'modules.land.background.opacity',
      modules: {land: {type: 'land', background: {opacity: token.color('wrong')}}},
    },
    {
      label: 'image token in text field',
      path: 'modules.water.bathymetryLabels.text.field',
      modules: {
        water: {
          type: 'water',
          bathymetryLabels: {text: {field: token.image('wrong')}},
        },
      },
    },
    {
      label: 'fixed theme value in structural text field',
      path: 'modules.water.bathymetryLabels.text.field',
      modules: {
        water: {
          type: 'water',
          bathymetryLabels: {
            text: {field: fixed('depth', {reason: 'Not a theme-bearing value'})},
          },
        },
      },
    },
    {
      label: 'image token in color zoom stop',
      path: 'modules.land.background.color.stops.0.1',
      modules: {
        land: {
          type: 'land',
          background: {color: zoom.step([[0, token.image('wrong')]])},
        },
      },
    },
    {
      label: 'color token in image zoom stop',
      path: 'modules.land.background.pattern.stops.0.1',
      modules: {
        land: {
          type: 'land',
          background: {pattern: zoom.step([[0, token.color('wrong')]])},
        },
      },
    },
    {
      label: 'color token in number zoom stop',
      path: 'modules.land.background.opacity.stops.0.1',
      modules: {
        land: {
          type: 'land',
          background: {opacity: zoom.step([[0, token.color('wrong')]])},
        },
      },
    },
    {
      label: 'theme token in structural zoom stop',
      path: 'modules.water.bathymetryLabels.text.field.stops.0.1',
      modules: {
        water: {
          type: 'water',
          bathymetryLabels: {text: {field: zoom.step([[0, token.color('wrong')]])}},
        },
      },
    },
    {
      label: 'image token in color expression',
      path: 'modules.land.globalLandcover.color',
      modules: {
        land: {
          type: 'land',
          globalLandcover: {
            color: expr.coalesce(expr.get(field('buildingTone')), token.image('wrong')) as never,
          },
        },
      },
    },
    {
      label: 'color token in image expression',
      path: 'modules.land.globalLandcover.pattern',
      modules: {
        land: {
          type: 'land',
          globalLandcover: {
            pattern: expr.coalesce(expr.get(field('surface')), token.color('wrong')) as never,
          },
        },
      },
    },
    {
      label: 'color token in number expression',
      path: 'modules.land.globalLandcover.opacity',
      modules: {
        land: {
          type: 'land',
          globalLandcover: {
            opacity: expr.coalesce(expr.get(field('confidence')), token.color('wrong')) as never,
          },
        },
      },
    },
    {
      label: 'theme token in structural expression',
      path: 'modules.water.bathymetryLabels.text.field',
      modules: {
        water: {
          type: 'water',
          bathymetryLabels: {
            text: {
              field: expr.coalesce(expr.get(field('name')), token.color('wrong')) as never,
            },
          },
        },
      },
    },
    {
      label: 'theme token in line-cap zoom stop',
      path: 'modules.water.bathymetryContours.cap.stops.0.1',
      modules: {
        water: {
          type: 'water',
          bathymetryContours: {cap: zoom.step([[0, token.color('wrong')]])},
        },
      },
    },
    {
      label: 'scalar in dash zoom stop',
      path: 'modules.water.bathymetryContours.dash.stops.0.1',
      modules: {
        water: {
          type: 'water',
          bathymetryContours: {dash: zoom.step([[0, 2]])},
        },
      },
    },
    {
      label: 'three-value icon text-fit padding',
      path: 'modules.labels.styles.shields.default.icon.textFitPadding',
      modules: {
        labels: {
          type: 'labels',
          styles: {shields: {default: {icon: {textFitPadding: [0, 4, 0]}}}},
        },
      },
    },
  ] as const;

  for (const {label, modules, path} of invalidStyles) {
    const result = validateDesign({modules} as never);
    assert.equal(result.valid, false, label);
    assert.ok(
      result.messages.some(
        (message) =>
          message.path === path ||
          path.startsWith(`${message.path}.`) ||
          message.path.startsWith(`${path}.`),
      ),
      `${label}: expected ${path}; received ${JSON.stringify(result.messages)}`,
    );
  }
});

test('accepts the canonical POI contract and rejects legacy ranking controls', () => {
  const map = parseDesign({
    modules: {
      poi: poi({
        categories: ['arts-entertainment', 'food-drink', 'transport'],
        density: 3,
        icons: true,
        labels: true,
        styles: {
          'arts-entertainment': {icon: {size: 0.9}},
        },
      }),
    },
  });

  assert.equal(map.modules?.poi?.density, 3);
  assert.deepEqual(map.modules?.poi?.categories, ['arts-entertainment', 'food-drink', 'transport']);

  for (const density of [0, 2.5, 6, 'balanced']) {
    assert.throws(() => parseDesign({modules: {poi: {type: 'poi', density}}} as never), /density/u);
  }
  for (const legacy of [
    {classMapping: {food: ['restaurant']}},
    {maxRank: 80},
    {preset: 'balanced'},
    {icons: 'full'},
    {labels: 'balanced'},
    {categories: ['food']},
    {styles: {'food-drink': {priority: 10}}},
  ]) {
    assert.throws(
      () => parseDesign({modules: {poi: {type: 'poi', ...legacy}}} as never),
      /poi|Unrecognized|Invalid/u,
    );
  }
});

test('accepts direct fixture tile templates without a TileJSON lookup', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Fixture',
      revision: 'fixture_1',
      schema: {type: 'openmaptiles', contractVersion: 1},
      tiles: ['pmtiles://./test/fixtures/world.pmtiles'],
      minzoom: 0,
      maxzoom: 14,
      bounds: [-180, -85, 180, 85],
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.deepEqual(map.data.tiles, ['pmtiles://./test/fixtures/world.pmtiles']);
  assert.equal(map.data.url, undefined);
});

test('rejects unsafe vector URLs at the resolved-map validation boundary', () => {
  for (const data of [
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: 'http://tiles.example.test/tiles.json',
    },
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      tiles: ['javascript:alert(1)'],
    },
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: 'pmtiles://./../private/world.pmtiles',
    },
  ]) {
    assert.throws(() => parseDesign({data}), /vector tile URL|PMTiles/u);
  }
});

test('accepts current and exact World selectors and rejects incomplete identity', () => {
  const map = parseDesign({
    data: {
      type: 'tileflow-world',
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
    },
  });

  assert.deepEqual(map.data, {
    type: 'tileflow-world',
    generation: 'v1',
    selection: {kind: 'current', product: 'world-v1'},
  });
  const exact = {
    kind: 'release' as const,
    product: 'world-v1' as const,
    release: {
      descriptorSha256: 'a'.repeat(64),
      releaseId: 'world-v1-archive-42',
    },
  };
  assert.deepEqual(
    parseDesign({
      data: {type: 'tileflow-world', generation: 'v1', selection: exact},
    }).data,
    {type: 'tileflow-world', generation: 'v1', selection: exact},
  );
  assert.throws(() =>
    parseDesign({
      data: {
        type: 'tileflow-world',
        generation: 'v1',
        selection: {
          kind: 'release',
          product: 'world-v1',
          release: {releaseId: 'world-v1-archive-42'},
        },
      },
    }),
  );
  assert.throws(() => parseDesign({data: {type: 'tileflow-world'}}), /data/);
});

test('rejects every removed renderer and data path with its exact location', () => {
  const removed = [
    [{renderer: 'generated'}, 'renderer'],
    [{tileset: 'world'}, 'tileset'],
    [{tiles: ['https://tiles.example/{z}/{x}/{y}.pbf']}, 'tiles'],
    [{colors: {water: '#fff'}}, 'colors'],
    [{roads: 'standard'}, 'roads'],
  ] as const;

  for (const [legacy, path] of removed) {
    const result = validateDesign({...legacy});
    assert.equal(result.valid, false);
    assert.match(result.messages[0]?.message ?? '', new RegExp(`\\b${path}\\b`));
  }
});

test('rejects legacy roots and requires keyed modules', () => {
  assert.throws(
    () => parseDesign({basemap: {type: 'osm'}, modules: []}),
    /unrecognized key "basemap"|modules/,
  );
  assert.throws(() => parseDesign({modules: [roads()]}), /modules/);
});

test('rejects unknown semantic controls instead of ignoring them', () => {
  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {...roads(), magicWidth: 12}},
      }),
    /modules\.roads/,
  );
});

test('accepts semantic path road targets and rejects the old overlapping path target', () => {
  assert.doesNotThrow(() =>
    parseDesign({
      modules: {
        labels: labels({roadClasses: ['pedestrian', 'footway', 'cycleway', 'steps', 'pathway']}),
        roads: roads({
          areas: {
            pedestrian: {
              fill: {color: '#F1F3F5'},
              outline: {color: '#D5DCE3', width: 1},
            },
          },
          classes: {pedestrian: {}, footway: {}, cycleway: {}, steps: {}, pathway: {}},
          structures: {
            tunnel: {
              hatch: {
                angle: 4,
                color: '#8EA3B8',
                minZoom: 15,
                opacity: 0.25,
                size: 12,
                spacing: 10,
              },
            },
          },
          modifiers: {
            construction: {surface: {fill: {dash: [2, 1], opacity: 0.7}}},
            expressway: {widthScale: 1.1},
            indoor: {surface: {fill: {opacity: 0.4}}},
            official: {surface: {casing: {color: '#445566'}}},
            ramp: {widthScale: 0.7},
            unpaved: {surface: {fill: {color: '#E9E4DA'}}},
          },
          mountainBike: {'0': {surface: {fill: {color: '#55AA66'}}}},
          restrictions: {
            access: {surface: {fill: {opacity: 0.5}}},
            toll: {surface: {fill: {dash: [3, 1]}}},
          },
          serviceTypes: {driveway: {widthScale: 0.75}, parkingAisle: {widthScale: 0.6}},
        }),
      },
    }),
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {type: 'roads', classes: {path: {}}}},
      } as never),
    /path/,
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {...roads(), modifiers: {crossing: {widthScale: 0.5}}}},
      } as never),
    /crossing/,
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {
          water: {
            type: 'water',
            waterways: {river: {filter: {kind: 'filter', value: []}}},
          },
        },
      } as never),
    /filter/,
  );
});

test('rejects unsafe authoring objects and unresolved map references', () => {
  assert.throws(() => parseDesign({theme: 'missing'}), /unrecognized key "theme"/i);
  assert.throws(
    () => parseDesign({themes: {dark: {extends: 'dark'}}}),
    /themes\.dark|Unrecognized key/i,
  );
  assert.throws(
    () => parseMap(Object.create({id: 'madrid', version: 1, extends: extendStreets()})),
    /map object/,
  );
});
