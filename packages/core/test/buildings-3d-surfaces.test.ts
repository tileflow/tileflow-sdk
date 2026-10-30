import assert from 'node:assert/strict';
import test from 'node:test';
import {buildings, createStyle, defineTheme, disable, fixed, parseTileflowMap, token} from '../src';
import {readTileflowBuildings3D} from '../src/buildings-3d-design';
import {
  readTileflowBuildingSurfaces,
  tileflowBuildingSurfaceTile,
} from '../src/buildings-3d-surfaces';
import {extendStreets, testLightTheme} from './map-fixture';

test('surface decoration survives config, theme resolution, compiled metadata and runtime parsing', () => {
  const map = extendStreets({
    themes: {
      light: defineTheme({
        ...testLightTheme,
        tokens: {...testLightTheme.tokens, number: {joints: 0.32}},
      }),
    },
    modules: {
      poi: disable(),
      buildings: buildings({
        flat: {fill: {color: token.color('surface.building')}},
        threeDimensional: {
          surfaces: {
            walls: {
              kind: 'brick',
              size: fixed([6, 3] as const, {reason: 'Physical block scale'}),
              contrast: token.number('joints'),
            },
            roof: {kind: 'tiles', size: fixed(10, {reason: 'Physical tile scale'}), contrast: 0.08},
            cornice: {height: fixed(0.7, {reason: 'Physical cornice scale'}), contrast: 0.3},
          },
        },
      }),
    },
  });
  const style = createStyle(map);
  const design = readTileflowBuildings3D(JSON.parse(JSON.stringify(style.metadata)))!;
  assert.equal(design.color, '#E6E3DA');
  assert.deepEqual(design.surfaces, {
    walls: {kind: 'brick', size: [6, 3], jointWidth: 0.12, contrast: 0.32},
    roof: {kind: 'tiles', size: 10, jointWidth: 0.12, contrast: 0.08},
    cornice: {height: 0.7, contrast: 0.3},
  });
  assert.equal(
    readTileflowBuildings3D(createStyle(extendStreets({modules: {poi: disable()}})).metadata)
      ?.surfaces,
    undefined,
  );
});

test('authored surface dimensions and contrasts reject invalid values before rendering', () => {
  for (const surfaces of [
    {walls: {kind: 'wood'}},
    {walls: {kind: 'brick', size: [0, 3]}},
    {walls: {kind: 'brick', jointWidth: -1}},
    {roof: {kind: 'tiles', size: Infinity}},
    {roof: {kind: 'tiles', contrast: 1.5}},
    {cornice: {height: NaN}},
  ])
    assert.throws(() =>
      parseTileflowMap(
        extendStreets({
          modules: {buildings: buildings({threeDimensional: {surfaces: surfaces as never}})},
        }),
      ),
    );
});

test('untrusted metadata cannot produce zero periods, non-finite uniforms or oversized joints', () => {
  assert.equal(readTileflowBuildingSurfaces({walls: {kind: 'unknown'}}), undefined);
  const safe = readTileflowBuildingSurfaces({
    walls: {kind: 'brick', size: [0.5, 0.5], jointWidth: 2, contrast: Infinity},
    roof: {kind: 'tiles', size: NaN, jointWidth: -1},
    cornice: {height: -1, contrast: 0},
  })!;
  assert.equal(safe.walls?.jointWidth, 0.125);
  assert.equal(safe.walls?.contrast, 0.2);
  assert.equal(safe.roof?.size, 8);
  assert.equal(safe.cornice?.contrast, 0);
});

test('roof grids join adjacent tiles and preserve phase across tile zoom changes', () => {
  const mod = (v: number, size: number) => ((v % size) + size) % size;
  const nearPhase = (a: number, b: number, size: number) => {
    const delta = Math.abs(mod(a, size) - mod(b, size));
    assert.ok(Math.min(delta, size - delta) < 1e-6, `${a}, ${b}`);
  };
  for (const size of [0.5, 8, 10, 100])
    for (const z of [13, 15, 17]) {
      const x = Math.floor(0.49 * 2 ** z),
        y = Math.floor(0.38 * 2 ** z);
      const [px, py, metres] = tileflowBuildingSurfaceTile(x, y, z, size);
      const nextX = tileflowBuildingSurfaceTile(x + 1, y, z, size);
      const nextY = tileflowBuildingSurfaceTile(x, y + 1, z, size);
      nearPhase(px + 8192 * metres, nextX[0], size);
      nearPhase(py + 8192 * metres, nextY[1], size);
      const child = tileflowBuildingSurfaceTile(x * 2, y * 2, z + 1, size);
      nearPhase(px + 2000 * metres, child[0] + 4000 * child[2], size);
    }
});
