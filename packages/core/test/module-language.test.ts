import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  labels,
  land,
  landforms,
  parseTileflowMap,
  poi,
  roads,
  transit,
  vegetation,
  water,
  zoom,
} from '../src';
import {mergeTileflowDesign} from '../src/cartography/merge';
import {tileflowStreetsModuleNames, tileflowStreetsRecipe} from '../src/cartography/streets-recipe';
import {extendStreets} from './map-fixture';

test('creates serializable requests for every Streets domain', () => {
  const requests = {
    addresses: addresses({labels: {text: {size: 10}}}),
    land: land({landuse: {commercial: {fill: {color: '#eee'}}}}),
    landforms: landforms({elevation: true}),
    water: water({bodies: {fill: {color: '#ace'}}}),
    buildings: buildings({mode: '3d'}),
    labels: labels({places: 'major'}),
    vegetation: vegetation({mode: '3d'}),
    boundaries: boundaries({admin2: {width: 2}}),
    poi: poi({density: 2}),
    roads: roads({detail: 'major'}),
    transit: transit({rail: {surface: {dash: [2, 1]}}}),
    aeroways: aeroways({
      runway: {
        fill: {
          width: zoom.linear([
            [8, 1],
            [16, 8],
          ]),
        },
      },
    }),
  };

  assert.doesNotThrow(() => JSON.stringify(requests));
  assert.equal(requests.addresses.type, 'addresses');
  assert.equal(requests.land.type, 'land');
  assert.equal(requests.landforms.type, 'landforms');
  assert.equal(requests.water.type, 'water');
  assert.equal(requests.buildings.type, 'buildings');
  assert.equal(requests.labels.type, 'labels');
  assert.equal(requests.vegetation.type, 'vegetation');
  assert.equal(requests.boundaries.type, 'boundaries');
  assert.equal(requests.poi.type, 'poi');
  assert.equal(requests.roads.type, 'roads');
  assert.equal(requests.transit.type, 'transit');
  assert.equal(requests.aeroways.type, 'aeroways');
});

test('keeps the Streets module recipe, type tags, and root schema in lockstep', () => {
  assert.deepEqual(Object.keys(tileflowStreetsRecipe.modules).sort(), tileflowStreetsModuleNames);

  for (const name of tileflowStreetsModuleNames) {
    const request = tileflowStreetsRecipe.modules[name];
    assert.equal(request.type, name);
    assert.doesNotThrow(
      () => parseTileflowMap(extendStreets({modules: {[name]: request}})),
      `schema rejected Streets module ${name}`,
    );
  }
});

test('keeps the checked-in modules API reference in lockstep with the Streets registry', async () => {
  const reference = JSON.parse(
    await readFile(new URL('../../../docs/modules-api-reference.json', import.meta.url), 'utf8'),
  ) as {modules?: Record<string, {type?: unknown}>};
  const documentedNames = Object.keys(reference.modules ?? {}).sort();

  assert.deepEqual(documentedNames, tileflowStreetsModuleNames);
  for (const name of tileflowStreetsModuleNames) {
    assert.equal(reference.modules?.[name]?.type, name, `documentation type mismatch for ${name}`);
  }
});

test('publishes authoring and resolved map entrypoints without hiding extends or scenes', async () => {
  const reference = JSON.parse(
    await readFile(new URL('../../../docs/modules-api-reference.json', import.meta.url), 'utf8'),
  ) as {
    $ref?: unknown;
    schemaVersion?: unknown;
    entrypoints?: Record<string, {schemaRef?: unknown}>;
    $defs?: Record<string, JsonSchemaObject>;
  };
  const definitions = reference.$defs ?? {};
  const authoringReference = '#/$defs/TileflowAuthoringMap';
  const resolvedReference = '#/$defs/ResolvedTileflowMap';

  assert.equal(reference.schemaVersion, 2);
  assert.equal(reference.$ref, authoringReference);
  assert.equal(reference.entrypoints?.authoring?.schemaRef, authoringReference);
  assert.equal(reference.entrypoints?.resolved?.schemaRef, resolvedReference);
  assert.deepEqual(definitions.TileflowAuthoringMap?.oneOf, [
    {$ref: '#/$defs/TileflowRootMap'},
    {$ref: '#/$defs/TileflowDerivedMap'},
  ]);

  const rootMap = definitions.TileflowRootMap;
  assert.deepEqual(rootMap?.required, ['defaultTheme', 'id', 'root', 'themes', 'version']);
  assert.equal(Object.hasOwn(rootMap?.properties ?? {}, 'root'), true);
  assert.equal(Object.hasOwn(rootMap?.properties ?? {}, 'extends'), false);
  assert.equal(Object.hasOwn(rootMap?.properties ?? {}, 'scenes'), true);

  const derivedMap = definitions.TileflowDerivedMap;
  assert.deepEqual(derivedMap?.required, ['extends', 'id', 'version']);
  assert.deepEqual(derivedMap?.properties?.extends, {$ref: authoringReference});
  assert.equal(Object.hasOwn(derivedMap?.properties ?? {}, 'root'), false);
  assert.equal(Object.hasOwn(derivedMap?.properties ?? {}, 'scenes'), true);

  const scene = definitions.TileflowMapScene;
  assert.equal(Object.hasOwn(scene?.properties ?? {}, 'map'), false);
  assert.deepEqual(scene?.required, ['theme', 'camera', 'viewport']);

  const resolvedMap = definitions.ResolvedTileflowMap;
  assert.deepEqual(resolvedMap?.required, [
    'defaultTheme',
    'id',
    'name',
    'root',
    'themes',
    'version',
  ]);
  assert.equal(Object.hasOwn(resolvedMap?.properties ?? {}, 'extends'), false);
  assert.equal(Object.hasOwn(resolvedMap?.properties ?? {}, 'scenes'), false);

  for (const localReference of collectLocalReferences(reference)) {
    assert.doesNotThrow(
      () => resolveJsonPointer(reference, localReference),
      `unresolved JSON Schema reference ${localReference}`,
    );
  }
});

test('publishes AI-reference constraints that match exact assets and capture authoring', async () => {
  const reference = JSON.parse(
    await readFile(new URL('../../../docs/modules-api-reference.json', import.meta.url), 'utf8'),
  ) as JsonSchemaObject;
  const definitions = reference.$defs as Record<string, JsonSchemaObject>;
  const rootMap = definitions.TileflowRootMap!;

  const inheritance = asJsonSchema(reference['x-tileflow-inheritance']);
  assert.deepEqual(inheritance.fields, {
    data: 'atomic',
    defaultTheme: 'atomic',
    delivery: 'leaf',
    extends: 'lineage',
    fonts: 'text-assets',
    glyphs: 'text-assets',
    icons: 'icons',
    id: 'identity',
    marine: 'atomic',
    modules: 'modules',
    name: 'identity',
    projection: 'atomic',
    root: 'lineage',
    scenes: 'leaf',
    systemThemes: 'atomic',
    terrain: 'atomic',
    themes: 'atomic',
    version: 'identity',
    view: 'deep',
  });

  const themeContract = asJsonSchema(reference['x-tileflow-theme-contract']);
  const identity = asJsonSchema(themeContract.identity);
  assert.match(String(identity.selector), /concrete runtime selector/u);
  assert.match(String(identity.document), /may differ from the selector key/u);
  assert.match(String(identity.system), /never a concrete theme name/u);
  const relationalRules = themeContract.relationalRules as JsonSchemaObject[];
  assert.deepEqual(
    relationalRules.map(({enforcement, path}) => ({enforcement, path})),
    [
      {enforcement: 'config-validation', path: 'defaultTheme'},
      {
        enforcement: 'config-validation',
        path: 'themes.*.tokens.{color,font,image,number}',
      },
      {enforcement: 'config-validation', path: 'systemThemes.{light,dark}'},
      {enforcement: 'theme-resolution', path: 'themes.*'},
      {enforcement: 'schema-and-theme-audit', path: 'modules|terrain|compilerEffects'},
    ],
  );
  const visualIntent = asJsonSchema(themeContract.visualIntent);
  assert.deepEqual(visualIntent.implicitLiterals, [
    {
      categories: ['color', 'font', 'image'],
      code: 'THEME_IMPLICIT_FIXED',
      severity: 'error',
      effect:
        'inspect reports the exact semantic path; createStyle, validate, preview, build, and capture fail closed.',
    },
    {
      categories: ['number'],
      code: 'THEME_IMPLICIT_FIXED',
      severity: 'warning',
      effect:
        'inspect reports the exact semantic path; compilation remains valid because ordinary numeric styling is common.',
    },
  ]);

  const mapId = dereferenceJsonSchema(reference, asJsonSchema(rootMap.properties?.id));
  assert.ok((asJsonSchema(mapId.not).enum as string[]).includes('constructor'));
  assert.ok((asJsonSchema(mapId.not).enum as string[]).includes('con'));

  const icons = dereferenceJsonSchema(reference, asJsonSchema(rootMap.properties?.icons));
  assert.match(String(icons.description), /omission inherits/u);
  assert.match(String(icons.description), /\[\] selects no icons/u);
  assert.match(String(icons.description), /later directory wins/u);
  const assetDirectory = dereferenceJsonSchema(reference, asJsonSchema(icons.items));
  const directoryBranches = assetDirectory.anyOf as JsonSchemaObject[];
  const localDirectory = dereferenceJsonSchema(reference, directoryBranches[0]!);
  const localPattern = new RegExp(String(localDirectory.pattern), 'u');
  assert.equal(localPattern.test('./icons'), true);
  assert.equal(localPattern.test('../../shared/icons'), true);
  for (const invalid of ['icons', './../icons', './a//b', './.', './a/../b', './a\\b']) {
    assert.equal(localPattern.test(invalid), false, invalid);
  }
  const packageDirectory = dereferenceJsonSchema(reference, directoryBranches[1]!);
  const packagePath = dereferenceJsonSchema(
    reference,
    asJsonSchema(packageDirectory.properties?.path),
  );
  const packagePathPattern = new RegExp(String(packagePath.pattern), 'u');
  assert.equal(packagePathPattern.test('assets/streets/icons'), true);
  for (const invalid of ['/assets', '../assets', 'assets//icons', 'assets\\icons']) {
    assert.equal(packagePathPattern.test(invalid), false, invalid);
  }

  const glyphs = dereferenceJsonSchema(reference, asJsonSchema(rootMap.properties?.glyphs));
  assert.equal(glyphs.oneOf, undefined);
  const glyphKind = dereferenceJsonSchema(reference, asJsonSchema(glyphs.properties?.kind));
  assert.equal(glyphKind.const, 'url');
  assert.match(String(glyphs.description), /owned by the map/u);
  const glyphUrl = dereferenceJsonSchema(reference, asJsonSchema(glyphs.properties?.url));
  const glyphUrlPattern = new RegExp(String(glyphUrl.pattern), 'u');
  assert.equal(
    glyphUrlPattern.test('https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf'),
    true,
  );
  for (const invalid of [
    'https://api.tileflow.dev/fonts.pbf',
    '//api.tileflow.dev/{fontstack}/{range}.pbf',
    'https://user@api.tileflow.dev/{fontstack}/{range}.pbf',
    '/fonts/{fontstack}/{range}.pbf#fragment',
    'https://api.tileflow.dev/{fontstack}/{range}.pbf#fragment',
  ]) {
    assert.equal(glyphUrlPattern.test(invalid), false, invalid);
  }
  const fontStacks = dereferenceJsonSchema(reference, asJsonSchema(glyphs.properties?.fontStacks));
  assert.equal(fontStacks.uniqueItems, true);
  const stack = dereferenceJsonSchema(reference, asJsonSchema(fontStacks.items));
  const stackPattern = new RegExp(String(stack.pattern), 'u');
  assert.equal(stackPattern.test('Noto Sans Regular,Noto Sans Bold'), true);
  assert.equal(stackPattern.test(' Noto Sans Regular'), false);

  const themes = dereferenceJsonSchema(reference, asJsonSchema(rootMap.properties?.themes));
  const theme = dereferenceJsonSchema(reference, asJsonSchema(themes.additionalProperties));
  const typography = dereferenceJsonSchema(reference, asJsonSchema(theme.properties?.typography));
  const font = dereferenceJsonSchema(reference, asJsonSchema(typography.properties?.font));
  const fontPattern = new RegExp(String(font.pattern), 'u');
  assert.equal(fontPattern.test('Noto Sans Regular'), true);
  assert.equal(fontPattern.test(' Noto Sans Regular'), false);
  assert.equal(fontPattern.test('Noto Sans\\Regular'), false);
  const fallbacks = dereferenceJsonSchema(
    reference,
    asJsonSchema(typography.properties?.fallbacks),
  );
  assert.equal(fallbacks.uniqueItems, true);

  const delivery = dereferenceJsonSchema(reference, asJsonSchema(rootMap.properties?.delivery));
  const hosted = dereferenceJsonSchema(reference, asJsonSchema(delivery.properties?.hosted));
  const allowedOrigins = dereferenceJsonSchema(
    reference,
    asJsonSchema(hosted.properties?.allowedOrigins),
  );
  const origin = dereferenceJsonSchema(reference, asJsonSchema(allowedOrigins.items));
  const originPattern = new RegExp(String(origin.pattern), 'u');
  assert.equal(originPattern.test('https://maps.example.test'), true);
  assert.equal(originPattern.test('http://localhost:3000'), true);
  for (const invalid of [
    'anything',
    'https://user@maps.example.test',
    'https://maps.example.test/',
  ]) {
    assert.equal(originPattern.test(invalid), false, invalid);
  }

  const scene = definitions.TileflowMapScene!;
  const viewport = dereferenceJsonSchema(reference, asJsonSchema(scene.properties?.viewport));
  assert.deepEqual(viewport.allOf, [
    {
      if: {properties: {dpr: {const: 2}}, required: ['dpr']},
      then: {properties: {height: {maximum: 2048}, width: {maximum: 2048}}},
    },
  ]);
  const target = dereferenceJsonSchema(reference, asJsonSchema(scene.properties?.target));
  const applicationTarget = (target.oneOf as JsonSchemaObject[])
    .map((branch) => dereferenceJsonSchema(reference, branch))
    .find((branch) => Object.hasOwn(branch.properties ?? {}, 'path'));
  assert(applicationTarget);
  assert.deepEqual(applicationTarget.not, {required: ['captureId', 'selector']});
  const captureId = dereferenceJsonSchema(
    reference,
    asJsonSchema(applicationTarget.properties?.captureId),
  );
  assert.deepEqual(captureId.not, {const: '__proto__'});

  const hatch = collectJsonSchemaObjects(reference).find(
    (schema) => schema.properties?.patternWidths && schema.properties?.pattern,
  );
  assert(hatch);
  assert.deepEqual((hatch.allOf as JsonSchemaObject[])[0], {
    if: {required: ['patternWidths']},
    then: {required: ['pattern'], properties: {pattern: {type: 'string'}}},
  });

  const terrainContours = collectJsonSchemaObjects(reference).find(
    (schema) => schema.properties?.demMaxZoom && schema.properties?.thresholds,
  );
  assert(terrainContours);
  const terrainRefinements = terrainContours['x-tileflow-refinements'];
  assert(Array.isArray(terrainRefinements));
  assert.deepEqual(terrainRefinements, [
    {
      path: 'demUrl',
      rule: 'Must pass the exact safe HTTP(S) DEM-template parser described on the property.',
    },
    {path: 'maxZoom', rule: 'When present, must include the greatest threshold zoom.'},
    {
      path: 'minZoom',
      rule: 'When present, must not precede the smallest threshold zoom and must not exceed the effective maxZoom.',
    },
    {
      path: 'overzoom',
      rule: 'Must not exceed the smallest threshold zoom, so generated DEM zooms cannot become negative.',
    },
    {
      path: '{minor,index,labels}.{minZoom,maxZoom}',
      rule: 'Each layer minZoom must not precede the effective contour-source minZoom, and each layer maxZoom must include its effective minZoom.',
    },
  ]);
  const terrainDemUrl = dereferenceJsonSchema(
    reference,
    asJsonSchema(terrainContours.properties?.demUrl),
  );
  assert.match(String(terrainDemUrl.description), /exactly once/u);
  assert.match(String(terrainDemUrl.description), /plain HTTP/u);
  assert.match(String(terrainDemUrl.description), /credentials/u);
  assert.match(String(terrainDemUrl.description), /fragments/u);
  assert.match(String(terrainDemUrl['x-tileflow-refinement']), /WHATWG URL/u);
  const terrainThresholds = dereferenceJsonSchema(
    reference,
    asJsonSchema(terrainContours.properties?.thresholds),
  );
  assert.equal(terrainThresholds.minProperties, 1);
  assert.equal(terrainThresholds.maxProperties, 25);
  assert.deepEqual(terrainThresholds['x-tileflow-refinements'], [
    {
      path: '*',
      rule: 'The index interval must be greater than or equal to, and a whole multiple of, the minor interval.',
    },
    {
      path: '*[0]',
      rule: 'The minor interval must satisfy the zoom- and multiplier-dependent main-thread contour density budget.',
    },
  ]);

  const refinements = definitions.ResolvedTileflowMap?.['x-tileflow-refinements'];
  assert(Array.isArray(refinements));
  const refinementPaths = new Set(
    refinements.map((refinement) => String(asJsonSchema(refinement).path)),
  );
  for (const path of [
    '**.{minZoom,maxZoom}',
    'data.{minzoom,maxzoom}',
    'data.bounds',
    '**.{font,fallbacks[]}',
    'glyphs.fontStacks[]',
    'delivery.hosted.allowedOrigins[]',
    '**.hatch.patternWidths[]',
    'terrain.contours.demUrl',
    'terrain.contours.thresholds.*',
    'terrain.contours.{thresholds,multiplier}',
    'terrain.contours.{thresholds,minZoom,maxZoom,overzoom}',
    'terrain.contours.{minor,index,labels}.{minZoom,maxZoom}',
  ]) {
    assert.equal(refinementPaths.has(path), true, `missing refinement ${path}`);
  }

  const tuples = collectJsonSchemaObjects(reference).filter((schema) =>
    Array.isArray(schema.prefixItems),
  );
  assert.ok(tuples.length > 0);
  for (const tuple of tuples) {
    const length = (tuple.prefixItems as unknown[]).length;
    assert.equal(tuple.minItems, length);
    assert.equal(tuple.maxItems, length);
    assert.equal(tuple.items, false);
  }
  assert.equal(typeof reference['x-tileflow-refinement-contract'], 'string');
  assert.ok(Array.isArray(definitions.ResolvedTileflowMap?.['x-tileflow-refinements']));
});

test('merges partial module requests while replacing arrays and preserving zoom values atomically', () => {
  const resolved = mergeTileflowDesign(
    {
      enabled: true,
      rail: {
        color: '#333',
        dash: [1, 1],
        width: zoom.linear([
          [5, 0.5],
          [15, 3],
        ]),
      },
    },
    {rail: {color: '#111'}},
    {rail: {dash: [4, 2]}},
  );

  assert.deepEqual(resolved.rail.color, '#111');
  assert.deepEqual(resolved.rail.dash, [4, 2]);
  assert.deepEqual(
    resolved.rail.width,
    zoom.linear([
      [5, 0.5],
      [15, 3],
    ]),
  );
  assert.equal(resolved.enabled, true);
});

type JsonSchemaObject = {
  $defs?: unknown;
  $ref?: unknown;
  allOf?: unknown;
  anyOf?: unknown;
  const?: unknown;
  description?: unknown;
  items?: unknown;
  maxItems?: unknown;
  minItems?: unknown;
  not?: unknown;
  oneOf?: unknown;
  pattern?: unknown;
  prefixItems?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  uniqueItems?: unknown;
  [key: string]: unknown;
};

function asJsonSchema(value: unknown): JsonSchemaObject {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonSchemaObject;
}

function dereferenceJsonSchema(root: unknown, input: JsonSchemaObject): JsonSchemaObject {
  let current = input;
  const seen = new Set<string>();
  while (typeof current.$ref === 'string') {
    assert.equal(seen.has(current.$ref), false);
    seen.add(current.$ref);
    current = asJsonSchema(resolveJsonPointer(root, current.$ref));
  }
  return current;
}

function collectJsonSchemaObjects(value: unknown): JsonSchemaObject[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonSchemaObjects);
  if (!value || typeof value !== 'object') return [];
  return [
    value as JsonSchemaObject,
    ...Object.values(value as Record<string, unknown>).flatMap(collectJsonSchemaObjects),
  ];
}

function collectLocalReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectLocalReferences);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === '$ref' && typeof child === 'string' && child.startsWith('#/') ? [child] : []),
    ...collectLocalReferences(child),
  ]);
}

function resolveJsonPointer(root: unknown, reference: string): unknown {
  let current = root;
  for (const rawSegment of reference.slice(2).split('/')) {
    assert(current && typeof current === 'object' && !Array.isArray(current));
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(Object.hasOwn(current, segment));
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
