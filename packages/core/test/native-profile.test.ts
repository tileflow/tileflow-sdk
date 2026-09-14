import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTileflowNativeStyle,
  createTileflowNativeBuildRecord,
  resolveTileflowRenderer,
  TileflowNativeCompatibilityError,
  tileflowNativeBuildRecordSchema,
  tileflowNativeDiagnosticSchema,
  tileflowNativeProfile,
  tileflowNativeProfileLimits,
  tileflowNativeProfileSchema,
  validateTileflowNativeStyle,
} from '../src/native-profile';

const documentUrl = 'https://maps.example.test/native/styles/map/light.json';
const background = () => ({
  version: 8,
  sources: {},
  layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}],
});
const labels = () => ({
  version: 8,
  glyphs: 'https://maps.example.test/glyphs/{fontstack}/{range}.pbf',
  sources: {world: {type: 'vector', tiles: ['https://maps.example.test/{z}/{x}/{y}.pbf']}},
  layers: [
    {
      id: 'labels',
      type: 'symbol',
      source: 'world',
      'source-layer': 'poi',
      layout: {
        'text-field': ['get', 'name'] as unknown[],
        'text-font': ['Noto Sans Regular'] as unknown[],
      },
    },
  ],
});

function hasIssue(value: unknown, code: string, path: string): void {
  const issues = validateTileflowNativeStyle(value, {documentUrl});
  assert.ok(
    issues.some((issue) => issue.code === code && issue.path === path),
    JSON.stringify(issues),
  );
  for (const issue of issues)
    assert.equal(tileflowNativeDiagnosticSchema.safeParse(issue).success, true);
}

test('defines one strict, immutable static native profile and a separate build record', () => {
  assert.equal(tileflowNativeProfileSchema.safeParse(tileflowNativeProfile).success, true);
  assert.equal(
    tileflowNativeProfileSchema.safeParse({...tileflowNativeProfile, qualified: true}).success,
    false,
  );
  assert.equal(Object.isFrozen(tileflowNativeProfile), true);
  assert.equal(resolveTileflowRenderer(), 'web');
  assert.equal(resolveTileflowRenderer('web'), 'web');
  assert.equal(resolveTileflowRenderer('native'), 'native');
  const record = createTileflowNativeBuildRecord('a'.repeat(64));
  assert.equal(record.profile, 'native-v1');
  assert.equal(record.validation, 'static-artifacts');
  assert.deepEqual(record.engines, {android: '13.2.0', ios: '6.26.0'});
  assert.equal(
    tileflowNativeBuildRecordSchema.safeParse({...record, available: true}).success,
    false,
  );
  assert.equal(
    tileflowNativeBuildRecordSchema.safeParse({...record, profile: 'native-v2'}).success,
    false,
  );
});

test('rejects unknown renderer/profile values without echoing them', () => {
  assert.throws(
    () => resolveTileflowRenderer('tf_live_do_not_log'),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.equal(error.issues[0]?.code, 'NATIVE_RENDERER_UNSUPPORTED');
      assert.equal(error.issues[0]?.path, '/renderer');
      assert.doesNotMatch(JSON.stringify(error), /do_not_log/);
      return true;
    },
  );
  const result = validateTileflowNativeStyle(background(), {profile: 'native-v2' as 'native-v1'});
  assert.equal(result[0]?.code, 'NATIVE_RENDERER_UNSUPPORTED');
  assert.equal(result[0]?.path, '/profile');
});

test('accepts basic styles and absolute glyph/tile templates without a guessed application URL', () => {
  assert.deepEqual(validateTileflowNativeStyle(background()), []);
  assert.deepEqual(validateTileflowNativeStyle(labels()), []);
  assert.doesNotThrow(() => assertTileflowNativeStyle(labels(), {documentUrl}));
});

test('accepts fixed Mercator, hillshade and building extrusion independently of terrain displacement', () => {
  assert.deepEqual(
    validateTileflowNativeStyle({...background(), projection: {type: 'mercator'}}),
    [],
  );
  const style = {
    ...background(),
    sources: {
      elevation: {
        type: 'raster-dem',
        tiles: ['https://maps.example.test/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
      },
      buildings: {type: 'vector', tiles: ['https://maps.example.test/{z}/{x}/{y}.pbf']},
    },
    layers: [
      {id: 'shade', type: 'hillshade', source: 'elevation'},
      {
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        paint: {'fill-extrusion-height': 10},
      },
    ],
  };
  assert.deepEqual(validateTileflowNativeStyle(style), []);
});

for (const root of ['terrain', 'sky', 'state', 'roll', 'centerAltitude']) {
  test(`rejects unsupported native root ${root}`, () => {
    hasIssue({...background(), [root]: {}}, 'NATIVE_UNSUPPORTED_STYLE', `/${root}`);
  });
}

test('rejects globe and retains the existing style-spec pitch range', () => {
  hasIssue(
    {...background(), projection: {type: 'globe'}},
    'NATIVE_UNSUPPORTED_STYLE',
    '/projection',
  );
  assert.deepEqual(validateTileflowNativeStyle({...background(), pitch: 70}), []);
  hasIssue({...background(), pitch: 86}, 'NATIVE_UNSUPPORTED_STYLE', '/pitch');
});

test('checks nested expression support without interpreting literal data or match labels', () => {
  const style = labels();
  style.layers[0]!.layout['text-field'] = ['coalesce', ['global-state', 'name'], 'fallback'];
  hasIssue(style, 'NATIVE_UNSUPPORTED_STYLE', '/layers/0/layout/text-field/1/0');
  style.layers[0]!.layout['text-field'] = [
    'match',
    ['get', 'kind'],
    ['global-state', 'water'],
    'name',
    'fallback',
  ];
  assert.deepEqual(validateTileflowNativeStyle(style), []);
  style.layers[0]!.layout['text-font'] = ['literal', ['global-state']];
  assert.deepEqual(validateTileflowNativeStyle(style), []);
});

for (const url of [
  'tileflow-pmtiles://https://maps.example.test/a.pmtiles',
  'pmtiles://https://maps.example.test/a.pmtiles',
  'tileflow-contour://https://maps.example.test/{z}/{x}/{y}',
  'file:///private/data',
  'https://user:tf_live_do_not_log@maps.example.test/tiles.json',
  'http://maps.example.test/tiles.json',
]) {
  test(`rejects a non-portable source URL (${url.split(':')[0]})`, () => {
    const value = {...background(), sources: {world: {type: 'vector', url}}};
    const issues = validateTileflowNativeStyle(value, {documentUrl});
    assert.ok(
      issues.some(
        ({code, path}) => code === 'NATIVE_UNSUPPORTED_SOURCE' && path === '/sources/world/url',
      ),
    );
    assert.doesNotMatch(JSON.stringify(issues), /do_not_log|\/private\/data/);
  });
}

test('requires a declaring URL for relative resources and validates it even for absolute children', () => {
  const value = {...background(), sprite: '../../icons/map/sprite'};
  assert.equal(validateTileflowNativeStyle(value)[0]?.code, 'NATIVE_MANIFEST_REQUIRED');
  assert.deepEqual(validateTileflowNativeStyle(value, {documentUrl}), []);
  assert.ok(validateTileflowNativeStyle(labels(), {documentUrl: '/manifest.json'}).length > 0);
});

test('rejects browser sources, unsupported properties and multiple sprite providers', () => {
  hasIssue(
    {...background(), sources: {video: {type: 'video', urls: []}}},
    'NATIVE_UNSUPPORTED_SOURCE',
    '/sources/video',
  );
  hasIssue(
    {...background(), sprite: [{id: 'one', url: 'https://example.test/sprite'}]},
    'NATIVE_UNSUPPORTED_STYLE',
    '/sprite',
  );
  hasIssue(
    {
      ...background(),
      sources: {
        elevation: {
          type: 'raster-dem',
          tiles: ['https://maps.example.test/{z}/{x}/{y}.png'],
          encoding: 'custom',
        },
      },
    },
    'NATIVE_UNSUPPORTED_SOURCE',
    '/sources/elevation/encoding',
  );
});

test('requires a complete native font provider instead of browser metadata or a system fallback', () => {
  const {glyphs: _glyphs, ...style} = labels();
  hasIssue(style, 'NATIVE_FONT_UNAVAILABLE', '/layers/0/layout/text-font');
  hasIssue(
    {...style, metadata: {'tileflow:fontFaces': []}},
    'NATIVE_FONT_UNAVAILABLE',
    '/metadata/tileflow:fontFaces',
  );
  assert.deepEqual(
    validateTileflowNativeStyle({
      ...style,
      'font-faces': {'Noto Sans Regular': 'https://maps.example.test/font.ttf'},
    }),
    [],
  );
  hasIssue(
    {...style, 'font-faces': {'Noto Sans Regular': 'https://maps.example.test/font.woff2'}},
    'NATIVE_FONT_UNAVAILABLE',
    '/font-faces/Noto Sans Regular',
  );
  hasIssue(
    {...labels(), glyphs: 'https://maps.example.test/{range}.pbf'},
    'NATIVE_FONT_UNAVAILABLE',
    '/glyphs',
  );
});

test('bounds JSON traversal, resource counts, input bytes and diagnostic output', () => {
  const cyclic = background() as Record<string, unknown>;
  cyclic.metadata = cyclic;
  hasIssue(cyclic, 'NATIVE_UNSUPPORTED_STYLE', '');
  hasIssue(
    {
      ...background(),
      metadata: {large: 'x'.repeat(tileflowNativeProfileLimits.maximumStyleBytes + 1)},
    },
    'NATIVE_UNSUPPORTED_STYLE',
    '',
  );
  const sources = Object.fromEntries(
    Array.from({length: 129}, (_, i) => [`source-${i}`, {type: 'canvas'}]),
  );
  const issues = validateTileflowNativeStyle({...background(), sources});
  assert.ok(issues.length <= 32);
  assert.ok(issues.some(({path}) => path === '/sources'));
});

test('does not invoke accessors or mutate inputs while validating', () => {
  let invoked = false;
  const style = background();
  Object.defineProperty(style, 'metadata', {
    enumerable: true,
    get: () => {
      invoked = true;
      return {};
    },
  });
  assert.ok(validateTileflowNativeStyle(style).length > 0);
  assert.equal(invoked, false);
  const valid = labels();
  const before = JSON.stringify(valid);
  validateTileflowNativeStyle(valid);
  assert.equal(JSON.stringify(valid), before);
});

test('uses stable escaped JSON Pointers and deterministic ordering for equivalent objects', () => {
  const source = {type: 'canvas'};
  const left = {...background(), sources: {b: source, 'a/~': source}};
  const right = {...background(), sources: {'a/~': source, b: source}};
  assert.deepEqual(validateTileflowNativeStyle(left), validateTileflowNativeStyle(right));
  assert.ok(validateTileflowNativeStyle(left).some(({path}) => path === '/sources/a~1~0'));
});

test('checks inline format font overrides and accepts explicit literal static stacks', () => {
  const {glyphs: _glyphs, ...base} = labels();
  const style = {
    ...base,
    'font-faces': {'Noto Sans Regular': 'https://maps.example.test/font.ttf'},
  };
  style.layers[0]!.layout['text-font'] = ['literal', ['Noto Sans Regular']];
  assert.deepEqual(validateTileflowNativeStyle(style), []);
  style.layers[0]!.layout['text-field'] = [
    'format',
    ['get', 'name'],
    {'text-font': ['literal', ['Missing Face']]},
  ];
  hasIssue(style, 'NATIVE_FONT_UNAVAILABLE', '/layers/0/layout/text-field/2/text-font');
});

test('semantic parser failures retain actual dotted source keys and deterministic order', () => {
  const source = {
    type: 'vector',
    minzoom: 'invalid',
    tiles: ['https://maps.example.test/{z}/{x}/{y}.pbf'],
  };
  const first = {...background(), sources: {'a.b': source}};
  const issues = validateTileflowNativeStyle(first);
  assert.ok(
    issues.some(({path}) => path === '/sources/a.b/minzoom'),
    JSON.stringify(issues),
  );
  const second = {
    ...background(),
    sources: {'a.b': {tiles: source.tiles, minzoom: 'invalid', type: 'vector'}},
  };
  assert.deepEqual(issues, validateTileflowNativeStyle(second));
});

test('invalid runtime options cannot bypass closure or invoke an accessor', () => {
  let calls = 0;
  const options = Object.defineProperty({}, 'profile', {
    get() {
      calls++;
      throw new Error('private');
    },
  });
  assert.equal(
    validateTileflowNativeStyle(background(), options)[0]?.code,
    'NATIVE_RENDERER_UNSUPPORTED',
  );
  assert.equal(calls, 0);
  assert.equal(
    validateTileflowNativeStyle(background(), {deferFontClosure: 'true' as unknown as boolean})[0]
      ?.code,
    'NATIVE_RENDERER_UNSUPPORTED',
  );
});
