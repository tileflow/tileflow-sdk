import type {TileflowMapController} from '@tileflow/core';
import {createTileflowMapControllerBinding} from '@tileflow/core/browser';

export type TileflowMapRef = Pick<
  TileflowMapController,
  'addSource' | 'removeSource' | 'addLayer' | 'moveLayer' | 'removeLayer'
>;
type Binding = ReturnType<typeof createTileflowMapControllerBinding>;

/** Each renderer lifetime owns its queue; the component reference stays stable. */
export function createMapControllerOwner() {
  const create = () => ({
    binding: createTileflowMapControllerBinding({
      onError: (error) => console.error('Tileflow runtime style error', error),
    }),
    claimed: false,
    retired: false,
    failed: false,
  });
  let current = create();
  let closed = false;
  let lifetime = 0;
  const ref: TileflowMapRef = {
    addSource: (...args) => current.binding.controller.addSource(...args),
    removeSource: (...args) => current.binding.controller.removeSource(...args),
    addLayer: (...args) => current.binding.controller.addLayer(...args),
    moveLayer: (...args) => current.binding.controller.moveLayer(...args),
    removeLayer: (...args) => current.binding.controller.removeLayer(...args),
  };

  function reset() {
    current.binding.dispose();
    current = create();
  }

  function dispose() {
    closed = true;
    current.binding.dispose();
  }

  return {
    ref,
    reset,
    dispose,
    activate() {
      ++lifetime;
      if (closed) {
        closed = false;
        reset();
      }
      return () => {
        const retiring = ++lifetime;
        // Coalesce StrictMode's effect replay without losing the initial queue.
        void Promise.resolve().then(() => {
          if (retiring === lifetime) dispose();
        });
      };
    },
    prepare() {
      if (current.failed || current.retired) reset();
    },
    begin(): Binding {
      if (current.claimed || current.failed || current.retired) reset();
      current.claimed = true;
      return current.binding;
    },
    retire(binding: Binding) {
      binding.dispose();
      if (current.binding === binding) current.retired = true;
    },
    fail(error: Error, binding: Binding = current.binding) {
      binding.fail(error);
      if (current.binding === binding) current.failed = true;
    },
  };
}
