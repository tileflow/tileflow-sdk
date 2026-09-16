import assert from 'node:assert/strict';
import test from 'node:test';
import {createAdmissionInstallation} from '../src/admission-installation';
import type {NativeMapAdmission, NativeMapAdmissionInput} from '../src/native-admission-owner';

function barrier<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

const input: NativeMapAdmissionInput = {
  binding: {kind: 'direct'},
  resources: [],
  now: () => new Date(0),
  sessionIdFactory: () => 'map-fixture',
};

function fixture() {
  const installations: Array<{
    requests: Array<ReturnType<typeof barrier<NativeMapAdmission>>>;
    closed: number;
    removal?: ReturnType<typeof barrier<void>>;
  }> = [];
  const shared = createAdmissionInstallation(() => {
    const installation = {requests: [], closed: 0} as (typeof installations)[number];
    installations.push(installation);
    return {
      openMap() {
        const request = barrier<NativeMapAdmission>();
        installation.requests.push(request);
        return request.promise;
      },
      async dispose() {
        installation.closed++;
        await installation.removal?.promise;
      },
    };
  });
  return {shared, installations};
}

function context(id: string, retire: () => Promise<Readonly<{retired: true}>>): NativeMapAdmission {
  return {
    context: id,
    generation: 1,
    state: {status: 'active', context: id},
    discriminateForTest: (url) => url,
    retire,
  };
}

const acknowledged = async () => ({retired: true as const});

test('concurrent Maps share installation only and each retains its own context', async () => {
  const {shared, installations} = fixture();
  const first = shared.open(input);
  const second = shared.open(input);
  await Promise.resolve();
  assert.equal(installations.length, 1);
  assert.equal(installations[0]!.requests.length, 2);
  const retired: string[] = [];
  installations[0]!.requests[0]!.resolve(
    context('one', async () => {
      retired.push('one');
      return acknowledged();
    }),
  );
  installations[0]!.requests[1]!.resolve(
    context('two', async () => {
      retired.push('two');
      return acknowledged();
    }),
  );
  assert.notEqual(await first.ready, await second.ready);
  await first.retire();
  assert.deepEqual(retired, ['one']);
  assert.equal(installations[0]!.closed, 0);
  await second.retire();
  await second.retire();
  assert.deepEqual(retired, ['one', 'two']);
  assert.equal(installations[0]!.closed, 1);
});

test('retirement during registration waits for and retires the late native context', async () => {
  const {shared, installations} = fixture();
  const first = shared.open(input);
  await Promise.resolve();
  const failed = assert.rejects(first.ready, {code: 'NATIVE_ADMISSION_CANCELLED'});
  let settled = false;
  const retirement = first.retire().then(() => {
    settled = true;
  });
  await failed;
  assert.equal(settled, false);
  const ack = barrier<Readonly<{retired: true}>>();
  installations[0]!.requests[0]!.resolve(context('late', () => ack.promise));
  await Promise.resolve();
  assert.equal(installations[0]!.closed, 0);
  ack.resolve({retired: true});
  await retirement;
  assert.equal(settled, true);
  assert.equal(installations[0]!.closed, 1);
});

test('a failed context acknowledgement never disposes a neighboring Map', async () => {
  const {shared, installations} = fixture();
  const first = shared.open(input);
  const second = shared.open(input);
  await Promise.resolve();
  let calls = 0;
  installations[0]!.requests[0]!.resolve(
    context('one', async () => {
      if (++calls === 1) throw new Error('Untrusted native details.');
      return acknowledged();
    }),
  );
  installations[0]!.requests[1]!.resolve(context('two', acknowledged));
  await Promise.all([first.ready, second.ready]);
  await assert.rejects(first.retire(), {code: 'NATIVE_ADMISSION_UNAVAILABLE'});
  assert.equal(installations[0]!.closed, 0);
  await first.retire();
  assert.equal(calls, 2);
  assert.equal(installations[0]!.closed, 0);
  await second.retire();
  assert.equal(installations[0]!.closed, 1);
});

test('a new Map waits for removal and cannot install over an unacknowledged owner', async () => {
  const {shared, installations} = fixture();
  const first = shared.open(input);
  await Promise.resolve();
  installations[0]!.requests[0]!.resolve(context('one', acknowledged));
  await first.ready;
  installations[0]!.removal = barrier<void>();
  const retiring = first.retire();
  // Explicit retirement starts before creating the replacement.
  await Promise.resolve();
  await Promise.resolve();
  const second = shared.open(input);
  await Promise.resolve();
  assert.equal(installations.length, 1);
  installations[0]!.removal!.resolve();
  await retiring;
  await shared.whenIdle();
  assert.equal(installations.length, 2);
  installations[1]!.requests[0]!.resolve(context('two', acknowledged));
  await second.ready;
  await second.retire();
});

test('registration errors are redacted and a later Map can create a clean installation', async () => {
  const {shared, installations} = fixture();
  const first = shared.open(input);
  const failed = assert.rejects(first.ready, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Native resource admission failed.');
    assert.equal(error.cause, undefined);
    return true;
  });
  await Promise.resolve();
  installations[0]!.requests[0]!.reject(new Error('Untrusted request URL.'));
  await failed;
  await first.retire();
  assert.equal(installations[0]!.closed, 1);
});
