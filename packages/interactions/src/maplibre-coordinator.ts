import type {TileflowInteractionState} from './contracts';
import type {TileflowMapLibreDomStateChangeReason} from './maplibre-dom';
import {tileflowInteractionTargetRefsEqual} from './reducer';

export type TileflowMapLibreInteractionParticipantKind = 'annotation' | 'semantic';

export type TileflowMapLibreInteractionParticipant = Readonly<{
  setInteractionState: (state: TileflowInteractionState) => void;
}>;

export type TileflowMapLibreInteractionCoordinatorOptions = Readonly<{
  defaultInteractionState?: TileflowInteractionState;
  interactionState?: TileflowInteractionState;
  onInteractionStateChange?: (
    state: TileflowInteractionState,
    previous: TileflowInteractionState,
    reason: TileflowMapLibreDomStateChangeReason,
  ) => void;
}>;

export type TileflowMapLibreInteractionCoordinator = Readonly<{
  attach: (
    kind: TileflowMapLibreInteractionParticipantKind,
    participant: TileflowMapLibreInteractionParticipant,
  ) => () => void;
  dispose: () => void;
  getInteractionState: () => TileflowInteractionState;
  /** Receives a controlled request from either mounted runtime. */
  requestInteractionState: (
    state: TileflowInteractionState,
    previous: TileflowInteractionState,
    reason: TileflowMapLibreDomStateChangeReason,
  ) => void;
  /** Commits a new application-controlled state to all mounted runtimes. */
  setInteractionState: (state: TileflowInteractionState) => void;
}>;

/**
 * Coordinates annotation and semantic runtimes around one popup state.
 * The non-owning runtime commits first, so replacement closes the old popup before opening the new
 * one. Framework adapters can therefore stay view bridges instead of reimplementing ordering.
 */
export function createTileflowMapLibreInteractionCoordinator(
  options: TileflowMapLibreInteractionCoordinatorOptions = {},
): TileflowMapLibreInteractionCoordinator {
  const controlled = options.interactionState !== undefined;
  let state =
    options.interactionState ?? options.defaultInteractionState ?? Object.freeze({popup: null});
  let disposed = false;
  let committing = false;
  const participants = new Map<
    TileflowMapLibreInteractionParticipantKind,
    TileflowMapLibreInteractionParticipant
  >();

  const commit = (next: TileflowInteractionState) => {
    if (committing) throw new Error('Tileflow interaction state commit is reentrant.');
    const previous = state;
    const attempted: TileflowMapLibreInteractionParticipant[] = [];
    committing = true;
    try {
      for (const kind of participantCommitOrder(next)) {
        const participant = participants.get(kind);
        if (!participant) continue;
        attempted.push(participant);
        participant.setInteractionState(next);
      }
      state = next;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const participant of attempted.reverse()) {
        try {
          participant.setInteractionState(previous);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          'Tileflow interaction state commit and rollback failed.',
        );
      }
      throw error;
    } finally {
      committing = false;
    }
  };

  return {
    attach(kind, participant) {
      assertActive(disposed);
      if (participants.has(kind)) {
        throw new Error(`Tileflow interaction participant "${kind}" is already attached.`);
      }
      participants.set(kind, participant);
      try {
        participant.setInteractionState(state);
      } catch (error) {
        participants.delete(kind);
        throw error;
      }
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        if (participants.get(kind) === participant) participants.delete(kind);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      participants.clear();
    },
    getInteractionState: () => state,
    requestInteractionState(next, _participantPrevious, reason) {
      assertActive(disposed);
      if (interactionStatesEqual(state, next)) return;
      const previous = state;
      if (!controlled) commit(next);
      options.onInteractionStateChange?.(next, previous, reason);
    },
    setInteractionState(next) {
      assertActive(disposed);
      if (interactionStatesEqual(state, next)) return;
      commit(next);
    },
  };
}

function participantCommitOrder(
  state: TileflowInteractionState,
): readonly TileflowMapLibreInteractionParticipantKind[] {
  return state.popup?.kind === 'annotation'
    ? ['semantic', 'annotation']
    : ['annotation', 'semantic'];
}

function interactionStatesEqual(
  left: TileflowInteractionState,
  right: TileflowInteractionState,
): boolean {
  return tileflowInteractionTargetRefsEqual(left.popup, right.popup);
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error('Tileflow interaction coordinator is disposed.');
}
