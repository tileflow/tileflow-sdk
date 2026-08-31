import Ajv2020 from 'ajv/dist/2020.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {serializeTileflowConfigReference} from '../scripts/generate-config-reference';
import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  labels,
  land,
  landforms,
  nautical,
  parseTileflowMap,
  poi,
  roads,
  tileflowMapDefaultMaxDepth,
  tileflowRenderStackLimits,
  tileflowThemeLimits,
  transit,
  vegetation,
  water,
  zoom,
} from '../src';
import {
  tileflowSemanticDefaultModules,
  tileflowSemanticModuleNames,
} from '../src/cartography/domain-registry';
import {mergeTileflowDesign} from '../src/cartography/merge';
import {extendStreets} from './map-fixture';

type PublicOptionsExposeEnabled<TFactory extends (...input: never[]) => unknown> =
  'enabled' extends keyof NonNullable<Parameters<TFactory>[0]> ? true : false;

test('keeps complete-domain enablement out of every public module constructor', () => {
  const exposure = [
    false satisfies PublicOptionsExposeEnabled<typeof addresses>,
    false satisfies PublicOptionsExposeEnabled<typeof aeroways>,
    false satisfies PublicOptionsExposeEnabled<typeof boundaries>,
    false satisfies PublicOptionsExposeEnabled<typeof buildings>,
    false satisfies PublicOptionsExposeEnabled<typeof labels>,
    false satisfies PublicOptionsExposeEnabled<typeof land>,
    false satisfies PublicOptionsExposeEnabled<typeof landforms>,
    false satisfies PublicOptionsExposeEnabled<typeof nautical>,
    false satisfies PublicOptionsExposeEnabled<typeof poi>,
    false satisfies PublicOptionsExposeEnabled<typeof roads>,
    false satisfies PublicOptionsExposeEnabled<typeof transit>,
    false satisfies PublicOptionsExposeEnabled<typeof vegetation>,
    false satisfies PublicOptionsExposeEnabled<typeof water>,
  ];
  assert.equal(
    exposure.every((value) => value === false),
    true,
  );
});

test('creates serializable requests for every semantic domain', () => {
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

test('keeps registry defaults, type tags, and the resolved schema in lockstep', () => {
  assert.deepEqual(Object.keys(tileflowSemanticDefaultModules).sort(), tileflowSemanticModuleNames);

  for (const name of tileflowSemanticModuleNames) {
    const request = tileflowSemanticDefaultModules[name];
    assert.equal(request.type, name);
    assert.doesNotThrow(
      () => parseTileflowMap(extendStreets({modules: {[name]: request}})),
      `schema rejected semantic module ${name}`,
    );
  }
});

test('keeps the checked-in machine reference byte-for-byte aligned with its generator', async () => {
  const actual = await readFile(
    new URL('../../../docs/modules-api-reference.json', import.meta.url),
    'utf8',
  );
  assert.equal(actual, await serializeTileflowConfigReference());
});

test('keeps the checked-in modules API reference in lockstep with the semantic registry', async () => {
  const reference = JSON.parse(
    await readFile(new URL('../../../docs/modules-api-reference.json', import.meta.url), 'utf8'),
  ) as {
    expressions?: {
      astSchemaRefs?: Record<string, unknown>;
      grammarSchemaRef?: unknown;
    };
    modules?: Record<
      string,
      {
        authoringSchemaRef?: unknown;
        optionsSchemaRef?: unknown;
        patchSchemaRef?: unknown;
        schemaRef?: unknown;
        type?: unknown;
      }
    >;
    $defs?: Record<string, JsonSchemaObject>;
  };
  const documentedNames = Object.keys(reference.modules ?? {}).sort();

  assert.deepEqual(reference.expressions, {
    grammarSchemaRef: '#/$defs/TileflowDataExpression',
    astSchemaRefs: {
      color: '#/$defs/TileflowDataExpressionColor',
      image: '#/$defs/TileflowDataExpressionImage',
      number: '#/$defs/TileflowDataExpressionNumber',
      structural: '#/$defs/TileflowDataExpressionStructural',
    },
  });
  assert.deepEqual(documentedNames, tileflowSemanticModuleNames);
  for (const name of tileflowSemanticModuleNames) {
    assert.equal(reference.modules?.[name]?.type, name, `documentation type mismatch for ${name}`);
    const definitionName = `Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModuleResolved`;
    const schemaReference = `#/$defs/${definitionName}`;
    const optionsReference = `#/$defs/Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModuleOptions`;
    const patchReference = `#/$defs/Tileflow${name[0]!.toUpperCase()}${name.slice(1)}ModulePatch`;
    assert.equal(reference.modules?.[name]?.schemaRef, schemaReference);
    assert.equal(reference.modules?.[name]?.optionsSchemaRef, optionsReference);
    assert.equal(reference.modules?.[name]?.patchSchemaRef, patchReference);
    assert.equal(
      reference.modules?.[name]?.authoringSchemaRef,
      `#/$defs/TileflowAuthoringModules/properties/${name}`,
    );
    const resolvedModule = dereferenceJsonSchema(
      reference,
      asJsonSchema(reference.$defs?.[definitionName]),
    );
    assert.equal(asJsonSchema(resolvedModule.properties?.type).const, name);
    const options = dereferenceJsonSchema(
      reference,
      asJsonSchema(reference.$defs?.[optionsReference.slice('#/$defs/'.length)]),
    );
    const patch = dereferenceJsonSchema(
      reference,
      asJsonSchema(reference.$defs?.[patchReference.slice('#/$defs/'.length)]),
    );
    for (const [surface, schema] of [
      ['options', options],
      ['patch', patch],
    ] as const) {
      assert.equal(Object.hasOwn(schema.properties ?? {}, 'enabled'), false, `${name} ${surface}`);
      assert.equal(Object.hasOwn(schema.properties ?? {}, 'type'), false, `${name} ${surface}`);
    }
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

  assert.equal(reference.schemaVersion, 4);
  assert.equal(reference.$ref, authoringReference);
  assert.equal(reference.entrypoints?.authoring?.schemaRef, authoringReference);
  assert.equal(reference.entrypoints?.resolved?.schemaRef, resolvedReference);
  assert.deepEqual(definitions.TileflowAuthoringMap?.oneOf, [
    {$ref: '#/$defs/TileflowStandaloneMap'},
    {$ref: '#/$defs/TileflowDerivedMap'},
  ]);
  assert.doesNotMatch(JSON.stringify(definitions.TileflowAuthoringModules), /"set"/u);
  for (const [name, moduleRequest] of Object.entries(
    definitions.TileflowAuthoringModules?.properties ?? {},
  )) {
    const branches = moduleRequest.oneOf as JsonSchemaObject[];
    const direct = dereferenceJsonSchema(reference, branches[0]!);
    assert.equal(
      Object.hasOwn(direct.properties ?? {}, 'enabled'),
      false,
      `${name} direct authoring exposes compiler-owned enabled`,
    );
    const refinement = branches.find(
      (branch) =>
        branch.properties?.op !== undefined &&
        asJsonSchema(branch.properties.op).const === 'refine',
    );
    assert(refinement, `${name} is missing refine()`);
    const patches = asJsonSchema(refinement.properties?.patches);
    const patch = dereferenceJsonSchema(reference, asJsonSchema(patches.items));
    assert.equal(
      Object.hasOwn(patch.properties ?? {}, 'enabled'),
      false,
      `${name} refine() exposes compiler-owned enabled`,
    );
    assert.equal(
      Object.hasOwn(patch.properties ?? {}, 'type'),
      false,
      `${name} refine() exposes compiler-owned type`,
    );
  }

  const standaloneMap = definitions.TileflowStandaloneMap;
  assert.deepEqual(standaloneMap?.required, ['defaultTheme', 'id', 'themes', 'version']);
  assert.equal(Object.hasOwn(standaloneMap?.properties ?? {}, 'root'), false);
  assert.equal(Object.hasOwn(standaloneMap?.properties ?? {}, 'extends'), false);
  assert.equal(Object.hasOwn(standaloneMap?.properties ?? {}, 'scenes'), true);

  const derivedMap = definitions.TileflowDerivedMap;
  assert.deepEqual(derivedMap?.required, ['extends', 'id', 'version']);
  assert.deepEqual(derivedMap?.properties?.extends, {$ref: authoringReference});
  assert.equal(Object.hasOwn(derivedMap?.properties ?? {}, 'root'), false);
  assert.equal(Object.hasOwn(derivedMap?.properties ?? {}, 'scenes'), true);

  const scene = definitions.TileflowMapScene;
  assert.equal(Object.hasOwn(scene?.properties ?? {}, 'map'), false);
  assert.deepEqual(scene?.required, ['theme', 'camera', 'viewport']);

  const resolvedMap = definitions.ResolvedTileflowMap;
  assert.deepEqual(resolvedMap?.required, ['defaultTheme', 'id', 'name', 'themes', 'version']);
  assert.equal(Object.hasOwn(resolvedMap?.properties ?? {}, 'root'), false);
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
  const standaloneMap = definitions.TileflowStandaloneMap!;

  const inheritance = asJsonSchema(reference['x-tileflow-inheritance']);
  assert.equal(inheritance.maxDepth, tileflowMapDefaultMaxDepth);
  assert.deepEqual(inheritance.fields, {
    data: 'atomic',
    defaultTheme: 'atomic',
    extends: 'lineage',
    fonts: 'text-assets',
    glyphs: 'text-assets',
    icons: 'icons',
    id: 'identity',
    marine: 'atomic',
    modules: 'modules',
    name: 'identity',
    overlays: 'keyed-resources',
    projection: 'atomic',
    scenes: 'leaf',
    sources: 'keyed-resources',
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
      {enforcement: 'schema-and-theme-audit', path: 'modules|terrain'},
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

  const mapId = dereferenceJsonSchema(reference, asJsonSchema(standaloneMap.properties?.id));
  assert.ok((asJsonSchema(mapId.not).enum as string[]).includes('constructor'));
  assert.ok((asJsonSchema(mapId.not).enum as string[]).includes('con'));

  const icons = dereferenceJsonSchema(reference, asJsonSchema(standaloneMap.properties?.icons));
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

  const glyphs = dereferenceJsonSchema(reference, asJsonSchema(standaloneMap.properties?.glyphs));
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

  const themes = dereferenceJsonSchema(reference, asJsonSchema(standaloneMap.properties?.themes));
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
  const hatchRule = asJsonSchema((hatch.allOf as JsonSchemaObject[])[0]);
  assert.deepEqual(hatchRule.if, {
    required: ['patternWidths'],
    properties: {patternWidths: {not: {$ref: '#/$defs/TileflowReset'}}},
  });
  const hatchThen = asJsonSchema(hatchRule.then);
  assert.deepEqual(hatchThen.required, ['pattern']);
  assert.equal(asJsonSchema(hatchThen.properties?.pattern).type, undefined);

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
    '**.hatch.patternWidths[]',
    'terrain.contours.demUrl',
    'terrain.contours.thresholds.*',
    'terrain.contours.{thresholds,multiplier}',
    'terrain.contours.{thresholds,minZoom,maxZoom,overzoom}',
    'terrain.contours.{minor,index,labels}.{minZoom,maxZoom}',
  ]) {
    assert.equal(refinementPaths.has(path), true, `missing refinement ${path}`);
  }

  const semanticField = definitions.TileflowSemanticFieldReference!;
  const semanticFieldName = asJsonSchema(semanticField.properties?.name);
  assert.ok((semanticFieldName.enum as string[]).includes('class'));
  assert.equal((semanticFieldName.enum as string[]).includes('physical_column'), false);
  const dataExpression = definitions.TileflowDataExpression!;
  assert.equal(Array.isArray(dataExpression.oneOf), true);
  const getExpression = (dataExpression.oneOf as JsonSchemaObject[]).find(
    (schema) =>
      Array.isArray(schema.prefixItems) &&
      asJsonSchema((schema.prefixItems as unknown[])[0]).const === 'get',
  );
  assert(getExpression);
  assert.deepEqual((getExpression.prefixItems as unknown[])[1], {
    $ref: '#/$defs/TileflowSemanticFieldReference',
  });
  assert.equal(getExpression.items, false);
  assert.deepEqual(dataExpression['x-tileflow-refinements'], [
    'expr.var names must resolve in the lexical scope of one enclosing expr.let.',
    'match labels are unique and share one primitive type.',
    'step/interpolate stops are finite and strictly increasing.',
  ]);

  const tuples = collectJsonSchemaObjects(reference).filter(
    (schema) => Array.isArray(schema.prefixItems) && schema.items === false,
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

test('generated JSON Schema rejects representable semantic false positives', async () => {
  const reference = JSON.parse(
    await readFile(new URL('../../../docs/modules-api-reference.json', import.meta.url), 'utf8'),
  ) as JsonSchemaObject;
  const definitions = reference.$defs as Record<string, JsonSchemaObject>;
  const ajv = new Ajv2020({allErrors: true, strict: false});
  const compileDefinition = (name: string) =>
    ajv.compile({
      $schema: reference.$schema,
      $defs: definitions,
      $ref: `#/$defs/${name}`,
    });
  const token = (category: 'color' | 'image' | 'number', name: string) => ({
    category,
    kind: 'theme-token',
    token: name,
  });
  const semanticField = {kind: 'tileflow-data-field', name: 'class'};
  const validators = {
    color: compileDefinition('TileflowDataExpressionColor'),
    image: compileDefinition('TileflowDataExpressionImage'),
    number: compileDefinition('TileflowDataExpressionNumber'),
    structural: compileDefinition('TileflowDataExpressionStructural'),
  };
  const roadSurfaces = {
    options: compileDefinition('TileflowRoadsModuleOptions'),
    patch: compileDefinition('TileflowRoadsModulePatch'),
    resolved: compileDefinition('TileflowRoadsModuleResolved'),
  };

  assert.equal(
    roadSurfaces.resolved({type: 'roads'}),
    true,
    JSON.stringify(roadSurfaces.resolved.errors),
  );
  assert.equal(
    roadSurfaces.options({detail: 'major'}),
    true,
    JSON.stringify(roadSurfaces.options.errors),
  );
  assert.equal(roadSurfaces.options({type: 'roads'}), false);
  assert.equal(roadSurfaces.options({enabled: false}), false);
  assert.equal(
    roadSurfaces.patch({detail: 'major'}),
    true,
    JSON.stringify(roadSurfaces.patch.errors),
  );
  assert.equal(roadSurfaces.patch({type: {$tileflow: 'reset'}}), false);
  assert.equal(roadSurfaces.patch({enabled: false}), false);

  assert.equal(
    validators.color([
      'coalesce',
      ['get', semanticField],
      {
        color: token('color', 'surface.land'),
        kind: 'theme-color',
        opacity: token('number', 'style.opacity'),
        operation: 'alpha',
      },
    ]),
    true,
    JSON.stringify(validators.color.errors),
  );
  assert.equal(
    validators.color(['coalesce', ['get', semanticField], token('image', 'wrong')]),
    false,
  );
  assert.equal(
    validators.image(['coalesce', ['get', semanticField], token('image', 'surface.pattern')]),
    true,
    JSON.stringify(validators.image.errors),
  );
  assert.equal(
    validators.image(['coalesce', ['get', semanticField], token('color', 'wrong')]),
    false,
  );
  assert.equal(
    validators.number(['coalesce', ['get', semanticField], token('number', 'style.opacity')]),
    true,
    JSON.stringify(validators.number.errors),
  );
  assert.equal(
    validators.number(['coalesce', ['get', semanticField], token('color', 'wrong')]),
    false,
  );
  assert.equal(
    validators.structural(['coalesce', ['get', semanticField], 'fallback']),
    true,
    JSON.stringify(validators.structural.errors),
  );
  assert.equal(validators.structural(['literal', {nested: token('number', 'wrong')}]), false);

  for (const category of ['color', 'image', 'number', 'structural'] as const) {
    const wrapper = collectJsonSchemaObjects(reference).find(
      (schema) =>
        schema['x-tileflow-expression-category'] === category &&
        schema.properties?.kind !== undefined,
    );
    assert(wrapper, `missing ${category} expression wrapper`);
    assert.deepEqual(wrapper.properties?.value, {
      $ref: `#/$defs/TileflowDataExpression${category[0].toUpperCase()}${category.slice(1)}`,
    });
  }

  const terrainColor = Object.values(definitions).find(
    (schema) =>
      Array.isArray(schema.anyOf) &&
      schema.anyOf.some(
        (branch) =>
          asJsonSchema(branch).pattern ===
          '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$',
      ),
  );
  assert(terrainColor);
  const validateTerrainColor = ajv.compile(terrainColor);
  for (const valid of ['#abc', '#11223344', 'rgb(0, 127.5, 255)', 'rgba(1, 2, 3, 0.5)']) {
    assert.equal(
      validateTerrainColor(valid),
      true,
      `${valid}: ${JSON.stringify(validateTerrainColor.errors)}`,
    );
  }
  for (const invalid of ['blue', 'rgb(256, 0, 0)', 'rgb(255.1, 0, 0)', 'rgba(0, 0, 0, 1.1)']) {
    assert.equal(validateTerrainColor(invalid), false, invalid);
  }

  const marineAttributions = collectJsonSchemaObjects(reference).filter(
    (schema) =>
      schema.description === 'Non-empty marine attribution without leading or trailing whitespace.',
  );
  assert.ok(marineAttributions.length >= 2);
  const validateMarineAttribution = ajv.compile(marineAttributions[0]!);
  assert.equal(validateMarineAttribution('Open ocean data'), true);
  assert.equal(validateMarineAttribution(' Open ocean data'), false);
  assert.equal(validateMarineAttribution('Open ocean data\n'), false);

  const zoomSchemas = collectJsonSchemaObjects(reference).filter((schema) =>
    String(JSON.stringify(schema['x-tileflow-refinements'])).includes(
      'Zoom stops must be finite and strictly increasing.',
    ),
  );
  assert.ok(zoomSchemas.length >= 10);

  const publicUrl = Object.values(definitions).find(
    (schema) =>
      typeof schema['x-tileflow-refinement'] === 'string' &&
      String(schema['x-tileflow-refinement']).includes('WHATWG/PMTiles'),
  );
  assert(publicUrl);
  assert.equal(publicUrl.minLength, 1);
  assert.equal(publicUrl.maxLength, 4_096);
  const validatePublicUrl = ajv.compile(publicUrl);
  for (const valid of [
    '/',
    '/tiles.json',
    'https://tiles.example.test/tiles.json',
    'http://localhost:3000/tiles.json',
    'pmtiles://./fixtures/world.pmtiles',
  ]) {
    assert.equal(
      validatePublicUrl(valid),
      true,
      `${valid}: ${JSON.stringify(validatePublicUrl.errors)}`,
    );
  }
  for (const invalid of [
    '',
    ' /tiles.json',
    '/tiles.json ',
    '//tiles.example.test/tiles.json',
    'https://user@tiles.example.test/tiles.json',
    '/tiles.json#fragment',
    '/tiles\\unsafe.json',
    'javascript:alert(1)',
    'a'.repeat(4_097),
  ]) {
    assert.equal(validatePublicUrl(invalid), false, invalid);
  }

  const themes = Object.values(definitions).find(
    (schema) =>
      schema.description ===
      `Between one and ${tileflowThemeLimits.maxThemes} concrete named themes.`,
  );
  assert(themes);
  assert.equal(themes.minProperties, 1);
  assert.equal(themes.maxProperties, tileflowThemeLimits.maxThemes);
  const renderStacks = Object.values(definitions).filter(
    (schema) =>
      schema.description ===
      'Non-empty named render-stack operations owned by one semantic domain.',
  );
  assert.ok(renderStacks.length > 0);
  assert.ok(renderStacks.every((schema) => schema.minProperties === 1));
  assert.ok(
    renderStacks.every(
      (schema) => schema.maxProperties === tileflowRenderStackLimits.maxOperations,
    ),
  );
  assert.ok(
    renderStacks.every(
      (schema) =>
        JSON.stringify(schema['x-tileflow-limits']) === JSON.stringify(tileflowRenderStackLimits),
    ),
  );

  const renderRequirements = Object.values(definitions).filter(
    (schema) =>
      schema.description ===
      `Between one and ${tileflowRenderStackLimits.maxRequirements} unique semantic-domain requirements.`,
  );
  assert.ok(renderRequirements.length > 0);
  assert.ok(renderRequirements.every((schema) => schema.minItems === 1));
  assert.ok(
    renderRequirements.every(
      (schema) => schema.maxItems === tileflowRenderStackLimits.maxRequirements,
    ),
  );
  assert.ok(renderRequirements.every((schema) => schema.uniqueItems === true));

  const renderSelectors = Object.values(definitions).filter(
    (schema) => schema.description === 'Bounded recursive semantic render selector.',
  );
  assert.ok(renderSelectors.length > 0);
  const selectorRefinements = [
    {
      path: '$',
      rule: `The root is level one; the complete selector may contain at most ${tileflowRenderStackLimits.maxSelectorDepth} levels and ${tileflowRenderStackLimits.maxSelectorNodes} nodes.`,
    },
    {
      path: '**.step.stops.*.zoom',
      rule: 'Zoom values must be finite and strictly increasing in authored order.',
    },
  ];
  for (const selector of renderSelectors) {
    assert.deepEqual(selector['x-tileflow-limits'], {
      maxDepth: tileflowRenderStackLimits.maxSelectorDepth,
      maxNodes: tileflowRenderStackLimits.maxSelectorNodes,
    });
    assert.deepEqual(selector['x-tileflow-refinements'], selectorRefinements);
  }
  const renderStepStops = collectJsonSchemaObjects(reference).filter(
    (schema) =>
      schema.type === 'array' &&
      schema.maxItems === tileflowRenderStackLimits.maxStepStops &&
      String(JSON.stringify(schema['x-tileflow-refinements'])).includes(
        'strictly increasing in authored order',
      ),
  );
  assert.ok(renderStepStops.length > 0);
  assert.ok(
    renderStepStops.every(
      (schema) =>
        JSON.stringify(schema['x-tileflow-refinements']) ===
        JSON.stringify([
          {
            path: '*.zoom',
            rule: 'Zoom values must be finite and strictly increasing in authored order.',
          },
        ]),
    ),
  );

  const validateRenderStack = ajv.compile({
    $schema: reference.$schema,
    $defs: definitions,
    ...renderStacks[0],
  });
  const renderOperation = {
    attachTo: 'water',
    kind: 'render-pass',
    phase: 'finish',
    renderer: 'background',
    style: {},
  };
  const boundedRenderStack = Object.fromEntries(
    Array.from({length: tileflowRenderStackLimits.maxOperations}, (_, index) => [
      `operation${index}`,
      renderOperation,
    ]),
  );
  assert.equal(
    validateRenderStack(boundedRenderStack),
    true,
    JSON.stringify(validateRenderStack.errors),
  );
  assert.equal(
    validateRenderStack({...boundedRenderStack, operationOverflow: renderOperation}),
    false,
  );
  assert.equal(
    validateRenderStack({limited: {...renderOperation, requirements: ['roads']}}),
    true,
    JSON.stringify(validateRenderStack.errors),
  );
  assert.equal(
    validateRenderStack({limited: {...renderOperation, requirements: ['roads', 'roads']}}),
    false,
  );

  const hatchSchemas = collectJsonSchemaObjects(reference).filter(
    (schema) => schema.properties?.patternWidths && schema.properties?.pattern,
  );
  const hatch = hatchSchemas.find(
    (schema) => typeof asJsonSchema(schema.properties?.patternWidths).$ref === 'string',
  );
  assert(hatch);
  const validateHatch = ajv.compile({
    $schema: reference.$schema,
    $defs: definitions,
    ...hatch,
  });
  for (const valid of [
    {pattern: token('image', 'roads.hatch'), patternWidths: [1, 2]},
    {
      pattern: {kind: 'theme-fixed', reason: 'Invariant hatch sprite', value: 'roads-hatch'},
      patternWidths: {
        kind: 'theme-fixed',
        reason: 'Invariant sprite widths',
        value: [1, 4],
      },
    },
  ]) {
    assert.equal(validateHatch(valid), true, JSON.stringify(validateHatch.errors));
  }
  for (const invalid of [
    {patternWidths: [1, 2]},
    {pattern: token('color', 'wrong'), patternWidths: [1, 2]},
    {pattern: {kind: 'expression', value: ['literal', 'sprite']}, patternWidths: [1, 2]},
    {pattern: 'roads-hatch', patternWidths: [1]},
    {pattern: 'roads-hatch', patternWidths: [1.5, 2]},
  ]) {
    assert.equal(validateHatch(invalid), false, JSON.stringify(invalid));
  }

  const patchHatch = hatchSchemas.find((schema) =>
    JSON.stringify(schema.properties?.patternWidths).includes('TileflowReset'),
  );
  assert(patchHatch);
  const validatePatchHatch = ajv.compile({
    $schema: reference.$schema,
    $defs: definitions,
    ...patchHatch,
  });
  assert.equal(
    validatePatchHatch({patternWidths: {$tileflow: 'reset'}}),
    true,
    JSON.stringify(validatePatchHatch.errors),
  );
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
