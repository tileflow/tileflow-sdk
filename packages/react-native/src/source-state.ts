import type {TileflowNativeSourceState} from '@tileflow/core/native';
import type {MapSourceState} from './contract';

/** Read only a canonical Core snapshot; never expose its URLs, style body or Error instance. */
export function projectMapSourceState(
  state: TileflowNativeSourceState | undefined,
): MapSourceState | undefined {
  if (!state) return undefined;
  if (state.status === 'loading')
    return Object.freeze({status: 'loading', generation: state.generation});
  if (state.status === 'error') {
    return Object.freeze({
      status: 'error',
      generation: state.generation,
      error: Object.freeze({
        code: state.error.code,
        field: state.error.field,
        kind: state.error.kind,
      }),
    });
  }
  return Object.freeze({
    status: 'ready',
    generation: state.generation,
    map: state.map.name,
    theme: Object.freeze({name: state.theme.name, colorScheme: state.theme.colorScheme}),
  });
}
