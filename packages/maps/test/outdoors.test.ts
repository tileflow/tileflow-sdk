import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveMap, resolveTileflowTheme} from '@tileflow/core';
import {
  outdoors,
  outdoorsIcons,
  outdoorsThemes,
  streets,
  streetsIcons,
  streetsThemes,
} from '../src';

const appearances = ['light', 'dawn', 'dusk', 'dark'] as const;

test('Outdoors extends Streets and declares only what it changes', () => {
  const resolved = resolveMap(outdoors);
  assert.equal(Object.isFrozen(outdoors), true);
  assert.equal(outdoors.extends, streets);
  assert.deepEqual(resolved.icons, [streetsIcons, outdoorsIcons]);
  assert.equal(resolved.projection, resolveMap(streets).projection);
  assert.deepEqual(resolved.data, resolveMap(streets).data);
});

test('Outdoors offers the Streets times of day through its own complete themes', () => {
  const resolved = resolveMap(outdoors);
  assert.deepEqual(Object.keys(resolved.themes ?? {}).sort(), [...appearances].sort());
  assert.deepEqual(resolved.timeOfDay, {
    light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'},
  });
  assert.deepEqual(resolved.systemThemes, {light: 'light', dark: 'dark'});

  for (const name of appearances) {
    const theme = resolveTileflowTheme(outdoorsThemes[name]);
    const parent = resolveTileflowTheme(streetsThemes[name]);
    assert.equal(theme.colorScheme, parent.colorScheme);
    assert.deepEqual(theme.lighting, parent.lighting);
    assert.notEqual(theme.tokens.color['landcover.wood'], parent.tokens.color['landcover.wood']);
    for (const token of Object.keys(parent.tokens.color)) {
      assert.ok(token in theme.tokens.color, `${name} lost ${token}`);
    }
  }
});

test('Outdoors reads relief from hosted Terrain, drawing both hillshade and contours', () => {
  const {terrain} = resolveMap(outdoors);
  assert.ok(terrain && typeof terrain === 'object');
  assert.equal(terrain.mode, 'hillshade');
  assert.equal(terrain.tiles, undefined);
  assert.equal(terrain.contours?.demUrl, undefined);
  assert.ok(terrain.contours?.thresholds[13]);
  assert.match(terrain.attribution ?? '', /Mapterhorn/u);
});

test('Trails keep their ink where Streets would treat them as carriageways', () => {
  const roads = resolveMap(outdoors).modules?.roads;
  assert.ok(roads);
  for (const roadClass of ['footway', 'pathway', 'steps', 'track'] as const) {
    assert.ok(roads.classes?.[roadClass]?.surface?.fill?.dash, `${roadClass} is not dashed`);
  }
  assert.equal(roads.modifiers?.unpaved?.enabled, false);
  assert.equal(roads.restrictions?.access?.enabled, false);
  assert.deepEqual((roads.pathGround?.opacity as {value?: unknown}).value, 0);

  const stack = (roads as {renderStack?: Record<string, unknown>}).renderStack ?? {};
  for (const name of ['pathway-surface-fill', 'footway-bridge-casing', 'steps-surface-fill']) {
    assert.equal(name in stack, false, `Streets still refines ${name}`);
  }
  assert.ok('pedestrian-surface-fill' in stack);
});

test('Protected areas are outlined and summits carry their elevation', () => {
  const {land, landforms, poi} = resolveMap(outdoors).modules ?? {};
  assert.ok('protectedEdge' in ((land as {renderStack?: object}).renderStack ?? {}));
  assert.equal(landforms?.elevation, true);
  assert.ok(landforms?.classes?.peak?.icon);
  assert.equal(poi?.categories?.includes('retail'), false);
  assert.equal(poi?.categories?.includes('lodging'), true);
});
