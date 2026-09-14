import {resolveTileflowNativeInitialView} from '@tileflow/core/native';
import type {MapInitialViewInputs, MapView} from './contract';

/** Delegate the accepted data composition; camera ownership and component prop names are separate. */
export function resolveMapInitialView(inputs: MapInitialViewInputs): MapView {
  return resolveTileflowNativeInitialView(inputs);
}
