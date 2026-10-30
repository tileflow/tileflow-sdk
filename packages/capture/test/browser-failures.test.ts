import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import type {Browser} from 'playwright';
import {TileflowCaptureBrowserManager} from '../src/browser';
import {observeBrowserFailures} from './browser-failures';

test('browser diagnostics stream bounded failures before test cleanup', async (t) => {
  const messages: string[] = [];
  const failures = observeBrowserFailures(t, (message) => messages.push(message));
  const context = new EventEmitter();
  const browser = Object.assign(new EventEmitter(), {newContext: async () => context});
  const manager = new TileflowCaptureBrowserManager(
    {},
    {
      install: async () => undefined,
      launch: async () => browser as unknown as Browser,
    },
  );

  await manager.getBrowser();
  await browser.newContext();
  const page = new EventEmitter();
  context.emit('page', page);
  page.emit('pageerror', new Error('fixture browser failed'));
  assert.ok(messages.some((message) => message.includes('fixture browser failed')));
  page.emit('crash');
  browser.emit('disconnected');
  assert.ok(messages.some((message) => message.includes('crash')));
  assert.ok(messages.some((message) => message.includes('disconnected')));

  for (let index = 0; index < 100; index++) page.emit('pageerror', new Error('x'.repeat(2_000)));
  assert.equal(failures.length, 12);
  assert.ok(failures.every((message) => message.length <= 800));
  assert.ok(messages.length < 20);
});

test('browser diagnostics expose the launch cause before cleanup', async (t) => {
  const messages: string[] = [];
  observeBrowserFailures(t, (message) => messages.push(message));
  const manager = new TileflowCaptureBrowserManager(
    {},
    {
      install: async () => undefined,
      launch: async () => {
        throw new Error('fixture launch refused');
      },
    },
  );

  await assert.rejects(manager.getBrowser(), {code: 'BROWSER_START_FAILED'});
  assert.ok(messages.some((message) => message.includes('fixture launch refused')));
});
