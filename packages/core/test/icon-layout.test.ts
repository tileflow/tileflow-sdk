import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowIconAuthorMetadataSchema} from '../src/icon-appearance';
import {tileflowIconCompositionSchema} from '../src/icon-composition';
import {tileflowIconSpriteIndexSchema} from '../src/icon-sprite-index';

const layout = {stretchX: [[9, 15]], stretchY: [[9, 15]], content: [7, 7, 17, 17]};

test('fixed-color and SDF assets can independently declare text-fitting geometry', () => {
  for (const appearance of [
    {representation: 'rgba'},
    {representation: 'sdf', defaults: {color: '#245fe5'}},
  ]) {
    const result = tileflowIconAuthorMetadataSchema.parse({
      schemaVersion: 1,
      icons: {shield: {...appearance, layout}},
    });
    assert.deepEqual(result.icons.shield.layout, layout);
  }
});

test('native sprite geometry must be bounded, ordered and overlap its content', () => {
  const cell = {height: 24, width: 24, x: 0, y: 0, pixelRatio: 1};
  assert.deepEqual(tileflowIconSpriteIndexSchema.parse({shield: {...cell, ...layout}}).shield, {
    ...cell,
    ...layout,
  });
  for (const invalid of [
    {stretchX: []},
    {stretchX: [[9, 9]]},
    {stretchX: [[15, 9]]},
    {
      stretchX: [
        [9, 16],
        [15, 18],
      ],
    },
    {stretchX: [[0, 25]]},
    {stretchX: [[0.5, 9]]},
    {content: [10, 7, 8, 17]},
    {content: [7, 7, 25, 17]},
    {stretchX: [[1, 3]], content: [7, 7, 17, 17]},
  ]) {
    assert.equal(
      tileflowIconSpriteIndexSchema.safeParse({shield: {...cell, ...invalid}}).success,
      false,
      JSON.stringify(invalid),
    );
  }
  assert.equal(
    tileflowIconAuthorMetadataSchema.safeParse({
      schemaVersion: 1,
      icons: {shield: {representation: 'rgba', layout: {}}},
    }).success,
    false,
  );
});

test('composition layout must fit the verified winner dimensions', () => {
  const hash = 'a'.repeat(64);
  const receipt = {
    format: 'tileflow-icon-composition-v2',
    compositionVersion: 2,
    packageHash: hash,
    contributors: [
      {
        kind: 'icon-set',
        reference: '@acme/brand',
        teamId: 'org_acme',
        setId: 'ics_aaaaaaaaaaaaaaaa',
        versionId: 'icv_aaaaaaaaaaaaaaaa',
        version: 1,
        packageId: 'icp_aaaaaaaaaaaaaaaa',
        contentHash: hash,
        iconIds: ['shield'],
      },
    ],
    winners: [
      {
        id: 'shield',
        width: 24,
        height: 24,
        pixelSha256: {oneX: hash, twoX: hash},
        contributor: 0,
        layout,
      },
    ],
  };
  assert.equal(tileflowIconCompositionSchema.safeParse(receipt).success, true);
  receipt.winners[0].width = 12;
  assert.equal(tileflowIconCompositionSchema.safeParse(receipt).success, false);
});
