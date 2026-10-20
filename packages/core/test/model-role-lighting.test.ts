import assert from 'node:assert/strict';
import test from 'node:test';
import {modelEmitterGeometry} from '../src/models-3d-emitters';
import {sampleModelRole} from '../src/models-3d-role-lighting';

test('role variation follows model identity, stays bounded, and does not depend on palette slots', () => {
  const profile = {
    emissiveStrength: 0.5,
    emissiveVariation: 0.3,
    emissiveHeight: [0, 1, 0, 1, 0] as const,
    colorVariation: {
      hue: [0, 90] as const,
      saturation: [20, 100] as const,
      lightness: [87, 87] as const,
      space: 'linear' as const,
    },
  };
  const first = sampleModelRole(profile, 'landmark:window');
  assert.deepEqual(first, sampleModelRole({...profile}, 'landmark:window'));
  assert.notDeepEqual(first, sampleModelRole(profile, 'another:window'));
  assert.ok(first.strength >= 0.5 && first.strength < 0.8);
  assert.ok(first.color!.every((c) => c >= 0 && c <= 1));
  assert.equal(sampleModelRole(undefined, 'landmark:lamp').strength, 0);
});

test('explicit emitter reach is bounded and follows its directed lower edge', () => {
  const light = {
    start: [-1, 0, 0] as const,
    end: [1, 0, 0] as const,
    height: 3,
    role: 'door' as const,
    part: 'accent' as const,
  };
  assert.equal(modelEmitterGeometry(light).reach, 4);
  assert.equal(modelEmitterGeometry({...light, height: 20}).reach, 10);
  const ground = modelEmitterGeometry(light).positions;
  assert.ok(ground[7]! < 0, 'the spill is on the right of the directed edge');
  const reversed = modelEmitterGeometry({...light, start: light.end, end: light.start}).positions;
  assert.ok(reversed[7]! > 0);
  assert.ok(modelEmitterGeometry({...light, depth: 10}).positions.every(Number.isFinite));
});
