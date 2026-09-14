import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

test('validates strict v2 records without browser probes or global Zod configuration changes', async () => {
  const script = `
    import assert from 'node:assert/strict';
    let reads = 0;
    for (const name of ['window', 'document', 'navigator', 'fetch', 'FontFace']) {
      Object.defineProperty(globalThis, name, {configurable: true, get() {
        reads++;
        throw new Error('Unexpected browser access: ' + name);
      }});
    }
    const {z} = await import('zod');
    const config = {...z.config()};
    const profile = await import('@tileflow/core/native-profile');
    const row = {
      map: 'main', theme: 'light',
      inputStyleSha256: 'a'.repeat(64), loweredStyleSha256: 'b'.repeat(64),
      inputLayers: 3, outputLayers: 4, projection: 'globe-to-mercator',
      layers: [{inputLayer: 1, outputStart: 1, outputCount: 2, properties: ['line-cap']}],
    };
    const record = profile.createTileflowNativeBuildRecord('c'.repeat(64), [row]);
    assert.deepEqual(profile.tileflowNativeBuildRecordSchema.parse(record), record);
    assert.deepEqual(await profile.tileflowNativeBuildRecordSchema.parseAsync(record), record);
    for (const invalid of [
      {...record, extra: true},
      {...record, schemaVersion: 1},
      {...record, engines: {...record.engines, extra: true}},
      {...record, transformations: [{...row, extra: true}]},
      {...record, transformations: [{...row, outputLayers: 5}]},
      {...record, transformations: [{...row, layers: [{...row.layers[0], extra: true}]}]},
      {...record, transformations: [{...row, layers: [{...row.layers[0], outputStart: 0}]}]},
      {...record, transformations: [{...row, layers: [{...row.layers[0], properties: ['line-cap', 'line-cap']}]}]},
      {...record, transformations: [row, row]},
      {...record, transformations: [row, {...row, theme: 'dark'}]},
    ]) {
      assert.equal(profile.tileflowNativeBuildRecordSchema.safeParse(invalid).success, false);
    }
    assert.deepEqual(profile.validateTileflowNativeStyle({version: 8, sources: {}, layers: []}), []);
    assert.deepEqual(profile.validateTileflowNativePreparedStyle({version: 8, sources: {}, layers: []}), []);
    assert.equal(profile.tileflowNativeProfileLimits.maximumNodes, 160000);
    assert.equal(profile.tileflowNativePreparedStyleLimits.maximumNodes, 540000);
    assert.deepEqual(z.config(), config);
    assert.equal(reads, 0);
  `;
  const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    timeout: 10_000,
  });
  assert.equal(result.stderr, '');
});
