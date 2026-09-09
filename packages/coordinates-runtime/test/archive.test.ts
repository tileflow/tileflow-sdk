import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {CoordinatesArchiveError, extractCoordinatesArchive} from '../src/archive';

type Entry = Readonly<{
  data?: Uint8Array;
  mode?: number;
  name: string;
  type?: '0' | '2' | '5';
}>;

test('extracts a declared ustar gzip archive by streaming and verifies modes and hashes', async () => {
  const executable = Buffer.alloc(200_000);
  for (let index = 0; index < executable.byteLength; index += 1) executable[index] = index % 251;
  const archive = await fixtureArchive([
    {name: 'bin/', type: '5'},
    {data: executable, mode: 0o755, name: 'bin/coordinates'},
    {name: 'resources/', type: '5'},
    {data: Buffer.from('catalog'), name: 'resources/proj.db'},
  ]);
  const destination = join(archive.directory, 'artifact');

  await extractCoordinatesArchive({
    archivePath: archive.path,
    destination,
    files: [
      manifestFile('bin/coordinates', executable, true),
      manifestFile('resources/proj.db', Buffer.from('catalog'), false),
    ],
  });

  assert.deepEqual(await readFile(join(destination, 'bin/coordinates')), executable);
  assert.deepEqual(await readFile(join(destination, 'resources/proj.db')), Buffer.from('catalog'));
  assert.equal((await stat(join(destination, 'bin/coordinates'))).mode & 0o777, 0o755);
});

test('reports an unreadable archive without an unhandled stream error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-archive-missing-'));
  const module = new URL('../src/archive.ts', import.meta.url).href;
  const script = `
    import {CoordinatesArchiveError, extractCoordinatesArchive} from ${JSON.stringify(module)};
    try {
      await extractCoordinatesArchive({
        archivePath: ${JSON.stringify(join(directory, 'missing.tar.gz'))},
        destination: ${JSON.stringify(join(directory, 'artifact'))},
        files: [],
      });
      process.exitCode = 1;
    } catch (error) {
      process.exitCode = error instanceof CoordinatesArchiveError && error.code === 'ARCHIVE_UNREADABLE' ? 0 : 1;
    }
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects manifest mismatch and unsafe archive entries', async () => {
  const data = Buffer.from('data');
  for (const input of [
    {
      code: 'ARCHIVE_SIZE_MISMATCH',
      entries: [{data, name: 'safe'}],
      files: [{...manifestFile('safe', data, false), bytes: data.byteLength + 1}],
    },
    {
      code: 'ARCHIVE_HASH_MISMATCH',
      entries: [{data, name: 'safe'}],
      files: [{...manifestFile('safe', data, false), sha256: '0'.repeat(64)}],
    },
    {
      code: 'ARCHIVE_MODE_MISMATCH',
      entries: [{data, mode: 0o755, name: 'safe'}],
      files: [manifestFile('safe', data, false)],
    },
    {
      code: 'ARCHIVE_ENTRY_INVALID',
      entries: [{data, name: '../escape'}],
      files: [manifestFile('safe', data, false)],
    },
    {
      code: 'ARCHIVE_ENTRY_INVALID',
      entries: [{name: 'safe', type: '2'}],
      files: [manifestFile('safe', data, false)],
    },
  ] as const) {
    const archive = await fixtureArchive(input.entries);
    await assert.rejects(
      extractCoordinatesArchive({
        archivePath: archive.path,
        destination: join(archive.directory, 'artifact'),
        files: input.files,
      }),
      (error) => error instanceof CoordinatesArchiveError && error.code === input.code,
    );
  }

  const corruptChecksum = await fixtureArchive([{data, name: 'safe'}], {corruptChecksum: true});
  await assert.rejects(
    extractCoordinatesArchive({
      archivePath: corruptChecksum.path,
      destination: join(corruptChecksum.directory, 'artifact'),
      files: [manifestFile('safe', data, false)],
    }),
    (error) =>
      error instanceof CoordinatesArchiveError && error.code === 'ARCHIVE_CHECKSUM_INVALID',
  );
});

test('rejects duplicate, extra, missing, truncated, and aborted archives', async () => {
  const data = Buffer.from('data');
  for (const input of [
    {
      code: 'ARCHIVE_ENTRY_DUPLICATE',
      entries: [
        {data, name: 'safe'},
        {data, name: 'safe'},
      ],
      files: [manifestFile('safe', data, false)],
    },
    {
      code: 'ARCHIVE_ENTRY_UNDECLARED',
      entries: [{data, name: 'extra'}],
      files: [manifestFile('safe', data, false)],
    },
    {
      code: 'ARCHIVE_MISSING_FILE',
      entries: [],
      files: [manifestFile('safe', data, false)],
    },
  ] as const) {
    const archive = await fixtureArchive(input.entries);
    await assert.rejects(
      extractCoordinatesArchive({
        archivePath: archive.path,
        destination: join(archive.directory, 'artifact'),
        files: input.files,
      }),
      (error) => error instanceof CoordinatesArchiveError && error.code === input.code,
    );
  }

  const truncated = await fixtureArchive([{data, name: 'safe'}], {endBlocks: 0});
  await assert.rejects(
    extractCoordinatesArchive({
      archivePath: truncated.path,
      destination: join(truncated.directory, 'artifact'),
      files: [manifestFile('safe', data, false)],
    }),
    (error) => error instanceof CoordinatesArchiveError && error.code === 'ARCHIVE_TRUNCATED',
  );

  const controller = new AbortController();
  controller.abort();
  const aborted = await fixtureArchive([{data, name: 'safe'}]);
  await assert.rejects(
    extractCoordinatesArchive({
      archivePath: aborted.path,
      destination: join(aborted.directory, 'artifact'),
      files: [manifestFile('safe', data, false)],
      signal: controller.signal,
    }),
    (error) => error instanceof CoordinatesArchiveError && error.code === 'ARCHIVE_ABORTED',
  );
});

async function fixtureArchive(
  entries: readonly Entry[],
  options: {corruptChecksum?: boolean; endBlocks?: number} = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-archive-'));
  const path = join(directory, 'artifact.tar.gz');
  const payload = tar(entries, options.endBlocks ?? 2);
  if (options.corruptChecksum) payload[0] ^= 1;
  await writeFile(path, gzipSync(payload));
  return {directory, path};
}

function manifestFile(path: string, data: Uint8Array, executable: boolean) {
  return {bytes: data.byteLength, executable, path, sha256: sha256(data)};
}

function tar(entries: readonly Entry[], endBlocks: number) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ? Buffer.from(entry.data) : Buffer.alloc(0);
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, entry.mode ?? (entry.type === '5' ? 0o755 : 0o644));
    writeOctal(header, 124, 12, data.byteLength);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    writeString(header, 257, 6, 'ustar');
    writeString(header, 263, 2, '00');
    header.fill(0x20, 148, 156);
    writeOctal(
      header,
      148,
      8,
      header.reduce((sum, byte) => sum + byte, 0),
    );
    blocks.push(header, data, Buffer.alloc((512 - (data.byteLength % 512)) % 512));
  }
  blocks.push(...Array.from({length: endBlocks}, () => Buffer.alloc(512)));
  return Buffer.concat(blocks);
}

function writeString(target: Buffer, offset: number, length: number, value: string) {
  Buffer.from(value).copy(target, offset, 0, length);
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, '0');
  writeString(target, offset, length, `${text}\0`);
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
