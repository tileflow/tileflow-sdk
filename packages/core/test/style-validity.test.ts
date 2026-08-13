import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  type MapLibreStyle,
  osm,
  poi,
  roads,
  styleOverride,
  type TileflowRoadsModuleOptions,
} from '../src/index';

const detailedRoads = {
  detail: 'all',
  extras: {ferry: false, paths: true, rail: true},
  hierarchy: 'clear',
  outline: 'strong',
  weight: 'regular',
} as const satisfies TileflowRoadsModuleOptions;

test('every generated road option produces a semantically valid MapLibre style', () => {
  const cases: Array<{label: string; options: TileflowRoadsModuleOptions}> = [
    ...(['none', 'highways', 'major', 'streets', 'all'] as const).map((detail) => ({
      label: `detail=${detail}`,
      options: {...detailedRoads, detail},
    })),
    ...(['subtle', 'clear', 'strong'] as const).map((hierarchy) => ({
      label: `hierarchy=${hierarchy}`,
      options: {...detailedRoads, hierarchy},
    })),
    ...(['none', 'subtle', 'strong'] as const).map((outline) => ({
      label: `outline=${outline}`,
      options: {...detailedRoads, outline},
    })),
    ...(['thin', 'regular', 'bold'] as const).map((weight) => ({
      label: `weight=${weight}`,
      options: {...detailedRoads, weight},
    })),
    {
      label: 'all extras disabled',
      options: {...detailedRoads, extras: {ferry: false, paths: false, rail: false}},
    },
    {
      label: 'all extras enabled',
      options: {...detailedRoads, extras: {ferry: true, paths: true, rail: true}},
    },
    {
      label: 'semantic class widths and one-way markers',
      options: {
        ...detailedRoads,
        oneWayMarkers: true,
        widthScale: {motorway: 1.7, minor: 0.65, service: 0.5, path: 0.8},
      },
    },
  ];

  for (const entry of cases) {
    const style = createStyle({
      basemap: osm(),
      modules: [roads(entry.options)],
      renderer: 'generated',
    });
    const issues = validateStyle(style);

    assert.deepEqual(issues, [], `${entry.label}:\n${issues.join('\n')}`);
  }
});

test('every semantic POI policy produces a valid style in both renderers', () => {
  for (const renderer of ['osm-bright', 'generated'] as const) {
    for (const density of ['sparse', 'balanced', 'dense'] as const) {
      const style = createStyle({
        basemap: osm(),
        modules: [
          poi({
            categories: ['food', 'culture', 'lodging'],
            classMapping: {culture: ['memorial']},
            color: 'category',
            density,
            placement: {coupleIconAndLabel: true, iconPadding: 4, textPadding: 3},
            preset: 'full',
          }),
        ],
        renderer,
      });
      const issues = validateStyle(style);

      assert.deepEqual(issues, [], `${renderer}/${density}:\n${issues.join('\n')}`);
    }
  }
});

test('generated road camera expressions preserve visibility boundaries', () => {
  const style = createStyle({
    basemap: osm(),
    modules: [roads(detailedRoads)],
    renderer: 'generated',
  });
  const tunnels = getLayer(style, 'roads-tunnels');
  const opacity = getPaint(tunnels, 'line-opacity');
  const width = getPaint(tunnels, 'line-width');

  assert.equal(countZoomExpressions(opacity), 1);
  assert.equal(countZoomExpressions(width), 1);

  assert.equal(evaluateExpression(opacity, {class: 'motorway'}, 11.999), 0.92 * 0.28);
  assert.equal(evaluateExpression(opacity, {class: 'minor'}, 11.999), 0);
  assert.equal(evaluateExpression(opacity, {class: 'minor'}, 12), 0.68 * 0.28);
  assert.equal(evaluateExpression(opacity, {class: 'service'}, 13.999), 0);
  assert.equal(evaluateExpression(opacity, {class: 'service'}, 14), 0.68 * 0.28);
  assert.equal(evaluateExpression(opacity, {class: 'rail'}, 11.999), 0.68 * 0.28);

  const majorWidth = evaluateExpression(width, {class: 'motorway'}, 14);
  const minorWidth = evaluateExpression(width, {class: 'minor'}, 14);
  assert.equal(majorWidth, 1);
  assert.equal(minorWidth, 0.84);
});

test('style overrides omit absent records and keep every style JSON-clean', () => {
  const variants = [
    styleOverride({layers: {background: {paint: {'background-color': '#000000'}}}}),
    styleOverride({layers: {background: {layout: {visibility: 'none'}}}}),
    styleOverride({layers: {background: {metadata: {owner: 'test'}}}}),
    styleOverride({
      layers: {
        background: {
          layout: {visibility: 'none'},
          metadata: {owner: 'test'},
          paint: {'background-color': '#000000'},
        },
      },
    }),
    styleOverride({
      layers: {
        inserted: {
          before: 'water',
          paint: {'background-color': '#112233'},
          type: 'background',
        },
      },
    }),
  ];

  for (const module of variants) {
    const style = createStyle({basemap: osm(), modules: [module], theme: 'light'});
    assertJsonClean(style);
  }

  const paintOnly = createStyle({basemap: osm(), modules: [variants[0]!], theme: 'light'});
  const background = getLayer(paintOnly, 'background');
  assert.equal(Object.hasOwn(background, 'layout'), false);
  assert.equal(Object.hasOwn(background, 'metadata'), false);

  for (const style of [
    createStyle({basemap: osm(), theme: 'light'}),
    createStyle({basemap: osm(), modules: [roads(detailedRoads)], renderer: 'generated'}),
    createStyle({
      basemap: osm(),
      modules: [
        roads(detailedRoads),
        styleOverride({layers: {'roads-major': {paint: {'line-color': '#334455'}}}}),
      ],
      renderer: 'generated',
      theme: {colors: {background: '#F5F5F5'}},
    }),
  ]) {
    assertJsonClean(style);
  }
});

function validateStyle(style: MapLibreStyle): string[] {
  return validateStyleMin(style as Parameters<typeof validateStyleMin>[0]).map((issue) => {
    const message = issue.message;
    return message.replace(/layers\[(\d+)]/g, (_match, index: string) => {
      const layer = style.layers[Number(index)];
      return `layers.${String(layer?.id ?? index)}`;
    });
  });
}

function getLayer(style: MapLibreStyle, id: string): Record<string, unknown> {
  const layer = style.layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `Expected layer ${id}`);
  return layer;
}

function getPaint(layer: Record<string, unknown>, property: string): unknown {
  const paint = layer.paint;
  assert.ok(paint && typeof paint === 'object' && !Array.isArray(paint));
  return (paint as Record<string, unknown>)[property];
}

function countZoomExpressions(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return (
    (value[0] === 'zoom' ? 1 : 0) +
    value.reduce((count, item) => count + countZoomExpressions(item), 0)
  );
}

function evaluateExpression(
  value: unknown,
  properties: Record<string, unknown>,
  zoom: number,
): unknown {
  if (!Array.isArray(value)) return value;
  const [operator, ...arguments_] = value;

  if (operator === 'zoom') return zoom;
  if (operator === 'get') return properties[String(arguments_[0])];
  if (operator === 'case') {
    for (let index = 0; index < arguments_.length - 1; index += 2) {
      if (evaluateExpression(arguments_[index], properties, zoom)) {
        return evaluateExpression(arguments_[index + 1], properties, zoom);
      }
    }
    return evaluateExpression(arguments_.at(-1), properties, zoom);
  }
  if (operator === 'match') {
    const input = evaluateExpression(arguments_[0], properties, zoom);
    for (let index = 1; index < arguments_.length - 1; index += 2) {
      const labels = arguments_[index];
      if (Array.isArray(labels) ? labels.includes(input) : labels === input) {
        return evaluateExpression(arguments_[index + 1], properties, zoom);
      }
    }
    return evaluateExpression(arguments_.at(-1), properties, zoom);
  }
  if (operator === 'step') {
    const input = Number(evaluateExpression(arguments_[0], properties, zoom));
    let output = arguments_[1];
    for (let index = 2; index < arguments_.length; index += 2) {
      if (input < Number(arguments_[index])) break;
      output = arguments_[index + 1];
    }
    return evaluateExpression(output, properties, zoom);
  }
  if (operator === 'interpolate') {
    const input = Number(evaluateExpression(arguments_[1], properties, zoom));
    const stops = arguments_.slice(2);
    if (input <= Number(stops[0])) return evaluateExpression(stops[1], properties, zoom);
    for (let index = 2; index < stops.length; index += 2) {
      const rightInput = Number(stops[index]);
      if (input > rightInput) continue;
      const leftInput = Number(stops[index - 2]);
      const left = Number(evaluateExpression(stops[index - 1], properties, zoom));
      const right = Number(evaluateExpression(stops[index + 1], properties, zoom));
      return left + ((right - left) * (input - leftInput)) / (rightInput - leftInput);
    }
    return evaluateExpression(stops.at(-1), properties, zoom);
  }

  throw new Error(`Unsupported test expression operator: ${String(operator)}`);
}

function assertJsonClean(value: unknown): void {
  assertJsonValue(value, '$');
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  assert.equal(typeof value, 'object', `${path} must be a JSON value`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  assert.ok(value);
  for (const [key, item] of Object.entries(value)) {
    assertJsonValue(item, `${path}.${key}`);
  }
}
