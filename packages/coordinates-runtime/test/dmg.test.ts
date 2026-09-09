import assert from 'node:assert/strict';
import {chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {
  type CoordinatesDmgCommand,
  type CoordinatesDmgCommandResult,
  CoordinatesDmgError,
  createCoordinatesDmgExtractor,
} from '../src/dmg';
import {hashFile} from '../src/identity';

const executable = Buffer.from('coordinates-engine');
const database = Buffer.from('proj database');

test('verifies and copies only a declared payload with resource and extended-attribute ditto flags', async () => {
  const fixture = await createFixture();
  try {
    await fixture.extract({kind: 'development'});
    assert.deepEqual(await readFile(join(fixture.destination, 'bin/coordinates')), executable);
    assert.deepEqual(await readFile(join(fixture.destination, 'resources/proj.db')), database);
    assert.equal(
      Boolean((await lstat(join(fixture.destination, 'bin/coordinates'))).mode & 0o111),
      true,
    );
    assert.deepEqual(
      fixture.commands.map((command) => [command.file, command.args.slice(0, 2)]),
      [
        ['/usr/bin/hdiutil', ['verify', fixture.artifactPath]],
        ['/usr/bin/hdiutil', ['attach', fixture.artifactPath]],
        ['/usr/bin/ditto', ['--rsrc', '--extattr']],
        ['/usr/bin/hdiutil', ['detach', fixture.mountpoint]],
      ],
    );
    assert.equal(
      fixture.commands[1]!.args.includes('-readonly') &&
        fixture.commands[1]!.args.includes('-nobrowse') &&
        fixture.commands[1]!.args.includes('-noautoopen'),
      true,
    );
    assert.equal(fixture.commands[2]!.args.includes('--qtn'), true);
    assert.equal(fixture.commands[2]!.timeoutMs, 15 * 60 * 1000);
  } finally {
    await fixture.close();
  }
});

test('checks Developer ID, TeamIdentifier, and assessment before mounting a public DMG', async () => {
  const fixture = await createFixture();
  try {
    await fixture.extract({kind: 'apple-notarized-dmg', teamIdentifier: 'ABCDEFGHIJ'});
    assert.deepEqual(
      fixture.commands.slice(0, 5).map((command) => command.file),
      [
        '/usr/bin/codesign',
        '/usr/bin/codesign',
        '/usr/sbin/spctl',
        '/usr/bin/hdiutil',
        '/usr/bin/hdiutil',
      ],
    );
  } finally {
    await fixture.close();
  }
});

test('rejects a mismatched public TeamIdentifier before hdiutil attaches', async () => {
  const fixture = await createFixture({teamIdentifier: 'ZZZZZZZZZZ'});
  try {
    await assert.rejects(
      fixture.extract({kind: 'apple-notarized-dmg', teamIdentifier: 'ABCDEFGHIJ'}),
      (error: unknown) =>
        error instanceof CoordinatesDmgError && error.code === 'DMG_TRUST_INVALID',
    );
    assert.equal(
      fixture.commands.some((command) => command.args[0] === 'attach'),
      false,
    );
  } finally {
    await fixture.close();
  }
});

test('detaches after a copy failure and removes the staging directory', async () => {
  const fixture = await createFixture({copyFails: true});
  try {
    await assert.rejects(
      fixture.extract({kind: 'development'}),
      (error: unknown) => error instanceof CoordinatesDmgError && error.code === 'DMG_COPY_FAILED',
    );
    assert.equal(
      fixture.commands.some((command) => command.args[0] === 'detach'),
      true,
    );
    await assert.rejects(lstat(fixture.destination));
  } finally {
    await fixture.close();
  }
});

test('a detach failure preserves its mountpoint and overrides an earlier extraction failure', async () => {
  const fixture = await createFixture({copyFails: true, detachFails: true});
  try {
    await assert.rejects(
      fixture.extract({kind: 'development'}),
      (error: unknown) =>
        error instanceof CoordinatesDmgError && error.code === 'DMG_DETACH_FAILED',
    );
    assert.equal((await lstat(fixture.mountpoint)).isDirectory(), true);
  } finally {
    await fixture.close();
  }
});

test('rejects extra files and links from the mounted payload before copying', async () => {
  for (const input of [{extraPayload: true}, {linkPayload: true}]) {
    const fixture = await createFixture(input);
    try {
      await assert.rejects(
        fixture.extract({kind: 'development'}),
        (error: unknown) =>
          error instanceof CoordinatesDmgError && error.code === 'DMG_PAYLOAD_INVALID',
      );
      assert.equal(
        fixture.commands.some((command) => command.file === '/usr/bin/ditto'),
        false,
      );
      assert.equal(
        fixture.commands.some((command) => command.args[0] === 'detach'),
        true,
      );
    } finally {
      await fixture.close();
    }
  }
});

test('aborting an injected command is bounded and still attempts detach', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-dmg-abort-'));
  const destination = join(directory, 'stage');
  const controller = new AbortController();
  const commands: CoordinatesDmgCommand[] = [];
  let attachStarted: (() => void) | undefined;
  const extract = createCoordinatesDmgExtractor(async (command) => {
    commands.push(command);
    if (command.args[0] === 'attach') {
      attachStarted?.();
      return await new Promise<CoordinatesDmgCommandResult>(() => undefined);
    }
    return {code: 0, stderr: '', stdout: ''};
  });
  try {
    const attached = new Promise<void>((resolve) => {
      attachStarted = resolve;
    });
    const pending = extract({
      artifactPath: join(directory, 'artifact.dmg'),
      destination,
      files: await manifest(),
      signal: controller.signal,
      trust: {kind: 'development'},
    });
    await attached;
    controller.abort('private abort reason');
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof CoordinatesDmgError && error.code === 'DMG_ABORTED',
    );
    assert.equal(
      commands.some((command) => command.args[0] === 'detach'),
      true,
    );
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
});

test('invalid manifests fail safely before a subprocess is run', async () => {
  let commands = 0;
  const extract = createCoordinatesDmgExtractor(async () => {
    commands += 1;
    return {code: 0, stderr: '', stdout: ''};
  });
  await assert.rejects(
    extract({
      artifactPath: '/private/artifact.dmg',
      destination: '/private/stage',
      files: [{bytes: 1, executable: false, path: '../escape', sha256: 'a'.repeat(64)}],
      trust: {kind: 'development'},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CoordinatesDmgError);
      assert.equal(error.code, 'DMG_INVALID_INPUT');
      assert.equal(error.message.includes('/private'), false);
      assert.deepEqual(error.toJSON(), {code: 'DMG_INVALID_INPUT'});
      return true;
    },
  );
  assert.equal(commands, 0);
});

async function createFixture(
  input: {
    copyFails?: boolean;
    detachFails?: boolean;
    extraPayload?: boolean;
    linkPayload?: boolean;
    teamIdentifier?: string;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-dmg-'));
  const artifactPath = join(directory, 'artifact.dmg');
  const destination = join(directory, 'stage');
  const commands: CoordinatesDmgCommand[] = [];
  let mountpoint = '';
  const files = await manifest();
  const extract = createCoordinatesDmgExtractor(async (command) => {
    commands.push(command);
    if (command.file === '/usr/bin/codesign' && command.args[0] === '--display') {
      return {
        code: 0,
        stderr: `Authority=Developer ID Application: Tileflow\nTeamIdentifier=${input.teamIdentifier ?? 'ABCDEFGHIJ'}\n`,
        stdout: '',
      };
    }
    if (command.file === '/usr/bin/hdiutil' && command.args[0] === 'attach') {
      mountpoint = command.args[command.args.indexOf('-mountpoint') + 1]!;
      await writePayload(join(mountpoint, 'payload'), input);
    }
    if (command.file === '/usr/bin/ditto') {
      if (input.copyFails) return {code: 1, stderr: 'copy failed', stdout: ''};
      await cp(command.args[3]!, command.args[4]!, {preserveTimestamps: true, recursive: true});
    }
    if (command.file === '/usr/bin/hdiutil' && command.args[0] === 'detach' && input.detachFails)
      return {code: 1, stderr: 'detach failed', stdout: ''};
    return {code: 0, stderr: '', stdout: ''};
  });
  return {
    artifactPath,
    close: () => rm(directory, {force: true, recursive: true}),
    commands,
    destination,
    extract: (
      trust: {kind: 'development'} | {kind: 'apple-notarized-dmg'; teamIdentifier: string},
    ) => extract({artifactPath, destination, files, trust}),
    get mountpoint() {
      return mountpoint;
    },
  };
}

async function writePayload(
  root: string,
  input: {extraPayload?: boolean; linkPayload?: boolean} = {},
) {
  await mkdir(join(root, 'bin'), {recursive: true});
  await mkdir(join(root, 'resources'), {recursive: true});
  await writeFile(join(root, 'bin/coordinates'), executable, {mode: 0o755});
  await chmod(join(root, 'bin/coordinates'), 0o755);
  await writeFile(join(root, 'resources/proj.db'), database, {mode: 0o644});
  if (input.extraPayload) await writeFile(join(root, 'resources/extra'), 'extra');
  if (input.linkPayload) await symlink('proj.db', join(root, 'resources/link'));
}

async function manifest() {
  return [
    {
      bytes: executable.byteLength,
      executable: true,
      path: 'bin/coordinates',
      sha256: await hashFileFromBuffer(executable),
    },
    {
      bytes: database.byteLength,
      executable: false,
      path: 'resources/proj.db',
      sha256: await hashFileFromBuffer(database),
    },
  ];
}

async function hashFileFromBuffer(content: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-dmg-hash-'));
  const path = join(directory, 'content');
  try {
    await writeFile(path, content);
    return await hashFile(path);
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
}
