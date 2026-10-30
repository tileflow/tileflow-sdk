import {readFileSync} from 'node:fs';
import {encodeTileflowTreeModel} from '@tileflow/core';
import {prepareTileflowTreeModelMesh} from '../../dev/src/tree-model-mesh';

export const streetsTreeForms = [
  'round',
  'open',
  'tall',
  'conifer',
  'columnar',
  'palm-feather',
  'palm-fan',
] as const;
export const streetsTreeIconIds = streetsTreeForms.flatMap((form) => [
  `streets-tree-${form}`,
  `streets-tree-${form}-dark`,
]);
export const streetsPreparedModels = Object.fromEntries(
  streetsTreeForms.map((form) => {
    const id = `streets-tree-${form}`;
    const prepare = (level: 'near' | 'far') =>
      encodeTileflowTreeModel(
        prepareTileflowTreeModelMesh(
          readFileSync(
            new URL(
              `../assets/streets/models/${id}${level === 'far' ? '.far' : ''}.glb`,
              import.meta.url,
            ),
          ),
          level,
        ),
        level,
      );
    return [id, {near: prepare('near'), far: prepare('far')}];
  }),
);
