import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {relative, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';

// Both directories must already be built. This script never installs packages or rebuilds Core.
const require = createRequire(import.meta.url);
const {build, version: esbuildVersion} = createRequire(require.resolve('tsup/package.json'))(
  'esbuild',
);
const [beforeDirectory, afterDirectory, beforePackJson, afterPackJson] = process.argv.slice(2);
if (!beforeDirectory || !afterDirectory) {
  throw new Error(
    'Usage: node measure-native-url.mjs BEFORE_CORE AFTER_CORE [BEFORE_PACK_JSON AFTER_PACK_JSON]',
  );
}

async function measure(directory, packJson) {
  const root = resolve(directory);
  const entry = resolve(root, 'dist/native.js');
  const bytes = await readFile(entry);
  const bundled = await build({
    stdin: {contents: `export * from ${JSON.stringify(entry)};`, resolveDir: root, loader: 'js'},
    outfile: 'native-consumer.mjs',
    bundle: true,
    write: false,
    minify: true,
    metafile: true,
    platform: 'browser',
    target: 'es2020',
    format: 'esm',
    legalComments: 'inline',
  });
  const output = bundled.outputFiles.find((item) => item.path.endsWith('native-consumer.mjs'));
  if (!output) throw new Error('Consumer bundle was not produced.');
  const externalImports = Object.values(bundled.metafile.outputs)
    .flatMap((item) => item.imports)
    .filter((item) => item.external);
  if (externalImports.length) throw new Error('Consumer bundle has external imports.');
  const graph = Object.entries(bundled.metafile.inputs)
    .filter(([path]) => path !== '<stdin>')
    .map(([path, metadata]) => ({path: relative(root, resolve(path)), bytes: metadata.bytes}))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let pack = null;
  if (packJson) {
    const receipts = JSON.parse(await readFile(resolve(packJson), 'utf8'));
    if (!Array.isArray(receipts) || receipts.length !== 1)
      throw new Error('Expected one npm pack receipt.');
    const receipt = receipts[0];
    pack = {
      size: receipt.size,
      unpackedSize: receipt.unpackedSize,
      fileCount: receipt.files.length,
      integrity: receipt.integrity,
      filename: receipt.filename,
    };
  }
  return {
    nativeJsBytes: bytes.byteLength,
    nativeJsSha256: createHash('sha256').update(bytes).digest('hex'),
    declarationBytes: (await stat(resolve(root, 'dist/native.d.ts'))).size,
    runtimeGraph: graph,
    runtimeGraphBytes: graph.reduce((sum, item) => sum + item.bytes, 0),
    consumer: {
      minifiedBytes: output.contents.byteLength,
      gzipBytes: gzipSync(output.contents).byteLength,
    },
    pack,
  };
}

const before = await measure(beforeDirectory, beforePackJson);
const after = await measure(afterDirectory, afterPackJson);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      scope: 'built-core-and-browser-consumer-not-hermes',
      esbuildVersion,
      nodeVersion: process.version,
      before,
      after,
      delta: {
        nativeJsBytes: after.nativeJsBytes - before.nativeJsBytes,
        minifiedBytes: after.consumer.minifiedBytes - before.consumer.minifiedBytes,
        gzipBytes: after.consumer.gzipBytes - before.consumer.gzipBytes,
        tarballBytes: before.pack && after.pack ? after.pack.size - before.pack.size : null,
        unpackedPackageBytes:
          before.pack && after.pack ? after.pack.unpackedSize - before.pack.unpackedSize : null,
      },
    },
    null,
    2,
  ),
);
