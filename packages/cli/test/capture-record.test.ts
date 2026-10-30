import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureRecordDirectory, deleteCaptureRecord} from '../src/capture-record';

test('capture deletion rejects a linked artifact before removing either file', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-delete-capture-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const directory = join(cwd, captureRecordDirectory);
  await mkdir(directory, {recursive: true});
  const id = 'a'.repeat(64);
  const exported = join(cwd, 'export.png');
  await writeFile(exported, 'keep exported image');
  await writeFile(join(directory, `${id}.json`), 'keep record');
  await symlink(exported, join(directory, `${id}.png`));
  await assert.rejects(deleteCaptureRecord(id, cwd), /regular file/);
  assert.equal(await readFile(join(directory, `${id}.json`), 'utf8'), 'keep record');
  assert.equal(await readFile(exported, 'utf8'), 'keep exported image');
});

test('capture deletion rejects linked record directories and path traversal', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-delete-capture-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const outside = join(cwd, 'outside');
  await mkdir(outside);
  await mkdir(join(cwd, '.tileflow/captures'), {recursive: true});
  await symlink(outside, join(cwd, captureRecordDirectory), 'junction');
  const id = 'b'.repeat(64);
  await writeFile(join(outside, `${id}.json`), 'keep external record');
  await assert.rejects(deleteCaptureRecord(id, cwd), /symbolic links/);
  await assert.rejects(deleteCaptureRecord('../outside', cwd), /Capture ID/);
  assert.equal(await readFile(join(outside, `${id}.json`), 'utf8'), 'keep external record');
});
