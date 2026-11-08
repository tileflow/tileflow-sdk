import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowAnnotationClusterIndex} from '../src';
import type {TileflowAnnotation} from '../src/contracts';

const annotation = (id: string, coordinate: [number, number]): TileflowAnnotation => ({
  ariaLabel: id,
  coordinate,
  id,
  kind: 'marker',
});

const annotations = [
  annotation('a', [-3.7, 40.4]),
  annotation('b', [-3.7001, 40.4001]),
  annotation('far', [2.17, 41.38]),
];

test('groups nearby annotations and names the ones each group hides', () => {
  const index = createTileflowAnnotationClusterIndex(annotations, {clusterMaxZoom: 10});
  const view = index.at(4.6);

  assert.equal(view.clusters.length, 1);
  const [cluster] = view.clusters;
  assert.deepEqual([...cluster!.annotationIds].sort(), ['a', 'b']);
  assert.equal(cluster!.pointCount, 2);
  assert.equal(cluster!.label, '2');
  assert.ok(cluster!.expansionZoom > 4);
  assert.deepEqual([...view.hiddenAnnotationIds].sort(), ['a', 'b']);
  assert.equal(index.at(4.1), view);
});

test('above clusterMaxZoom every annotation is separate', () => {
  const view = createTileflowAnnotationClusterIndex(annotations, {clusterMaxZoom: 10}).at(11);

  assert.equal(view.clusters.length, 0);
  assert.equal(view.hiddenAnnotationIds.size, 0);
});
