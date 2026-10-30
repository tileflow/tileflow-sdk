import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildingFloodLightShare,
  readBuildingFloodLight,
  readModelRoleLighting,
} from '../src/building-illumination';
import {meshTileflowBuildings} from '../src/buildings-3d-mesh';
import {sampleModelRole} from '../src/models-3d-role-lighting';
import {resolveTileflowSun} from '../src/sun';

test('architectural flood lighting fades with physical scene brightness independently of palette', () => {
  const sun = (intensity: number) =>
    resolveTileflowSun({
      azimuth: 180,
      altitude: 0,
      color: '#ffffff',
      intensity: 0,
      shadowIntensity: 0,
      ambient: {color: '#ffffff', intensity},
    });
  assert.equal(buildingFloodLightShare(sun(0)), 1);
  assert.equal(buildingFloodLightShare(sun(0.03)), 1);
  assert.ok(Math.abs(buildingFloodLightShare(sun(0.041)) - 0.5) < 1e-6);
  assert.equal(buildingFloodLightShare(sun(0.052)), 0);
  assert.equal(buildingFloodLightShare(sun(1)), 0);
});

test('compiled architectural and model lights have bounded independent defaults', () => {
  const flood = readBuildingFloodLight({intensity: 0.3})!;
  assert.deepEqual(flood.groundRadius, [30, 100]);
  assert.equal(flood.minGroundHeight, 30);
  assert.equal(flood.minWallHeight, 200);
  assert.equal(readBuildingFloodLight({intensity: Infinity})!.intensity, 0);
  assert.deepEqual(readBuildingFloodLight({groundRadius: [100, 30]})!.groundRadius, [30, 100]);
  const roles = readModelRoleLighting({
    wall: {emissiveStrength: 0.1, emissiveHeight: [0.5, 0, 0, 1, 0.8]},
    roof: {emissiveStrength: 0},
  });
  assert.equal(roles!.wall!.emissiveStrength, 0.1);
  assert.equal(roles!.roof!.emissiveStrength, 0);
  assert.equal(roles!.window, undefined);
});

test('physical role profiles keep material controls and emission independent', () => {
  const role = readModelRoleLighting({
    door: {
      shading: 'map',
      ambientOcclusion: 0.3,
      partColorMix: 0,
      color: '#ffeedd',
      colorMix: 0.6,
      metallic: 0.2,
      roughness: 0.8,
      emissiveStrength: 2.5,
      emissiveVariation: 0.3,
    },
    window: {
      colorVariation: {hue: [0, 90], saturation: [20, 100], lightness: [87, 87], space: 'linear'},
    },
  })!;
  assert.equal(role.door!.color, '#ffeedd');
  assert.equal(role.door!.shading, 'map');
  assert.equal(role.door!.ambientOcclusion, 0.3);
  assert.equal(role.door!.partColorMix, 0);
  assert.equal(role.window!.shading, undefined);
  const invalid = readModelRoleLighting({
    wall: {shading: 'unknown', ambientOcclusion: Infinity, partColorMix: -1},
  })!.wall!;
  assert.equal(invalid.shading, undefined);
  assert.equal(invalid.ambientOcclusion, 1);
  assert.equal(invalid.partColorMix, 1);
  assert.equal(role.door!.colorMix, 0.6);
  assert.equal(role.door!.metallic, 0.2);
  assert.equal(role.door!.roughness, 0.8);
  assert.equal(role.door!.emissiveStrength, 2.5);
  assert.equal(role.door!.emissiveVariation, 0.3);
  assert.deepEqual(role.window!.colorVariation, {
    hue: [0, 90],
    saturation: [20, 100],
    lightness: [87, 87],
    space: 'linear',
  });
  assert.deepEqual(
    sampleModelRole({...role.window!, color: '#ffffff'}, 'shared-window').color,
    [1, 1, 1],
  );
});

test('an identified building keeps its lighting variation across tiles and feature order', () => {
  const feature = (geometry: number[]) => ({
    id: 9523,
    type: 'Polygon' as const,
    properties: {render_height: 35},
    geometry: [geometry],
  });
  const left = feature([0, 100, 100, 100, 100, 200, 0, 200, 0, 100]);
  const right = feature([8092, 100, 8192, 100, 8192, 200, 8092, 200, 8092, 100]);
  const a = meshTileflowBuildings({extent: 8192, features: [left]}, {tileMetres: 1000})!;
  const b = meshTileflowBuildings(
    {extent: 8192, features: [{...left, id: 5}, right]},
    {tileMetres: 1000},
  )!;
  const samples = (vertices: Uint8Array, featureIndex: number) => {
    const values: number[] = [];
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    for (let at = 0; at < vertices.length; at += 28)
      if (view.getUint16(at + 24, true) === featureIndex) values.push(vertices[at + 14]!);
    return new Set(values);
  };
  assert.deepEqual(samples(a.vertices, 0), samples(b.vertices, 1));
});
