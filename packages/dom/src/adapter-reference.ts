import {TileflowRuntimeStyleError} from '@tileflow/core/browser';
import type {TileflowMapRef} from './runtime-style';

/** Keeps a component reference stable while its DOM controller mounts or is replaced. */
export function createTileflowAdapterReference(imageMode = false) {
  let target: TileflowMapRef | undefined;
  let closed = false;
  const waiting = new Set<{
    run(target: TileflowMapRef): void;
    reject(error: Error): void;
  }>();

  function invoke(run: (target: TileflowMapRef) => Promise<void>): Promise<void> {
    if (closed) return Promise.reject(new TileflowRuntimeStyleError('disposed'));
    if (imageMode)
      return Promise.reject(
        new TileflowRuntimeStyleError('invalidRequest', {reason: 'unsupportedMode'}),
      );
    if (target) return run(target);

    return new Promise((resolve, reject) => {
      waiting.add({run: (next) => void run(next).then(resolve, reject), reject});
    });
  }

  const reference: TileflowMapRef = {
    addSource: (...args) => invoke((next) => next.addSource(...args)),
    removeSource: (...args) => invoke((next) => next.removeSource(...args)),
    addLayer: (...args) => invoke((next) => next.addLayer(...args)),
    moveLayer: (...args) => invoke((next) => next.moveLayer(...args)),
    removeLayer: (...args) => invoke((next) => next.removeLayer(...args)),
  };

  return {
    reference,
    setImageMode(next: boolean) {
      imageMode = next;
    },
    attach(next: TileflowMapRef) {
      closed = false;
      target = next;
      for (const pending of waiting) pending.run(next);
      waiting.clear();
    },
    detach(previous: TileflowMapRef) {
      if (target !== previous) return;
      target = undefined;
      closed = true;
      for (const pending of waiting) pending.reject(new TileflowRuntimeStyleError('disposed'));
      waiting.clear();
    },
  };
}
