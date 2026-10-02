import assert from 'node:assert/strict';
import test from 'node:test';
import {staticRenderCompositionSchema} from '../src/manifest';

test('preserves verified layout while bounding native sprite geometry', () => {
  const layout = {stretchX: [[9, 15]], stretchY: [[9, 15]], content: [7, 7, 17, 17]};
  const composition = {
    schemaVersion: 1,
    anchors: {
      'above-water': null,
      'below-roads': null,
      'above-roads': null,
      'above-buildings': null,
      'below-labels': null,
      'above-labels': null,
    },
    icons: [{height: 24, width: 24, icon: 'shield', overlayIndex: 0, layout}],
  };
  assert.deepEqual(staticRenderCompositionSchema.parse(composition).icons[0].layout, layout);
  for (const invalid of [
    {stretchX: [[0, 25]]},
    {stretchY: [[15, 9]]},
    {stretchX: [[1, 3]], content: [7, 7, 17, 17]},
    {content: [7, 7, 25, 17]},
    {},
  ]) {
    assert.equal(
      staticRenderCompositionSchema.safeParse({
        ...composition,
        icons: [{...composition.icons[0], layout: invalid}],
      }).success,
      false,
    );
  }
});
