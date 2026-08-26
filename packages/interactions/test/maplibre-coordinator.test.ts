import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionState} from '../src/contracts';
import {createTileflowMapLibreInteractionCoordinator} from '../src/maplibre-coordinator';

const closed: TileflowInteractionState = {popup: null};
const annotationOpen: TileflowInteractionState = {
  popup: {id: 'property-1', kind: 'annotation'},
};
const semanticOpen: TileflowInteractionState = {
  popup: {domain: 'poi', featureId: 'poi-1', kind: 'semantic-feature'},
};

test('commits the non-owning runtime first when replacing popup kinds', () => {
  const calls: string[] = [];
  const coordinator = createTileflowMapLibreInteractionCoordinator();
  coordinator.attach('annotation', {
    setInteractionState(state) {
      calls.push(`annotation:${state.popup?.kind ?? 'closed'}`);
    },
  });
  coordinator.attach('semantic', {
    setInteractionState(state) {
      calls.push(`semantic:${state.popup?.kind ?? 'closed'}`);
    },
  });
  calls.length = 0;

  coordinator.requestInteractionState(annotationOpen, closed, 'popup:open');
  coordinator.requestInteractionState(semanticOpen, annotationOpen, 'popup:open');

  assert.deepEqual(calls, [
    'semantic:annotation',
    'annotation:annotation',
    'annotation:semantic-feature',
    'semantic:semantic-feature',
  ]);
  coordinator.dispose();
});

test('controlled coordination emits a request and waits for the application commit', () => {
  const calls: string[] = [];
  const requests: TileflowInteractionState[] = [];
  const coordinator = createTileflowMapLibreInteractionCoordinator({
    interactionState: closed,
    onInteractionStateChange: (state) => requests.push(state),
  });
  coordinator.attach('semantic', {
    setInteractionState(state) {
      calls.push(state.popup?.kind ?? 'closed');
    },
  });
  calls.length = 0;

  coordinator.requestInteractionState(semanticOpen, closed, 'popup:open');
  assert.deepEqual(requests, [semanticOpen]);
  assert.deepEqual(calls, []);
  assert.deepEqual(coordinator.getInteractionState(), closed);

  coordinator.setInteractionState(semanticOpen);
  assert.deepEqual(calls, ['semantic-feature']);
  assert.deepEqual(coordinator.getInteractionState(), semanticOpen);
  coordinator.dispose();
});

test('attach, detach, duplicate participants, and disposal are deterministic', () => {
  const coordinator = createTileflowMapLibreInteractionCoordinator({
    defaultInteractionState: annotationOpen,
  });
  const calls: TileflowInteractionState[] = [];
  const detach = coordinator.attach('annotation', {
    setInteractionState: (state) => calls.push(state),
  });
  assert.deepEqual(calls, [annotationOpen]);
  assert.throws(
    () => coordinator.attach('annotation', {setInteractionState: () => undefined}),
    /already attached/u,
  );
  detach();
  detach();
  coordinator.setInteractionState(closed);
  assert.deepEqual(calls, [annotationOpen]);
  coordinator.dispose();
  coordinator.dispose();
  assert.throws(() => coordinator.setInteractionState(annotationOpen), /disposed/u);
});

test('a failed participant commit rolls back every attempted participant and remains retryable', () => {
  const calls: string[] = [];
  let shouldFail = true;
  const coordinator = createTileflowMapLibreInteractionCoordinator();
  coordinator.attach('annotation', {
    setInteractionState(state) {
      calls.push(`annotation:${state.popup?.kind ?? 'closed'}`);
    },
  });
  coordinator.attach('semantic', {
    setInteractionState(state) {
      calls.push(`semantic:${state.popup?.kind ?? 'closed'}`);
      if (state.popup && shouldFail) throw new Error('semantic commit failed');
    },
  });
  calls.length = 0;

  assert.throws(() => coordinator.setInteractionState(annotationOpen), /semantic commit failed/u);
  assert.deepEqual(coordinator.getInteractionState(), closed);
  assert.deepEqual(calls, ['semantic:annotation', 'semantic:closed']);

  shouldFail = false;
  coordinator.setInteractionState(annotationOpen);
  assert.deepEqual(coordinator.getInteractionState(), annotationOpen);
  assert.deepEqual(calls, [
    'semantic:annotation',
    'semantic:closed',
    'semantic:annotation',
    'annotation:annotation',
  ]);
});

test('a later participant failure rolls back both the failed and already committed participant', () => {
  const calls: string[] = [];
  const coordinator = createTileflowMapLibreInteractionCoordinator();
  coordinator.attach('annotation', {
    setInteractionState(state) {
      calls.push(`annotation:${state.popup?.kind ?? 'closed'}`);
    },
  });
  coordinator.attach('semantic', {
    setInteractionState(state) {
      calls.push(`semantic:${state.popup?.kind ?? 'closed'}`);
      if (state.popup?.kind === 'semantic-feature') throw new Error('semantic commit failed');
    },
  });
  calls.length = 0;

  assert.throws(() => coordinator.setInteractionState(semanticOpen), /semantic commit failed/u);
  assert.deepEqual(coordinator.getInteractionState(), closed);
  assert.deepEqual(calls, [
    'annotation:semantic-feature',
    'semantic:semantic-feature',
    'semantic:closed',
    'annotation:closed',
  ]);
});

test('surfaces rollback failures without publishing a ghost state', () => {
  let call = 0;
  const coordinator = createTileflowMapLibreInteractionCoordinator();
  coordinator.attach('semantic', {
    setInteractionState(state) {
      call += 1;
      if (state.popup) throw new Error('commit failed');
      if (call > 2) throw new Error('rollback failed');
    },
  });

  assert.throws(
    () => coordinator.setInteractionState(annotationOpen),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.some((candidate) => String(candidate).includes('commit failed')) &&
      error.errors.some((candidate) => String(candidate).includes('rollback failed')),
  );
  assert.deepEqual(coordinator.getInteractionState(), closed);
});
