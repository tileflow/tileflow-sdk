import {createTileflowMapControllerBinding, TileflowMapError} from '@tileflow/core/browser';

/**
 * The component reference stays stable; each renderer gets its own queued controller.
 * @param {boolean} imageMode
 * @param {(error: Error) => void} [onError]
 */
export function createTileflowMapReference(imageMode, onError) {
  /** @type {Error | undefined} */
  let failure;
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

  /** @type {import('./index.js').TileflowMapRef} */
  const reference = {
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

  /** @param {Error} error */
  const fail = (error) => {
    if (disposed) return;
    failure ??= error;
    binding.fail(failure);
  };

  /** @param {boolean} nextImage @param {boolean} [replace] */
  const start = (nextImage, replace = false) => {
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
