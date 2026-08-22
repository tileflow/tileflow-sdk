import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBackgroundStyle,
  applyCircleStyle,
  applyExtrusionStyle,
  applyFillStyle,
  applyIconStyle,
  applyLineStyle,
  applySymbolStyle,
  applyTextStyle,
  createAreaLayers,
} from '../src/cartography/layer-style';
import {expression, zoom} from '../src/cartography/values';

test('maps every reusable visual primitive to its MapLibre paint and layout contract', () => {
  const background = applyBackgroundStyle(
    {id: 'background', type: 'background'},
    {color: '#F7F7F5', maxZoom: 20, minZoom: 1, opacity: 0.9, pattern: 'paper'},
  );
  assert.deepEqual(background.paint, {
    'background-color': '#F7F7F5',
    'background-opacity': 0.9,
    'background-pattern': 'paper',
  });
  assert.equal(background.minzoom, 1);
  assert.equal(background.maxzoom, 20);

  const fill = applyFillStyle(
    {id: 'fill', type: 'fill'},
    {antialias: false, color: '#ABCDEF', opacity: 0.7, pattern: 'hatch', visible: false},
  );
  assert.deepEqual(fill.paint, {
    'fill-antialias': false,
    'fill-color': '#ABCDEF',
    'fill-opacity': 0.7,
    'fill-pattern': 'hatch',
  });
  assert.deepEqual(fill.layout, {visibility: 'none'});

  const line = applyLineStyle(
    {id: 'line', type: 'line'},
    {
      blur: 0.2,
      cap: 'round',
      color: '#123456',
      dash: [2, 1],
      gapWidth: 3,
      join: 'miter',
      miterLimit: 4,
      offset: 1,
      opacity: 0.8,
      pattern: 'rail',
      roundLimit: 1.2,
      width: zoom.linear([
        [10, 1],
        [16, 5],
      ]),
    },
  );
  assert.deepEqual(line.layout, {
    'line-cap': 'round',
    'line-join': 'miter',
    'line-miter-limit': 4,
    'line-round-limit': 1.2,
  });
  assert.equal((line.paint as Record<string, unknown>)['line-color'], '#123456');
  assert.deepEqual((line.paint as Record<string, unknown>)['line-dasharray'], [2, 1]);
  assert.equal((line.paint as Record<string, unknown>)['line-pattern'], 'rail');

  const text = applyTextStyle(
    {id: 'text', type: 'symbol'},
    {
      allowOverlap: true,
      anchor: 'top-left',
      color: '#222222',
      fallbacks: ['Fallback Regular'],
      field: expression(['get', 'name']),
      font: 'Noto Sans',
      haloBlur: 0.3,
      haloColor: '#FFFFFF',
      haloWidth: 1.5,
      ignorePlacement: false,
      justify: 'left',
      keepUpright: true,
      letterSpacing: 0.02,
      lineHeight: 1.1,
      maxAngle: 35,
      maxWidth: 12,
      offset: [0, 1],
      opacity: 0.95,
      optional: true,
      padding: 4,
      radialOffset: 1.25,
      rotate: 5,
      size: 14,
      transform: 'uppercase',
      variableAnchors: ['top', 'bottom'],
      weight: 'bold',
    },
  );
  assert.deepEqual((text.layout as Record<string, unknown>)['text-font'], [
    'Noto Sans Bold',
    'Fallback Regular',
  ]);
  assert.equal((text.layout as Record<string, unknown>)['text-justify'], 'left');
  assert.equal((text.layout as Record<string, unknown>)['text-keep-upright'], true);
  assert.equal((text.layout as Record<string, unknown>)['text-max-angle'], 35);
  assert.deepEqual((text.layout as Record<string, unknown>)['text-variable-anchor'], [
    'top',
    'bottom',
  ]);
  assert.equal((text.paint as Record<string, unknown>)['text-opacity'], 0.95);

  const icon = applyIconStyle(
    {id: 'icon', type: 'symbol'},
    {
      allowOverlap: true,
      anchor: 'bottom',
      color: '#336699',
      haloBlur: 0.4,
      haloColor: '#FFFFFF',
      haloWidth: 1,
      image: 'museum',
      ignorePlacement: true,
      keepUpright: false,
      offset: [1, 2],
      opacity: 0.8,
      optional: true,
      padding: 3,
      pitchAlignment: 'map',
      rotate: 15,
      rotationAlignment: 'viewport',
      size: 1.2,
    },
  );
  assert.equal((icon.layout as Record<string, unknown>)['icon-anchor'], 'bottom');
  assert.equal((icon.layout as Record<string, unknown>)['icon-keep-upright'], false);
  assert.equal((icon.paint as Record<string, unknown>)['icon-color'], '#336699');
  assert.equal((icon.paint as Record<string, unknown>)['icon-halo-width'], 1);

  const circle = applyCircleStyle(
    {id: 'circle', type: 'circle'},
    {
      blur: 0.1,
      color: '#445566',
      opacity: 0.9,
      pitchAlignment: 'map',
      pitchScale: 'viewport',
      radius: 6,
      strokeColor: '#FFFFFF',
      strokeOpacity: 0.8,
      strokeWidth: 2,
    },
  );
  assert.equal((circle.paint as Record<string, unknown>)['circle-radius'], 6);
  assert.equal((circle.paint as Record<string, unknown>)['circle-pitch-alignment'], 'map');
  assert.equal((circle.paint as Record<string, unknown>)['circle-pitch-scale'], 'viewport');
  assert.equal((circle.paint as Record<string, unknown>)['circle-stroke-width'], 2);

  const extrusion = applyExtrusionStyle(
    {id: 'extrusion', type: 'fill-extrusion'},
    {
      base: expression(['get', 'min_height']),
      color: '#DDD8CF',
      height: expression(['get', 'height']),
      opacity: 0.75,
      pattern: 'facade',
      verticalGradient: false,
    },
  );
  assert.equal(
    (extrusion.paint as Record<string, unknown>)['fill-extrusion-vertical-gradient'],
    false,
  );
  assert.equal((extrusion.paint as Record<string, unknown>)['fill-extrusion-pattern'], 'facade');
});

test('preserves data-driven line-cap expressions for lateral-only widening', () => {
  const cap = expression<'butt' | 'round'>([
    'case',
    ['all', ['>=', ['zoom'], 17], ['>', ['get', 'clearance_extra_px_z15'], 0]],
    'butt',
    'round',
  ]);
  const line = applyLineStyle({id: 'clearance-line', type: 'line'}, {cap, width: 8});

  assert.deepEqual((line.layout as Record<string, unknown>)['line-cap'], cap.value);
});

test('area and symbol compounds have deterministic phases and fail on impossible shared ranges', () => {
  const area = createAreaLayers(
    {id: 'park', type: 'fill', source: 'tileflow', 'source-layer': 'park'},
    {
      fill: {color: '#AABBCC', minZoom: 8},
      outline: {color: '#778899', minZoom: 10, width: 1},
    },
  );
  assert.deepEqual(
    area.map(({layer, phase}) => [layer.id, phase, layer.minzoom]),
    [
      ['park', 'fill', 8],
      ['park-outline', 'outline', 10],
    ],
  );

  const symbol = applySymbolStyle(
    {id: 'poi', type: 'symbol'},
    {
      minZoom: 12,
      placement: 'point',
      priority: 3,
      spacing: 120,
      zOrder: 'source',
      icon: {image: 'museum'},
      text: {field: 'Museum', font: 'Noto Sans', weight: 'semibold'},
    },
  );
  assert.equal(symbol.minzoom, 12);
  assert.equal((symbol.layout as Record<string, unknown>)['symbol-sort-key'], -3);
  assert.equal((symbol.layout as Record<string, unknown>)['symbol-z-order'], 'source');

  const zoomPriority = applySymbolStyle(
    {id: 'priority', type: 'symbol'},
    {
      priority: zoom.linear([
        [8, 1],
        [16, 10],
      ]),
    },
  );
  assert.deepEqual((zoomPriority.layout as Record<string, unknown>)['symbol-sort-key'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    8,
    -1,
    16,
    -10,
  ]);

  assert.throws(
    () =>
      applySymbolStyle(
        {id: 'invalid', type: 'symbol'},
        {icon: {image: 'museum', minZoom: 10}, text: {field: 'Museum', minZoom: 12}},
      ),
    /symbol range conflict for minZoom/,
  );
});
