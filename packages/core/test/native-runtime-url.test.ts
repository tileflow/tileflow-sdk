import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const globals = ['window', 'document', 'navigator', 'fetch', 'FontFace'];

for (const origin of ['http://127.0.0.1:8765', 'http://10.0.2.2:8765']) {
  for (const environment of ['node', 'react-native-0.83.10-fixture']) {
    test(`resolves owner-relative resources with ${environment} URL at ${origin}`, async () => {
      const script = `
        import assert from 'node:assert/strict';
        import {ReactNative083URL} from './test/fixtures/react-native-083-url.mjs';
        import {checkNativeUrlContract} from './test/fixtures/native-url-contract.mjs';
        const origin = ${JSON.stringify(origin)};
        const environment = ${JSON.stringify(environment)};
        if (environment !== 'node') {
          const documentUrl = origin + '/generations/' + 'a'.repeat(64) + '/styles/streets/light.json';
          // Characterize the upstream defect separately from the expected Tileflow contract.
          assert.equal(new ReactNative083URL(documentUrl).href, documentUrl + '/');
          assert.equal(new ReactNative083URL('../../icons/streets/sprite', documentUrl).href,
            documentUrl + '/../../icons/streets/sprite');
          Object.defineProperty(globalThis, 'URL', {configurable: true, value: ReactNative083URL});
        }
        const ambient = globalThis.URL;
        for (const name of ${JSON.stringify(globals)}) {
          Object.defineProperty(globalThis, name, {configurable: true, get() {
            throw new Error('Unexpected browser or network access: ' + name);
          }});
        }
        const native = await import('@tileflow/core/native');
        const results = checkNativeUrlContract(native, origin);
        assert.equal(globalThis.URL, ambient, 'The SDK must not install a global polyfill.');
        process.stdout.write(JSON.stringify(results));
      `;
      const {stdout} = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: packageRoot,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      const results = JSON.parse(stdout) as Array<{id: string; passed: boolean}>;
      assert.equal(results.length, 22);
      assert.deepEqual(results.filter(({passed}) => !passed), []);
    });
  }
}
