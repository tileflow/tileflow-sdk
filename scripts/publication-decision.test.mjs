import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyPublicationState} from './publication-decision.mjs';

test('classifies idempotent registry retries and rejects tag or byte drift', () => {
  const release = {from: '0.1.0-alpha.16', to: '0.1.0-alpha.17'};
  assert.equal(
    classifyPublicationState({...release, currentTag: release.from, targetState: 'missing'}),
    'publish',
  );
  assert.equal(
    classifyPublicationState({...release, currentTag: release.to, targetState: 'identical'}),
    'published',
  );
  assert.throws(
    () =>
      classifyPublicationState({...release, currentTag: release.from, targetState: 'different'}),
    /different package contents/u,
  );
  assert.throws(
    () =>
      classifyPublicationState({...release, currentTag: release.from, targetState: 'identical'}),
    /cannot repair dist-tags/u,
  );
  assert.throws(
    () =>
      classifyPublicationState({
        ...release,
        currentTag: '0.1.0-alpha.15',
        targetState: 'missing',
      }),
    /Expected alpha/u,
  );
});
