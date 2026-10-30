import {
  cameraTileResultTransfer,
  type CameraTileTask,
  cameraTileTaskLayers,
  createDecodedCameraTiles,
  runCameraTileTask,
} from './camera-tile-tasks';

// Built into the browser entry as a self-contained classic worker, with no runtime imports.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{url: string; bytes: Uint8Array; task: CameraTileTask}>) => void;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
const tiles = createDecodedCameraTiles();
scope.onmessage = ({data: {url, bytes, task}}) => {
  try {
    const result = runCameraTileTask(task, tiles.read(url, bytes, cameraTileTaskLayers(task)));
    scope.postMessage({result}, cameraTileResultTransfer(task.kind, result));
  } catch (error) {
    scope.postMessage({error: String(error)});
  }
};
