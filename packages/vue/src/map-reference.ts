import type {TileflowMapController} from '@tileflow/core';
import {createTileflowMapControllerBinding, TileflowMapError} from '@tileflow/core/browser';

export type TileflowMapRef = Pick<
  TileflowMapController,
  'addSource' | 'removeSource' | 'addLayer' | 'moveLayer' | 'removeLayer'
>;

/** The component reference stays stable; each renderer gets its own queued controller. */
export function createTileflowMapReference(imageMode: boolean, onError?: (error: Error) => void) {
  let failure: Error | undefined;
  let disposed = false;
  const create = () =>
    createTileflowMapControllerBinding({
      onError(error) {
        if (!disposed) failure ??= error;
        (onError ?? console.error)(error);
      },
    });
  let binding = create();
  let image = imageMode;

  const reference: TileflowMapRef = {
    addSource: (...args) =>
      failure ? Promise.reject(failure) : binding.controller.addSource(...args),
    removeSource: (...args) =>
      failure ? Promise.reject(failure) : binding.controller.removeSource(...args),
    addLayer: (...args) =>
      failure ? Promise.reject(failure) : binding.controller.addLayer(...args),
    moveLayer: (...args) =>
      failure ? Promise.reject(failure) : binding.controller.moveLayer(...args),
    removeLayer: (...args) =>
      failure ? Promise.reject(failure) : binding.controller.removeLayer(...args),
  };

  const fail = (error: Error) => {
    if (disposed) return;
    failure ??= error;
    binding.fail(failure);
  };

  const start = (nextImage: boolean, replace = false) => {
    if (disposed) return binding;
    if (replace || image !== nextImage) {
      binding.dispose();
      failure = undefined;
      binding = create();
      image = nextImage;
    }
    if (image) {
      fail(
        new TileflowMapError('invalidRequest', {
          reason: 'unsupportedMode',
          message: 'Use mode="interactive" to add or change runtime sources and layers.',
        }),
      );
    }
    return binding;
  };
  start(image);

  return {
    reference,
    start,
    fail,
    get failed() {
      return failure !== undefined;
    },
    get current() {
      return binding;
    },
    dispose() {
      disposed = true;
      failure = undefined;
      binding.dispose();
    },
  };
}
