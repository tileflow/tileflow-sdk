import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineMap,
  normalizeTileflowCaptureScene,
  parseTileflowMap,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneSchemaVersion,
  validateTileflowMap,
} from '../src/index';
import {testLightTheme} from './map-fixture';

const captureRoot = defineMap({
  id: 'capture-root',
  version: 1,
  defaultTheme: 'light',
  glyphs: {
    kind: 'url',
    url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
  },
  themes: {light: testLightTheme},
});

const map = defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: captureRoot,
  scenes: {
    desktop: {
      theme: 'light',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1_200, height: 800, dpr: 2},
    },
    application: {
      theme: 'light',
      camera: {
        type: 'bounds',
        bounds: [-3.8, 40.3, -3.6, 40.5],
        bearing: 15,
        pitch: 30,
        padding: 24,
      },
      viewport: {width: 390, height: 844},
      target: {
        kind: 'application',
        path: '/maps/demo?theme=light',
        captureId: 'primary-map',
      },
    },
  },
});

test('singular maps own portable capture scenes without repeating their map id', () => {
  assert.equal(tileflowCaptureSceneSchemaVersion, 1);
  assert.equal(tileflowCaptureSceneLimits.maximumPhysicalPixels, 16_777_216);
  assert.deepEqual(validateTileflowMap(map), {valid: true, messages: []});

  const resolved = parseTileflowMap(map);
  assert.equal(resolved.id, 'madrid');
  assert.equal('scenes' in resolved, false);

  assert.deepEqual(normalizeTileflowCaptureScene({...map.scenes.desktop, map: map.id}), {
    map: 'madrid',
    theme: 'light',
    camera: {
      type: 'center',
      center: [-3.7038, 40.4168],
      zoom: 12,
      bearing: 0,
      pitch: 0,
    },
    viewport: {width: 1_200, height: 800, dpr: 2},
    target: {kind: 'map'},
  });
  assert.deepEqual(normalizeTileflowCaptureScene({...map.scenes.application, map: map.id}), {
    map: 'madrid',
    theme: 'light',
    camera: {
      type: 'bounds',
      bounds: [-3.8, 40.3, -3.6, 40.5],
      bearing: 15,
      pitch: 30,
      padding: 24,
    },
    viewport: {width: 390, height: 844, dpr: 1},
    target: {
      kind: 'application',
      path: '/maps/demo?theme=light',
      captureId: 'primary-map',
      frame: 'map',
    },
  });
});

test('scene metadata is leaf-only and never inherited into a derived map', () => {
  const child = defineMap({id: 'child', version: 1, extends: map});
  assert.equal(parseTileflowMap(child).id, 'child');
  assert.equal('scenes' in parseTileflowMap(child), false);
});

test('rejects invalid scene geometry, targets, names, and cross-map references', () => {
  const cases: unknown[] = [
    {
      ...map,
      scenes: {
        proof: {
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'system',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'light',
          camera: {type: 'center', center: [0, 91], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'light',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 4_096, height: 4_096, dpr: 2},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'light',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
          target: {kind: 'application', path: 'https://example.com'},
        },
      },
    },
    {
      ...map,
      scenes: {
        CON: {
          theme: 'light',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'light',
          map: 'madrid',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
    {
      ...map,
      scenes: {
        proof: {
          theme: 'light',
          map: 'another-map',
          camera: {type: 'center', center: [0, 0], zoom: 1},
          viewport: {width: 320, height: 200},
        },
      },
    },
  ];

  for (const input of cases) {
    assert.equal(validateTileflowMap(input).valid, false);
    assert.throws(() => parseTileflowMap(input as never), /scenes/);
  }
});

test('rejects non-canonical scene ids and non-plain scene records', () => {
  const scene = {
    theme: 'light',
    camera: {type: 'center' as const, center: [0, 0] as [number, number], zoom: 1},
    viewport: {width: 320, height: 200},
  };
  assert.throws(
    () => parseTileflowMap({...map, scenes: {proof: scene, ' proof ': scene}}),
    /lowercase kebab-case/,
  );
  assert.throws(
    () => parseTileflowMap({...map, scenes: Object.create({proof: scene})}),
    /plain object/,
  );
});
