import {meshTileflowBuildings, type TileflowBuildingMeshOptions} from './buildings-3d-mesh';
import {prepareBuildingTile, preparedBuildingTileTransfer} from './buildings-3d-tile';
import type {TileflowTileLayer} from './vector-tile-decode';

// Built into the browser entry as a self-contained classic worker, with no runtime imports.
const scope = globalThis as unknown as {
  onmessage: (
    event: MessageEvent<{layer: TileflowTileLayer; options: TileflowBuildingMeshOptions}>,
  ) => void;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = ({data}) => {
  try {
    const mesh = meshTileflowBuildings(data.layer, data.options);
    const tile = mesh && prepareBuildingTile(mesh);
    scope.postMessage({tile}, tile ? preparedBuildingTileTransfer(tile) : []);
  } catch (error) {
    scope.postMessage({error: String(error)});
  }
};
