import assert from 'node:assert/strict';
import test from 'node:test';
import {overlayPaint, progressLayer} from '../src/overlay-style';

const light = {
  line: '#2563eb',
  casing: '#1e3a8a',
  core: '#dbeafe',
  glow: '#2563eb',
  alternative: '#94a3b8',
  glowOpacity: 0.16,
  coreOpacity: 0,
};
const dark = {
  ...light,
  line: '#60a5fa',
  glow: '#60a5fa',
  core: '#eff6ff',
  glowOpacity: 0.4,
  coreOpacity: 0.7,
};
const line = {kind: 'line' as const, color: '#e9573f', size: 6, opacity: 1};

test('a layer drawn in a route ink takes the theme colour and, for glow and core, its opacity', () => {
  assert.deepEqual(overlayPaint({...line, ink: 'line'}, light), {
    'line-color': '#2563eb',
    'line-width': 6,
    'line-opacity': 1,
  });
  assert.equal(overlayPaint({...line, ink: 'line'}, dark)['line-color'], '#60a5fa');
  assert.equal(overlayPaint({...line, ink: 'glow', opacity: 0.5}, dark)['line-opacity'], 0.2);
  // A theme without a core leaves it out by its opacity.
  assert.equal(overlayPaint({...line, ink: 'core'}, light)['line-opacity'], 0);
  assert.equal(overlayPaint(line, dark)['line-color'], '#e9573f');
  assert.deepEqual(overlayPaint({kind: 'fill', color: '#00ff00', size: 0, opacity: 0.3}, light), {
    'fill-color': '#00ff00',
    'fill-opacity': 0.3,
  });
});

test('line progress draws in the same ink and opacity as the layer', () => {
  assert.deepEqual(progressLayer('app-route', {...line, ink: 'glow'}, dark, '#ffffff'), {
    id: 'app-route',
    color: '#60a5fa',
    highlight: '#ffffff',
    opacity: 0.4,
  });
  assert.equal(progressLayer('app-route', line, dark, undefined).highlight, undefined);
});
