import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {openTileflowExternal, resolveTileflowExternalOpenInvocation} from '../src/open-external';

test('external opener never passes Windows targets through cmd or a shell', () => {
  const target = String.raw`C:\repo\evidence\a&whoami&rem.html`;
  assert.deepEqual(resolveTileflowExternalOpenInvocation(target, 'win32'), {
    command: 'explorer.exe',
    args: [target],
  });

  const calls: Array<{args: readonly string[]; command: string; options: object}> = [];
  let unreferenced = false;
  const child = new EventEmitter() as EventEmitter & {unref(): void};
  child.unref = () => {
    unreferenced = true;
  };
  openTileflowExternal(target, {
    platform: 'win32',
    spawn: (command, args, options) => {
      calls.push({args, command, options});
      return child;
    },
  });

  assert.deepEqual(calls, [
    {
      command: 'explorer.exe',
      args: [target],
      options: {detached: true, shell: false, stdio: 'ignore', windowsHide: true},
    },
  ]);
  assert.equal(unreferenced, true);
});

test('external opener selects direct macOS/Linux launchers and reports spawn errors', () => {
  assert.deepEqual(resolveTileflowExternalOpenInvocation('/tmp/report.html', 'darwin'), {
    command: 'open',
    args: ['/tmp/report.html'],
  });
  assert.deepEqual(resolveTileflowExternalOpenInvocation('/tmp/report.html', 'linux'), {
    command: 'xdg-open',
    args: ['/tmp/report.html'],
  });

  const expected = new Error('launcher unavailable');
  let received: unknown;
  openTileflowExternal('/tmp/report.html', {
    onError: (error) => {
      received = error;
    },
    spawn: () => {
      throw expected;
    },
  });
  assert.equal(received, expected);
});
