import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTileflowRouteInks,
  resolveTileflowTheme,
  tileflowDefaultRouteInks,
} from '@tileflow/core';
import {streets, streetsThemes} from '../src';

const knobs = streets.colorKnobs as Record<
  string,
  {reference?: string; tokens: Record<string, unknown>}
>;

test('Streets declares the colour knobs an application sets', () => {
  assert.deepEqual(Object.keys(knobs).sort(), [
    'accent',
    'buildings',
    'greenspace',
    'labelHalo',
    'labels',
    'land',
    'roads',
    'water',
  ]);
});

test('every knob token is a colour of every Streets theme, and no token has two knobs', () => {
  const owners = new Map<string, string>();
  for (const [name, knob] of Object.entries(knobs)) {
    assert.ok(knob.reference && Object.hasOwn(knob.tokens, knob.reference), `${name} reference`);
    for (const token of Object.keys(knob.tokens)) {
      assert.equal(owners.get(token), undefined, `${token} is governed twice`);
      owners.set(token, name);
    }
  }
  for (const [themeName, theme] of Object.entries(streetsThemes)) {
    const colors = resolveTileflowTheme(theme).tokens.color;
    for (const [token, knob] of owners) {
      assert.ok(Object.hasOwn(colors, token), `${themeName} has no ${token} (knob ${knob})`);
    }
  }
});

test('a route keeps the inks it had before Streets named them, in every theme', () => {
  for (const [name, theme] of Object.entries(streetsThemes)) {
    const resolved = resolveTileflowTheme(theme);
    assert.deepEqual(
      resolveTileflowRouteInks(resolved),
      tileflowDefaultRouteInks[resolved.colorScheme],
      name,
    );
  }
});
