import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManifest,
  createStyleFromProject,
  defineTileflow,
  normalizeTileflowCaptureScene,
  parseTileflowProject,
  streets,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneSchemaVersion,
  validateConfig,
} from '../src/index';

const project = defineTileflow({
  maps: {
    madrid: {
      basemap: streets(),
      theme: {colors: {water: '#8ED6E8'}},
    },
  },
  scenes: {
    desktop: {
      map: 'madrid',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1_200, height: 800, dpr: 2},
    },
    application: {
      map: 'madrid',
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

test('validates, parses, and normalizes portable capture scenes', () => {
  assert.equal(tileflowCaptureSceneSchemaVersion, 1);
  assert.equal(tileflowCaptureSceneLimits.maximumPhysicalPixels, 16_777_216);
  assert.deepEqual(validateConfig(project), {valid: true, messages: []});

  const parsed = parseTileflowProject(project);
  assert.equal(parsed.scenes?.desktop?.map, 'madrid');
  assert.deepEqual(normalizeTileflowCaptureScene(parsed.scenes!.desktop!), {
    map: 'madrid',
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
  assert.deepEqual(normalizeTileflowCaptureScene(parsed.scenes!.application!), {
    map: 'madrid',
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

test('keeps scenes out of manifest and style identity', () => {
  const withoutScenes = defineTileflow({maps: project.maps});

  assert.deepEqual(createManifest(project), createManifest(withoutScenes));
  assert.deepEqual(
    createStyleFromProject(project, 'madrid'),
    createStyleFromProject(withoutScenes, 'madrid'),
  );
  assert.deepEqual(validateConfig(withoutScenes), {valid: true, messages: []});
});

test('rejects invalid scene references, dimensions, cameras, targets, and unknown fields', () => {
  const cases: Array<{input: unknown; path: string}> = [
    {
      input: sceneProject({map: 'missing'}),
      path: 'scenes.proof.map',
    },
    {
      input: sceneProject({viewport: {width: 4_096, height: 4_096, dpr: 2}}),
      path: 'scenes.proof.viewport.dpr',
    },
    {
      input: sceneProject({camera: {type: 'center', center: [0, 91], zoom: 1}}),
      path: 'scenes.proof.camera.center.1',
    },
    {
      input: sceneProject({
        camera: {type: 'bounds', bounds: [0, 10, 20, 5], padding: 0},
      }),
      path: 'scenes.proof.camera.bounds',
    },
    {
      input: sceneProject({
        target: {kind: 'application', path: 'https://example.com/maps'},
      }),
      path: 'scenes.proof.target.path',
    },
    {
      input: sceneProject({
        target: {
          kind: 'application',
          path: '/maps',
          captureId: 'map',
          selector: '#map',
        },
      }),
      path: 'scenes.proof.target.selector',
    },
    {
      input: sceneProject({unknown: true}),
      path: 'scenes.proof.unknown',
    },
  ];

  for (const inputCase of cases) {
    const validation = validateConfig(inputCase.input);
    assert.equal(validation.valid, false, inputCase.path);
    assert.equal(validation.messages[0]?.path, inputCase.path);
  }
});

test('does not resolve missing scene maps through Object.prototype', () => {
  for (const map of ['constructor', 'toString']) {
    const validation = validateConfig(sceneProject({map}));

    assert.equal(validation.valid, false, map);
    assert.equal(validation.messages[0]?.path, 'scenes.proof.map');
  }

  assert.throws(
    () => createStyleFromProject({maps: {madrid: {basemap: streets()}}}, 'constructor' as never),
    /Unknown Tileflow map: constructor/,
  );

  const inheritedIconSet = validateConfig({
    maps: {madrid: {basemap: streets(), icons: {extends: 'constructor'}}},
  });
  assert.equal(inheritedIconSet.valid, false);
  assert.equal(inheritedIconSet.messages[0]?.path, 'maps.madrid.icons.extends');

  assert.equal(
    validateConfig({
      maps: {constructor: {basemap: streets()}},
      scenes: {proof: sceneProject({map: 'constructor'}).scenes.proof},
    }).valid,
    true,
  );
});

test('rejects prototype-mutating record keys instead of silently dropping them', () => {
  const input = JSON.parse(`{
    "maps": {"madrid": {"basemap": {"type": "streets", "basemapVersion": 1, "variant": "light"}}},
    "scenes": {
      "__proto__": {
        "map": "madrid",
        "camera": {"type": "center", "center": [0, 0], "zoom": 1},
        "viewport": {"width": 320, "height": 200}
      }
    }
  }`);
  const validation = validateConfig(input);

  assert.equal(validation.valid, false);
  assert.equal(validation.messages[0]?.path, 'scenes.__proto__');

  const inheritedProject = Object.create({maps: {madrid: {basemap: streets()}}});
  const inheritedValidation = validateConfig(inheritedProject);
  assert.equal(inheritedValidation.valid, false);
  assert.throws(() => parseTileflowProject(inheritedProject), /inherited properties/);
});

test('rejects scene names that cannot map portably to managed artifact files', () => {
  const duplicateByCase = validateConfig({
    maps: {madrid: {basemap: streets()}},
    scenes: {
      proof: sceneProject({}).scenes.proof,
      PROOF: sceneProject({}).scenes.proof,
    },
  });
  assert.equal(duplicateByCase.valid, false);
  assert.match(duplicateByCase.messages[0]?.path ?? '', /^scenes\./);

  for (const name of ['CON', 'x'.repeat(65)]) {
    const validation = validateConfig({
      maps: {madrid: {basemap: streets()}},
      scenes: {[name]: sceneProject({}).scenes.proof},
    });
    assert.equal(validation.valid, false, name);
    assert.equal(validation.messages[0]?.path, `scenes.${name}`);
  }
});

function sceneProject(overrides: Record<string, unknown>) {
  return {
    maps: {madrid: {basemap: streets()}},
    scenes: {
      proof: {
        map: 'madrid',
        camera: {type: 'center', center: [0, 0], zoom: 1},
        viewport: {width: 320, height: 200},
        ...overrides,
      },
    },
  };
}
