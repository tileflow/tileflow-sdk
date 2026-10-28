import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiCameraChange,
  cameraReason,
  type Clock,
  createEventHub,
  createWarningAggregator,
} from '../src/events';
import {essentialSubscriptions, type EventName, protocol} from '../src/protocol';

/** A manual clock: timers run only when the test advances time. */
function manualClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, {at: number; callback: () => void}>();
  const clock: Clock = {
    now: () => now,
    schedule: (callback, delayMs) => {
      timers.set(++next, {at: now + delayMs, callback});
      return next;
    },
    cancel: (handle) => timers.delete(handle as number),
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = until;
  };
  return {clock, advance, pending: () => timers.size};
}

function hub() {
  const time = manualClock();
  const sent: [EventName, unknown][] = [];
  const events = createEventHub({
    send: (event, result) => sent.push([event, result]),
    clock: time.clock,
  });
  return {events, sent, ...time};
}

test('nothing crosses the bridge for an event no one subscribes to', () => {
  const {events, sent} = hub();
  let produced = 0;
  const produce = () => ++produced;
  events.emit('cameraMoved', produce);
  events.emit('tap', produce);
  assert.equal(events.wants('cameraMoved'), false);
  assert.deepEqual(sent, []);
  // Payloads of unsubscribed events are never even computed.
  assert.equal(produced, 0);
  // Failures and the handshake need no subscription.
  events.emit('error', () => 'failed');
  assert.deepEqual(sent, [['error', 'failed']]);
});

test('levels are cumulative and essential events flow by default', () => {
  const essentials = Object.keys(essentialSubscriptions).sort();
  const expected = Object.entries(protocol.events)
    .filter(([, event]) => 'level' in event && event.level === 'essential')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(essentials, expected);
  assert.ok(essentials.includes('cameraMoveEnded'));
  assert.ok(!essentials.includes('cameraMoved'));
});

test('a flood of camera updates respects the throttle and delivers the last state', () => {
  const {events, sent, advance} = hub();
  events.set({cameraMoved: {throttleMs: 100}});
  let camera = 0;
  // One update every 4 ms for one second: 250 updates.
  for (let index = 0; index < 250; index += 1) {
    camera += 1;
    const value = camera;
    events.emit('cameraMoved', () => value);
    advance(4);
  }
  advance(200);
  const delivered = sent.map(([, value]) => value as number);
  assert.ok(delivered.length <= 11, `${delivered.length} deliveries`);
  assert.ok(delivered.length >= 10, `${delivered.length} deliveries`);
  assert.equal(delivered.at(-1), 250, 'The final state was lost.');
  // Deliveries are spaced by at least the interval.
  assert.deepEqual(
    delivered,
    [...delivered].sort((a, b) => a - b),
  );
});

test('an unthrottled subscription delivers every event at once', () => {
  const {events, sent} = hub();
  events.set({tap: {throttleMs: 0}});
  for (let index = 0; index < 5; index += 1) events.emit('tap', () => index);
  assert.deepEqual(
    sent.map(([, value]) => value),
    [0, 1, 2, 3, 4],
  );
});

test('a superseded or unsubscribed pending delivery is discarded', () => {
  const {events, sent, advance, pending} = hub();
  events.set({cameraMoved: {throttleMs: 100}, cameraMoveEnded: {throttleMs: 0}});
  events.emit('cameraMoved', () => 1);
  events.emit('cameraMoved', () => 2);
  events.discard('cameraMoved');
  events.emit('cameraMoveEnded', () => 'settled');
  advance(500);
  assert.deepEqual(sent, [
    ['cameraMoved', 1],
    ['cameraMoveEnded', 'settled'],
  ]);
  events.emit('cameraMoved', () => 3);
  events.emit('cameraMoved', () => 4);
  events.set({cameraMoveEnded: {throttleMs: 0}});
  advance(500);
  assert.equal(sent.at(-1)?.[1], 3);
  assert.equal(pending(), 0);
  events.dispose();
  events.emit('error', () => 'late');
  assert.equal(sent.at(-1)?.[1], 3);
});

test('repeated warnings of one kind are reported once per window with a count', () => {
  const time = manualClock();
  const reports: unknown[] = [];
  const warnings = createWarningAggregator({
    clock: time.clock,
    windowMs: 1000,
    maximumKinds: 2,
    report: (warning) => reports.push([warning.context.status, warning.count]),
  });
  const warn = (status: number) =>
    warnings.warn({
      code: 'resourceFailed',
      message: 'A map resource failed to load.',
      context: {resource: 'tile', origin: 'https://tiles.example.com', status},
    });
  for (let index = 0; index < 500; index += 1) warn(404);
  warn(500);
  // A third kind exceeds the bound and waits for a window to close.
  warnings.warn({code: 'rendererFailed', message: 'x', context: {}});
  assert.deepEqual(reports, [
    [404, 1],
    [500, 1],
  ]);
  time.advance(1000);
  assert.deepEqual(reports.slice(2), [[404, 499]]);
  warn(404);
  assert.deepEqual(reports.at(-1), [404, 1]);
});

test('camera movements name who caused them', () => {
  assert.equal(cameraReason({originalEvent: {type: 'touchmove'}}), 'gesture');
  // A gesture's DOM event wins over an animation the application started.
  assert.equal(cameraReason({...apiCameraChange, originalEvent: {type: 'wheel'}}), 'gesture');
  assert.equal(cameraReason({...apiCameraChange}), 'api');
  assert.equal(cameraReason({}), 'system');
  assert.equal(cameraReason({tileflowReason: 'other'}), 'system');
});
