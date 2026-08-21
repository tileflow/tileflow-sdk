import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowDevRequestHandler,
  resolveTileflowPreview,
  type TileflowArtifactSession,
  type TileflowArtifactSessionState,
} from '../src/index';
import {createTileflowArtifactSessionWithBuilder} from '../src/session';

test('refreshes transitive JSON imports and preserves last-good artifacts across invalid edits', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#112233');

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#445566"}\n', 'utf8');
  await session.refresh('test token edit');
  assert.equal(session.getState().generation, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  await session.refresh('test invalid edit');
  const invalid = session.getState();
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.generation, 3);
  assert.equal(invalid.lastGoodGeneration, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');
  assert.deepEqual(
    invalid.status === 'invalid'
      ? invalid.diagnostics.map((diagnostic) => Object.keys(diagnostic))
      : [],
    [['code', 'message', 'path', 'phase']],
  );
  if (invalid.status === 'invalid') {
    assert.equal(invalid.diagnostics[0]?.code, 'CONFIG_INVALID');
    assert.equal(invalid.diagnostics[0]?.phase, 'config-validation');
  }

  const handler = createTileflowDevRequestHandler({session});
  const status = await handler(new Request('http://localhost/__status'));
  assert.deepEqual(await status.json(), {
    schemaVersion: 1,
    generation: 3,
    status: 'invalid',
    lastGoodGeneration: 2,
    diagnostics: invalid.status === 'invalid' ? invalid.diagnostics : [],
  });
  const lastGoodStyle = await handler(new Request('http://localhost/styles/main.json'));
  assert.equal(lastGoodStyle.status, 200);
  assert.equal(waterColorFromStyle(await lastGoodStyle.json()), '#445566');
  const compactStyle = await (
    await handler(new Request('http://localhost/styles/main.json'))
  ).text();
  assert.equal(compactStyle, `${JSON.stringify(JSON.parse(compactStyle))}\n`);

  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  await session.refresh('test recovery');
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().generation, 4);
});

test('watches conservative transitive inputs and emits monotonic building/ready states', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#102030"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const states: TileflowArtifactSessionState[] = [];
  session.subscribe((state) => states.push(state));

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#abcdef"}\n', 'utf8');
  const ready = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation >= 2,
  );
  assert.equal(ready.status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#abcdef');
  assert.deepEqual(
    states.slice(-2).map((state) => state.status),
    ['building', 'ready'],
  );
  assert.ok(
    states.every(
      (state, index) => index === 0 || state.generation >= states[index - 1]!.generation,
    ),
  );
});

test('publishes only the newest overlapping refresh generation', async () => {
  let build = 0;
  const session = await createTileflowArtifactSessionWithBuilder({}, async () => {
    build += 1;
    const current = build;
    if (current === 2) await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    if (current === 3) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    return {
      assets: [],
      manifest: {version: 1, maps: {}, styles: {}},
      project: {maps: {[`generation-${current}`]: {}}},
      styles: {},
      watchPaths: [],
    };
  });

  try {
    await Promise.all([session.refresh('slow'), session.refresh('newest')]);
    const state = session.getState();
    assert.equal(state.status, 'ready');
    assert.equal(state.generation, 3);
    assert.deepEqual(Object.keys(session.getLastGoodArtifacts()?.project.maps ?? {}), [
      'generation-3',
    ]);
  } finally {
    await session.close();
  }
});

test('redacts external absolute paths from watched-build diagnostic messages', async (t) => {
  const cwd = await createFixture(t);
  const external = join(cwd, '..', 'private-fixture', 'secret.json');
  const diagnostics = createTileflowArtifactDiagnostics(
    new Error(`Unable to read ${external}`),
    cwd,
  );

  assert.equal(JSON.stringify(diagnostics).includes(external), false);
  assert.match(diagnostics[0]?.message ?? '', /external path/);

  const windowsDiagnostics = createTileflowArtifactDiagnostics(
    {issues: [{message: 'Unable to read input', path: 'C:\\Users\\alice\\secret.json'}]},
    cwd,
  );
  assert.equal(windowsDiagnostics[0]?.path, '(external)');
});

test('preserves bounded code/phase diagnostics with deterministic URL-safe ordering', async (t) => {
  const cwd = await createFixture(t);
  const issues = Array.from({length: 40}, (_, index) => ({
    message:
      `https://user:secret@example.test/private/${index}?token=hidden ` +
      `Bearer bearer-secret tf_live_${'a'.repeat(32)} sk_live_private ${'x'.repeat(350)}`,
    path: `maps.zeta.layers.${String(39 - index).padStart(2, '0')}`,
  }));
  const diagnostics = createTileflowArtifactDiagnostics(
    Object.assign(new Error('invalid'), {
      code: 'STYLE_INVALID',
      issues,
      phase: 'style-validation',
    }),
    cwd,
  );

  assert.equal(diagnostics.length, 32);
  assert.equal(diagnostics[0]?.path, 'maps.zeta.layers.00');
  assert.equal(diagnostics.at(-1)?.path, 'maps.zeta.layers.31');
  assert.equal(
    diagnostics.every((item) => item.code === 'STYLE_INVALID'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.phase === 'style-validation'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.message.length <= 300),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /user:secret|token=hidden|private\/|bearer-secret|tf_live_|sk_live_private/,
  );
  assert.match(diagnostics[0]?.message ?? '', /https:\/\/example\.test/);
});

test('serves pinned local preview assets and a cancellable session event stream', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const handler = createTileflowDevRequestHandler({session});

  const preview = await (await handler(new Request('http://localhost/'))).text();
  assert.doesNotMatch(preview, /unpkg|fonts\.googleapis|fonts\.gstatic/);
  assert.match(preview, /__runtime\/maplibre-gl\.js/);
  assert.match(preview, /__runtime\/three\.module\.js/);
  assert.match(preview, /three-addons\/loaders\/GLTFLoader\.js/);
  assert.match(preview, /three-addons\/libs\/meshopt_decoder\.module\.js/);
  assert.doesNotMatch(preview, /^\s*import \* as THREE/m);
  assert.match(preview, /function loadThreeCoreRuntime\(\)/);
  assert.match(preview, /function loadLandmarkRuntime\(\)/);
  assert.match(preview, /import\("\/__runtime\/three\.module\.js"\)/);
  assert.match(preview, /const landmarkConfigLayer = currentStyleLayers\.find/);
  assert.match(preview, /landmarkConfigLayer &&[\s\S]*?threeDimensionalEnabled/);
  assert.match(preview, /needsLandmarks[\s\S]*?loadLandmarkRuntime\(\)/);
  assert.match(preview, /if \(shouldAddLandmarks\) \{[\s\S]*?await loadLandmarkRuntime\(\)/);
  assert.match(preview, /tileflow-vegetation-trees-3d/);
  assert.match(
    preview,
    /const styleLayerIndex = styleLayers\.findIndex\(\(layer\) => layer\.id === styleLayer\.id\);[\s\S]*?map\.addLayer\(createTreeLayer\(map, styleLayer\), layerAboveTrees\)/,
  );
  assert.match(preview, /map\.queryRenderedFeatures\(/);
  assert.match(preview, /\{layers: \[styleLayer\.id\]\}/);
  assert.doesNotMatch(preview, /querySourceFeatures\(sourceId, \{sourceLayer\}\)/);
  assert.match(preview, /const maximumTrees = 3000/);
  assert.equal(preview.match(/queryTerrainElevation/g)?.length, 3);
  assert.match(
    preview,
    /const viewportElevation = map\.queryTerrainElevation\(map\.getCenter\(\)\) \?\? 0/,
  );
  assert.match(preview, /function createTerrainSampler\(trees, fallbackElevation\)/);
  assert.match(preview, /const gridSize = 5/);
  assert.match(preview, /terrainElevationAt\(lng, lat\)/);
  assert.match(preview, /function createBroadleafTreeGeometry\(variant, simple\)/);
  assert.match(preview, /function addTaperedBranchPart\(/);
  assert.match(preview, /geometry\.index \? geometry\.toNonIndexed\(\) : geometry/);
  assert.match(preview, /facetedGeometry\.computeVertexNormals\(\)/);
  assert.match(
    preview,
    /addTaperedBranchPart\(\s*parts,\s*\[0, 0, 0\],\s*trunkTop,\s*0\.09 \+ variant \* 0\.004,\s*0\.052 \+ variant \* 0\.002,\s*6\s*\)/,
  );
  assert.match(preview, /const branchCount = branchTargets\.length/);
  assert.match(preview, /for \(let branch = 0; branch < branchCount; branch \+= 1\)/);
  const openCrownLayout =
    /const openCrownLayout = \[([\s\S]*?)\];\s*const clusteredCrownLayout/.exec(preview)?.[1];
  const clusteredCrownLayout =
    /const clusteredCrownLayout = \[([\s\S]*?)\];\s*const crownLayout/.exec(preview)?.[1];
  assert.equal(openCrownLayout?.match(/\{position:/g)?.length, 10);
  assert.equal(clusteredCrownLayout?.match(/\{position:/g)?.length, 6);
  assert.match(
    preview,
    /const lobeCount = simple \? \(variant === 0 \? 9 : 5\) : crownLayout\.length/,
  );
  assert.match(preview, /new THREE\.SphereGeometry\(0\.5, 8, 3\)/);
  assert.match(preview, /new THREE\.IcosahedronGeometry\(0\.5, simple \? 0 : 1\)/);
  assert.match(preview, /function createConiferTreeGeometry\(variant, simple\)/);
  assert.match(preview, /const tierCount = simple \? 2 : 3/);
  assert.match(preview, /new THREE\.ConeGeometry\(0\.5, 1, simple \? 6 : 9\)/);
  assert.match(preview, /function mergeGeometryParts\(parts\)/);
  assert.match(preview, /new THREE\.MeshLambertMaterial\(\{/);
  assert.match(preview, /vertexColors: true/);
  assert.doesNotMatch(preview, /new THREE\.CircleGeometry/);
  assert.doesNotMatch(preview, /branches = new THREE\.InstancedMesh/);
  assert.doesNotMatch(preview, /shadows = new THREE\.InstancedMesh/);
  assert.match(preview, /const barkColor = new THREE\.Color\(0x929b7b\)/);
  assert.match(
    preview,
    /new THREE\.Color\(0x7fa97b\)[\s\S]*?new THREE\.Color\(0x8bb08c\)[\s\S]*?new THREE\.Color\(0xa9c995\)[\s\S]*?new THREE\.Color\(0xb0d1aa\)/,
  );
  assert.match(preview, /\? \[3, 2, 1, 0, 2, 0, 1, 1, 2, 3\]\s*: \[1, 2, 0, 1, 3, 2\]/);
  assert.match(preview, /height \* \(0\.62 \+ stableUnit\(key, 2\) \* 0\.18\)/);
  assert.match(preview, /function stableTreeKey\(feature, lng, lat\)/);
  assert.match(preview, /Math\.imul\(hash, 16777619\)/);
  assert.match(preview, /combinedMatrix\.copy\(mapMatrix\)\.multiply\(sceneMatrix\)/);
  assert.match(preview, /camera\.projectionMatrix\.copy\(combinedMatrix\)/);
  assert.match(preview, /scene\.rotateX\(Math\.PI \/ 2\)/);
  assert.match(preview, /scene\.scale\.multiply\(new THREE\.Vector3\(1, 1, -1\)\)/);
  assert.match(preview, /function localTreePosition\(lng, lat, elevation\)/);
  assert.match(preview, /elevation - sceneElevation/);
  assert.match(preview, /new THREE\.Vector3\(meter, -meter, meter\)/);
  assert.match(preview, /const maximumCachedTrees = 12000/);
  assert.match(preview, /const sourceRefreshIntervalMilliseconds = 120/);
  assert.match(preview, /const treeLods = \[/);
  assert.match(preview, /densityCellPixels: 12/);
  assert.match(preview, /densityCellPixels: 8/);
  assert.match(preview, /function selectVisibleTrees\(features, lod\)/);
  assert.match(preview, /const worldSize = 512 \* Math\.pow\(2, map\.getZoom\(\)\)/);
  assert.match(preview, /Math\.floor\(candidate\.worldX \/ lod\.densityCellPixels\)/);
  assert.doesNotMatch(preview, /map\.project\(\[lng, lat\]\)/);
  assert.match(preview, /function treeSelectionSignature\(trees, lodName\)/);
  assert.doesNotMatch(preview, /options\.modelViewProjectionMatrix/);
  assert.match(preview, /treeMesh\.frustumCulled = false/);
  assert.match(preview, /tileflow:tree-species-field/);
  assert.doesNotMatch(preview, /function queueRefreshWhenIdle\(\)/);
  assert.match(preview, /emptyRefreshAttempts < 12/);
  assert.match(preview, /setTimeout\(queueRefresh, 150\)/);
  assert.match(preview, /function setFallbackVisible\(visible\)/);
  assert.match(preview, /function updateFallbackVisibility\(\)/);
  assert.match(preview, /setFallbackVisible\(!sourceSettled \|\| renderedTreeCount === 0\)/);
  assert.match(
    preview,
    /if \(sourceSettled && selectionSignature === lastTreeSelectionSignature\)/,
  );
  assert.match(
    preview,
    /if \(!sourceSettled\) \{[\s\S]*?setTimeout\(\(\) => queueRefresh\(true\), 150\)/,
  );
  assert.match(preview, /queueRefresh\(\);/);
  assert.match(preview, /function queueRefresh\(immediate = false\)/);
  assert.match(preview, /if \(map\.isMoving\(\)\) return/);
  assert.match(preview, /map\.on\("movestart", handleMoveStart\)/);
  assert.match(
    preview,
    /activeTreeBackend === "three" \? !treeGroup\?\.visible : !rawTreesVisible/,
  );
  assert.doesNotMatch(preview, /map\.on\("move", handleMove\)/);
  assert.match(preview, /map\.on\("sourcedataloading", handleSourceLoading\)/);
  assert.match(preview, /map\.on\("sourcedata", handleSourceData\)/);
  assert.match(preview, /if \(!treesEnabled \|\| event\.sourceId !== sourceId\) return/);
  assert.match(preview, /map\.setProjection\(\{type: "mercator"\}\)/);
  assert.match(preview, /const projection = map\.getProjection\(\)\.type/);
  assert.doesNotMatch(preview, /const projection = map\.getStyle/);
  assert.match(preview, /class ThreeDimensionalControl/);
  assert.match(preview, /class TreeControl/);
  assert.match(preview, /this\.enabled = !this\.enabled/);
  assert.match(preview, /this\.enabled \? "3D ON" : "3D OFF"/);
  assert.match(preview, /this\.enabled \? "TREES ON" : "TREES OFF"/);
  assert.match(preview, /readToggleFromUrl\("buildings3d", false\)/);
  assert.match(preview, /readToggleFromUrl\("trees3d", true\)/);
  assert.match(preview, /map\.fire\("tileflow:trees-toggle"/);
  assert.match(preview, /map\.addControl\(new TreeControl\(\), "top-right"\)/);
  assert.doesNotMatch(preview, /this\.map\.easeTo/);
  assert.doesNotMatch(preview, /map\.on\("pitch", this\.update\)/);
  assert.match(preview, /toggle !== "building" && toggle !== "landmark"/);
  assert.match(preview, /setLayoutProperty\(layer\.id, "visibility", visibility\)/);
  assert.match(preview, /const isStreetsPreview = true/);
  assert.match(preview, /__events/);
  assert.match(preview, /new URL\(location\.href\)\.searchParams/);
  assert.match(preview, /delete resolved\.bounds/);
  assert.match(preview, /history\.replaceState\(history\.state, "", url\.href\)/);
  assert.match(preview, /map\.on\("moveend", \(\) => writeCameraToUrl\(map\)\)/);
  assert.match(preview, /map\.on\("styledata", ensureThreeDimensionalLayers\)/);
  assert.match(preview, /map\.on\("zoomend", ensureThreeDimensionalLayers\)/);
  assert.match(preview, /const treeRuntimeMinimumZoom = 16/);
  assert.doesNotMatch(preview, /landmarkRuntimeMinimumZoom/);
  assert.match(preview, /function styleLayerZoomRange\(layer\)/);
  assert.match(preview, /return zoom >= minzoom && zoom < maxzoom/);
  assert.match(
    preview,
    /const landmarkConfigLayer = currentStyleLayers\.find[\s\S]*?styleLayerIsVisibleAtZoom\(landmarkConfigLayer, map\.getZoom\(\)\)/,
  );
  assert.equal(
    preview.match(/styleLayerIsVisibleAtZoom\(landmarkConfigLayer, map\.getZoom\(\)\)/g)?.length,
    2,
  );
  assert.match(preview, /function createLandmarkLayer\(map, configLayer\)/);
  assert.match(preview, /minzoom: landmarkMinimumZoom/);
  assert.match(preview, /\? \{maxzoom: landmarkMaximumZoom\}/);
  assert.match(preview, /!styleLayerIsVisibleAtZoom\(configLayer, map\.getZoom\(\)\)/);
  assert.match(
    preview,
    /function addLandmarkLayerIfConfigured\(map, styleLayers\)[\s\S]*?if \(map\.getProjection\(\)\.type !== "mercator"\) \{[\s\S]*?map\.setProjection\(\{type: "mercator"\}\);[\s\S]*?map\.addLayer\(createLandmarkLayer/,
  );
  assert.match(
    preview,
    /const treeLayer = map\.getLayer\("tileflow-vegetation-trees-3d"\)[\s\S]*?map\.getLayer\("streets-vegetation-trees"\)[\s\S]*?map\.addLayer\(createLandmarkLayer\(map, configLayer\), treeLayer\)/,
  );
  assert.match(preview, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(preview, /credentials: "include"/);
  assert.match(preview, /manifest\.maximumVisibleModels/);
  assert.match(preview, /manifest\.maximumCachedModels/);
  assert.match(preview, /right\.priority - left\.priority/);
  assert.match(preview, /function landmarkModelAtZoom\(landmark, zoom\)/);
  assert.match(preview, /function enforceCacheLimit\(\)/);
  assert.match(preview, /function harmonizeLandmarkModel\(model\)/);
  assert.match(preview, /new THREE\.MeshStandardMaterial\(\{/);
  assert.match(preview, /color: "#EEE4D4"/);
  assert.match(preview, /opacity: 1/);
  assert.match(preview, /transparent: false/);
  assert.match(preview, /side: THREE\.DoubleSide/);
  assert.match(preview, /tileflowDetachedMaterials/);
  assert.match(preview, /new THREE\.AmbientLight\(0xffffff, 2\.2\)/);
  assert.match(preview, /new THREE\.DirectionalLight\(0xffffff, 0\.45\)/);
  assert.match(preview, /value\?\.isTexture/);
  assert.doesNotMatch(preview, /material\.roughness = 0\.82/);
  assert.doesNotMatch(preview, /material\.metalness = Math\.min/);
  assert.doesNotMatch(preview, /material\.emissive\.setRGB/);
  assert.doesNotMatch(preview, /canvasContextAttributes: \{antialias: true\}/);
  assert.doesNotMatch(preview, /antialias: true/);
  assert.match(preview, /const treeRendererMode = \["circle", "simple", "complex"\]/);
  // Ordinary preview must match capture/framework rendering. The richer tree
  // runtime remains an explicit, preview-only diagnostic mode.
  assert.match(preview, /\? requestedTreeRenderer : "circle"/);
  assert.match(preview, /treeSearchParameters\.get\("treeBenchmark"\) === "1"/);
  assert.match(preview, /treeSearchParameters\.get\("mapBenchmark"\) === "1"/);
  assert.match(preview, /treeSearchParameters\.get\("mapSweep"\) === "1"/);
  assert.match(preview, /treeSearchParameters\.get\("mapCompare"\) === "1"/);
  assert.match(preview, /treeSearchParameters\.get\("mapWorkers"\)/);
  assert.match(preview, /mapWorkerCountOverride \?\?/);
  assert.match(preview, /mapBenchmarkCenter \? \{center: mapBenchmarkCenter\} : \{\}/);
  assert.match(
    preview,
    /globalThis\.__tileflowMapBenchmark = \{compareRemote, metrics, settleZoom\}/,
  );
  assert.match(preview, /collectResourceTiming: mapBenchmarkEnabled/);
  assert.match(preview, /function inspectRenderBuckets\(\)/);
  assert.match(preview, /resourceEncodedBytes/);
  assert.match(preview, /async function compareRemote\(options = \{\}\)/);
  assert.match(preview, /dataset\.tileflowMapCompareStatus = "complete"/);
  assert.match(preview, /dataset\.tileflowMapSweepStatus = "complete"/);
  assert.match(preview, /Array\.from\(\{length: 23\}, \(_, zoom\) => zoom\)/);
  assert.match(preview, /boundary - 0\.01, boundary, boundary \+ 0\.01/);
  assert.match(preview, /if \(result\.timedOut\)/);
  assert.match(preview, /if \(result\.errors\.length > 0\)/);
  assert.match(preview, /dataset\.tileflowMapSweepStatus = "failed"/);
  assert.match(preview, /installMapBenchmark\(map\)/);
  assert.match(preview, /treeSearchParameters\.get\("treeBackend"\) === "three"/);
  assert.match(preview, /globalThis\.__tileflowTreeMetrics = treeMetrics/);
  assert.doesNotMatch(preview, /tree-status/);
  assert.match(preview, /globalThis\.__tileflowTreeState = \{message, \.\.\.details\}/);
  assert.match(preview, /treeMetrics\.renderCalls = renderer\.info\.render\.calls/);
  assert.match(
    preview,
    /treeMetrics\.refreshMilliseconds = performance\.now\(\) - refreshStartedAt/,
  );
  assert.match(preview, /treeMetrics\.queryMilliseconds = performance\.now\(\) - queryStartedAt/);
  assert.match(
    preview,
    /treeMetrics\.selectionMilliseconds = performance\.now\(\) - selectionStartedAt/,
  );
  assert.match(preview, /treeMetrics\.buildMilliseconds = performance\.now\(\) - buildStartedAt/);
  assert.match(
    preview,
    /treeMetrics\.terrainMilliseconds = performance\.now\(\) - terrainStartedAt/,
  );
  assert.match(preview, /function createRawTreeProgram\(gl\)/);
  assert.match(preview, /vec3 linearToSrgb\(vec3 color\)/);
  assert.match(preview, /vec4\(linearToSrgb\(v_color\), 1\.0\)/);
  assert.match(preview, /rawGl\.drawElementsInstanced\(/);
  assert.match(preview, /geometry\.setIndex\(new THREE\.BufferAttribute\(indices, 1\)\)/);
  assert.match(
    preview,
    /rawGl\.uniformMatrix4fv\(rawMatrixUniform, false, combinedMatrix\.elements\)/,
  );
  assert.match(preview, /maplibregl\.setWorkerCount\?\.\(mapWorkerCount\)/);
  assert.match(preview, /const mapWorkerCount = mapWorkerCountOverride \?\? 1/);

  const [javascript, stylesheet, three, threeCore, gltfLoader, meshoptDecoder] = await Promise.all([
    handler(new Request('http://localhost/__runtime/maplibre-gl.js')),
    handler(new Request('http://localhost/__runtime/maplibre-gl.css')),
    handler(new Request('http://localhost/__runtime/three.module.js')),
    handler(new Request('http://localhost/__runtime/three.core.min.js')),
    handler(new Request('http://localhost/__runtime/three-addons/loaders/GLTFLoader.js')),
    handler(new Request('http://localhost/__runtime/three-addons/libs/meshopt_decoder.module.js')),
  ]);
  assert.match(javascript.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await javascript.text()).length > 1_000_000);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);
  assert.match(three.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await three.text()).length > 300_000);
  assert.match(threeCore.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await threeCore.text()).length > 100_000);
  assert.match(gltfLoader.headers.get('content-type') ?? '', /javascript/);
  assert.match(await gltfLoader.text(), /class GLTFLoader/);
  assert.match(meshoptDecoder.headers.get('content-type') ?? '', /javascript/);
  assert.match(await meshoptDecoder.text(), /MeshoptDecoder/);

  const events = await handler(new Request('http://localhost/__events'));
  const reader = events.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  await reader.cancel();
});

test('selects map and scene previews with their configured cameras and viewport', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tileflow.config.ts'), previewConfig, 'utf8');
  t.after(async () => rm(cwd, {force: true, recursive: true}));

  const project = {
    maps: {
      first: {},
      second: {view: {bearing: 12, center: [2, 3] as [number, number], pitch: 35, zoom: 9}},
    },
    scenes: {
      bounds: {
        map: 'second',
        camera: {
          type: 'bounds' as const,
          bounds: [1, 2, 3, 4] as [number, number, number, number],
          padding: 24,
        },
        viewport: {width: 800, height: 600},
      },
      mobile: {
        map: 'second',
        camera: {type: 'center' as const, center: [2.5, 3.5] as [number, number], zoom: 14},
        viewport: {width: 390, height: 844, dpr: 2 as const},
      },
      product: {
        map: 'second',
        camera: {type: 'center' as const, center: [2, 3] as [number, number], zoom: 9},
        viewport: {width: 800, height: 600},
        target: {kind: 'application' as const, path: '/maps'},
      },
    },
  };

  assert.deepEqual(resolveTileflowPreview(project, {map: 'second'}), {
    camera: {type: 'center', center: [2, 3], zoom: 9, bearing: 12, pitch: 35},
    label: 'second',
    mapName: 'second',
  });
  assert.deepEqual(resolveTileflowPreview(project, {scene: 'bounds'}), {
    camera: {
      type: 'bounds',
      bounds: [1, 2, 3, 4],
      padding: 24,
      bearing: 0,
      pitch: 0,
    },
    label: 'second / bounds · 800×600',
    mapName: 'second',
    viewport: {width: 800, height: 600, dpr: 1},
  });
  assert.throws(() => resolveTileflowPreview(project, {map: 'first', scene: 'mobile'}), /either/);
  assert.throws(() => resolveTileflowPreview(project, {map: 'missing'}), /Unknown Tileflow map/);
  assert.throws(
    () => resolveTileflowPreview(project, {scene: 'product'}),
    /targets an application/,
  );

  const mapResponse = await createTileflowDevRequestHandler({cwd, map: 'second'})(
    new Request('http://localhost/'),
  );
  const mapHtml = await mapResponse.text();
  assert.equal(mapResponse.status, 200);
  assert.match(mapHtml, /\/styles\/second\.json/);
  assert.match(mapHtml, /"center":\[2,3\]/);
  assert.doesNotMatch(mapHtml, /"maxPitch":/);
  assert.match(mapHtml, /"pitch":35/);
  assert.match(mapHtml, /"zoom":9/);
  assert.doesNotMatch(mapHtml, /-3\.7038/);
  assert.match(mapHtml, /cameraRanges/);
  assert.match(mapHtml, /getAll\(name\)/);

  const sceneResponse = await createTileflowDevRequestHandler({cwd, scene: 'mobile'})(
    new Request('http://localhost/'),
  );
  const sceneHtml = await sceneResponse.text();
  assert.equal(sceneResponse.status, 200);
  assert.match(sceneHtml, /width: 390px/);
  assert.match(sceneHtml, /height: 844px/);
  assert.match(sceneHtml, /second \/ mobile/);

  const boundsResponse = await createTileflowDevRequestHandler({cwd, scene: 'bounds'})(
    new Request('http://localhost/'),
  );
  const boundsHtml = await boundsResponse.text();
  assert.match(boundsHtml, /"bounds":\[\[1,2\],\[3,4\]\]/);

  const persisted = runPreviewScript(
    boundsHtml,
    'http://localhost/?keep=this&lng=-3.7038&lat=40.4168&zoom=15.25&bearing=12&pitch=0',
  );
  assert.equal(JSON.stringify(persisted.mapOptions?.center), '[-3.7038,40.4168]');
  assert.equal(persisted.mapOptions?.zoom, 15.25);
  assert.equal('maxPitch' in (persisted.mapOptions ?? {}), false);
  assert.equal(persisted.mapOptions?.pitch, 0);
  assert.equal('bounds' in (persisted.mapOptions ?? {}), false);
  assert.equal('fitBoundsOptions' in (persisted.mapOptions ?? {}), false);
  persisted.emit('styledata');
  persisted.emit('load');
  assert.equal(persisted.threeDimensionalLabel(), '3D OFF');
  assert.equal(persisted.treeLabel(), 'TREES ON');
  assert.equal(persisted.buildingVisibility(), 'none');
  assert.equal(persisted.treeVisibility(), 'visible');
  persisted.toggleThreeDimensional();
  assert.equal(persisted.pitch(), 0);
  assert.equal(persisted.threeDimensionalLabel(), '3D ON');
  assert.equal(persisted.buildingVisibility(), 'visible');
  persisted.toggleTrees();
  assert.equal(persisted.treeLabel(), 'TREES OFF');
  assert.equal(persisted.treeVisibility(), 'none');
  const persistedUrl = new URL(persisted.currentUrl());
  assert.equal(persistedUrl.searchParams.get('keep'), 'this');
  assert.equal(persistedUrl.searchParams.get('lng'), '-3.7038');
  assert.equal(persistedUrl.searchParams.get('lat'), '40.4168');
  assert.equal(persistedUrl.searchParams.get('zoom'), '15.25');
  assert.equal(persistedUrl.searchParams.get('bearing'), '12');
  assert.equal(persistedUrl.searchParams.get('pitch'), '0');
  assert.equal(persistedUrl.searchParams.get('buildings3d'), 'on');
  assert.equal(persistedUrl.searchParams.get('trees3d'), 'off');

  const restoredToggles = runPreviewScript(boundsHtml, persistedUrl.href);
  restoredToggles.emit('styledata');
  restoredToggles.emit('load');
  assert.equal(restoredToggles.threeDimensionalLabel(), '3D ON');
  assert.equal(restoredToggles.treeLabel(), 'TREES OFF');
  assert.equal(restoredToggles.buildingVisibility(), 'visible');
  assert.equal(restoredToggles.treeVisibility(), 'none');

  const invalidCamera = runPreviewScript(
    mapHtml,
    'http://localhost/?lng=-3.7038&lat=40.4168&zoom=99&bearing=0&pitch=0',
  );
  assert.equal(JSON.stringify(invalidCamera.mapOptions?.center), '[2,3]');
  assert.equal(invalidCamera.mapOptions?.zoom, 9);

  const missingResponse = await createTileflowDevRequestHandler({cwd, map: 'missing'})(
    new Request('http://localhost/'),
  );
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), {error: 'Unknown Tileflow map: missing'});
});

test('watches added, changed, removed, and newly effective local icon directories', async (t) => {
  const cwd = await createFixture(t);
  await mkdir(join(cwd, 'icons-a'));
  await mkdir(join(cwd, 'icons-b'));
  await writeFile(join(cwd, 'icons-a', 'base.svg'), svg('#111111'));
  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#222222'));
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#333333'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-a'));
  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  const initial = assetFingerprint(session);

  const initialGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#343434'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, initialGeneration);

  await writeFile(join(cwd, 'icons-a', 'added.svg'), svg('#444444'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 2);
  const added = assetFingerprint(session);
  assert.notEqual(added, initial);

  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#555555'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 3);
  const changed = assetFingerprint(session);
  assert.notEqual(changed, added);

  await unlink(join(cwd, 'icons-a', 'pin.svg'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 4);
  assert.notEqual(assetFingerprint(session), changed);

  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-b'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 5);
  const switched = assetFingerprint(session);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const switchedGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#777777'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > switchedGeneration,
  );
  assert.notEqual(assetFingerprint(session), switched);
});

test('adds and unwatches icon directories outside the config tree', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-dev-external-watch-'));
  const cwd = join(parent, 'project');
  const iconsA = join(parent, 'icons-a');
  const iconsB = join(parent, 'icons-b');
  await mkdir(cwd);
  await mkdir(iconsA);
  await mkdir(iconsB);
  await writeFile(join(iconsA, 'pin.svg'), svg('#111111'));
  await writeFile(join(iconsB, 'pin.svg'), svg('#222222'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('../icons-a'));

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(parent, {force: true, recursive: true});
  });

  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const initialGeneration = session.getState().generation;
  await writeFile(join(iconsA, 'pin.svg'), svg('#333333'));
  const changed = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > initialGeneration,
  );

  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('../icons-b'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > changed.generation,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const switchedGeneration = session.getState().generation;

  await writeFile(join(iconsA, 'pin.svg'), svg('#444444'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, switchedGeneration);

  await writeFile(join(iconsB, 'pin.svg'), svg('#555555'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > switchedGeneration,
  );
});

const tokenModule = `import tokens from './tokens.json';\nexport default tokens;\n`;
const validConfig = `import tokens from './tokens.ts';
export default {
  maps: {
    main: {
      basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
      theme: {colors: {water: tokens.water}}
    }
  }
};
`;
const invalidConfig = `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, unsupported: true}}};\n`;
const previewConfig = `export default {
  maps: {
    first: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}},
    second: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, view: {bearing: 12, center: [2, 3], pitch: 35, zoom: 9}}
  },
  scenes: {
    bounds: {
      map: 'second',
      camera: {type: 'bounds', bounds: [1, 2, 3, 4], padding: 24},
      viewport: {width: 800, height: 600}
    },
    mobile: {
      map: 'second',
      camera: {type: 'center', center: [2.5, 3.5], zoom: 14},
      viewport: {width: 390, height: 844, dpr: 2}
    }
  }
};
`;

async function createFixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dev-session-'));
  return cwd;
}

function waterColor(
  artifacts: ReturnType<TileflowArtifactSession['getLastGoodArtifacts']>,
): unknown {
  return waterColorFromStyle(artifacts?.styles.main);
}

function waterColorFromStyle(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>})
    ?.layers;
  return layers?.find((layer) => layer.id === 'streets-water')?.paint?.['fill-color'];
}

function waitForState(
  session: TileflowArtifactSession,
  predicate: (state: TileflowArtifactSessionState) => boolean,
  timeoutMs = 15_000,
): Promise<TileflowArtifactSessionState> {
  const current = session.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolveState, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for artifact state after ${timeoutMs} ms.`));
    }, timeoutMs);
    const unsubscribe = session.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolveState(state);
    });
  });
}

function iconConfig(source: string): string {
  return `export default {icons: {local: {source: '${source}'}}, maps: {main: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, icons: 'local'}}};\n`;
}

function runPreviewScript(
  html: string,
  href: string,
): {
  buildingVisibility(): string;
  currentUrl(): string;
  emit(eventName: string): void;
  mapOptions: Record<string, unknown> | undefined;
  pitch(): number;
  threeDimensionalLabel(): string | undefined;
  treeLabel(): string | undefined;
  treeVisibility(): string;
  toggleThreeDimensional(): void;
  toggleTrees(): void;
} {
  const script = /<script type="module">\s*([\s\S]*?)<\/script>\s*<\/body>/
    .exec(html)?.[1]
    ?.replace(/^[ \t]*import [^\n]+;[ \t]*$/gm, '');
  assert.ok(script, 'expected an inline preview script');

  let mapOptions: Record<string, unknown> | undefined;
  let buildingVisibility = 'none';
  let treeVisibility = 'visible';
  let currentPitch = 0;
  let styleReady = false;
  const controlButtons: FakeElement[] = [];
  let currentUrl = href;
  const listeners = new Map<string, Set<() => void>>();
  const elements = new Map<string, FakeElement>();

  class FakeElement {
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, () => void>();
    readonly style = {display: ''};
    className = '';
    textContent = '';
    title = '';
    type = '';

    addEventListener(name: string, listener: () => void): void {
      this.listeners.set(name, listener);
    }

    appendChild(): void {}

    click(): void {
      this.listeners.get('click')?.();
    }

    remove(): void {}

    removeEventListener(name: string): void {
      this.listeners.delete(name);
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
  }

  class FakeMap {
    readonly camera: {bearing: number; center: [number, number]; pitch: number; zoom: number};

    constructor(options: Record<string, unknown>) {
      mapOptions = options;
      currentPitch = Number(options.pitch ?? 0);
      this.camera = {
        bearing: Number(options.bearing ?? 0),
        center: (options.center as [number, number] | undefined) ?? [0, 0],
        pitch: Number(options.pitch ?? 0),
        zoom: Number(options.zoom ?? 0),
      };
    }

    addControl(control: {onAdd?(map: FakeMap): FakeElement}): void {
      control.onAdd?.(this);
    }

    easeTo(options: {pitch?: number}): void {
      if (options.pitch !== undefined) {
        this.camera.pitch = options.pitch;
        currentPitch = options.pitch;
      }
      for (const listener of listeners.get('pitch') ?? []) listener();
      for (const listener of listeners.get('moveend') ?? []) listener();
    }

    getBearing(): number {
      return this.camera.bearing;
    }

    fire(eventName: string): void {
      for (const listener of listeners.get(eventName) ?? []) listener();
    }

    getCenter(): {lat: number; lng: number} {
      return {lat: this.camera.center[1], lng: this.camera.center[0]};
    }

    getPitch(): number {
      return this.camera.pitch;
    }

    getStyle(): {
      layers?: Array<{id: string; metadata: Record<string, string>; type: string}>;
      metadata?: Record<string, string>;
    } {
      if (!styleReady) return {};
      return {
        layers: [
          {
            id: 'streets-buildings-3d',
            metadata: {'tileflow:3d-toggle': 'building'},
            type: 'fill-extrusion',
          },
          {
            id: 'streets-vegetation-trees',
            metadata: {},
            type: 'circle',
          },
        ],
        metadata: {'tileflow:basemap': 'streets'},
      };
    }

    getLayoutProperty(layerId: string, property: string): string | undefined {
      if (property !== 'visibility') return undefined;
      if (layerId === 'streets-buildings-3d') return buildingVisibility;
      if (layerId === 'streets-vegetation-trees') return treeVisibility;
      return undefined;
    }

    getZoom(): number {
      return this.camera.zoom;
    }

    getLayer(): undefined {
      return undefined;
    }

    getProjection(): {type: string} {
      return {type: 'mercator'};
    }

    on(eventName: string, listener: () => void): void {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    }

    off(eventName: string, listener: () => void): void {
      listeners.get(eventName)?.delete(listener);
    }

    setLayoutProperty(layerId: string, property: string, value: string): void {
      if (layerId === 'streets-buildings-3d' && property === 'visibility') {
        buildingVisibility = value;
      }
      if (layerId === 'streets-vegetation-trees' && property === 'visibility') {
        treeVisibility = value;
      }
    }

    triggerRepaint(): void {}
  }

  class FakeEventSource {
    addEventListener(): void {}
  }

  runInNewContext(script, {
    EventSource: FakeEventSource,
    URL,
    document: {
      createElement(tagName: string) {
        const element = new FakeElement();
        if (tagName === 'button') controlButtons.push(element);
        return element;
      },
      getElementById(id: string) {
        const element = new FakeElement();
        elements.set(id, element);
        return element;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, nextUrl: string) {
        currentUrl = nextUrl;
      },
      state: null,
    },
    location: {href, reload() {}},
    maplibregl: {Map: FakeMap, NavigationControl: class {}},
  });

  return {
    buildingVisibility: () => buildingVisibility,
    currentUrl: () => currentUrl,
    emit(eventName) {
      if (eventName === 'load' || eventName === 'styledata') styleReady = true;
      for (const listener of listeners.get(eventName) ?? []) listener();
    },
    mapOptions,
    pitch: () => currentPitch,
    threeDimensionalLabel: () =>
      controlButtons.find((button) => button.className === 'tileflow-3d-toggle')?.textContent,
    treeLabel: () =>
      controlButtons.find((button) => button.className === 'tileflow-tree-toggle')?.textContent,
    treeVisibility: () => treeVisibility,
    toggleThreeDimensional: () =>
      controlButtons.find((button) => button.className === 'tileflow-3d-toggle')?.click(),
    toggleTrees: () =>
      controlButtons.find((button) => button.className === 'tileflow-tree-toggle')?.click(),
  };
}

function svg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="${color}"/></svg>`;
}

function assetFingerprint(session: TileflowArtifactSession): string {
  const assets = session.getLastGoodArtifacts()?.assets ?? [];
  return assets
    .map((asset) =>
      typeof asset.source === 'string'
        ? asset.source
        : Buffer.from(asset.source).toString('base64'),
    )
    .join('|');
}
