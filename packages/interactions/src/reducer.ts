import type {
  TileflowInteractionAction,
  TileflowInteractionState,
  TileflowInteractionTargetRef,
} from './contracts';

export const initialTileflowInteractionState: TileflowInteractionState = Object.freeze({
  popup: null,
});

export function reduceTileflowInteractionState(
  state: TileflowInteractionState,
  action: TileflowInteractionAction,
): TileflowInteractionState {
  if (action.type === 'close-popup') {
    return state.popup === null ? state : {popup: null};
  }

  if (tileflowInteractionTargetRefsEqual(state.popup, action.target)) {
    return state;
  }

  return {popup: action.target};
}

export function tileflowInteractionTargetRefsEqual(
  left: TileflowInteractionTargetRef | null,
  right: TileflowInteractionTargetRef | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.kind !== right.kind) return false;

  switch (left.kind) {
    case 'annotation':
      return left.id === (right as Extract<TileflowInteractionTargetRef, {kind: 'annotation'}>).id;
    case 'semantic-feature': {
      const candidate = right as Extract<TileflowInteractionTargetRef, {kind: 'semantic-feature'}>;
      return left.domain === candidate.domain && left.featureId === candidate.featureId;
    }
    case 'style-feature': {
      const candidate = right as Extract<TileflowInteractionTargetRef, {kind: 'style-feature'}>;
      return left.layerId === candidate.layerId && left.featureId === candidate.featureId;
    }
    case 'map': {
      const candidate = right as Extract<TileflowInteractionTargetRef, {kind: 'map'}>;
      return (
        left.coordinate[0] === candidate.coordinate[0] &&
        left.coordinate[1] === candidate.coordinate[1]
      );
    }
  }
}
