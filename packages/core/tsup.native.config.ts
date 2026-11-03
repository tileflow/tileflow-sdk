import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Options} from 'tsup';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const providerManifest = require('whatwg-url/package.json') as {version: string};
if (providerManifest.version !== '17.3.0') throw new Error('Expected whatwg-url 17.3.0.');
const providerLib = dirname(require.resolve('whatwg-url/lib/url-state-machine.js'));
const parserRequire = createRequire(resolve(providerLib, 'url-state-machine.js'));
const tr46Path = parserRequire.resolve('tr46/package.json');
const tr46 = parserRequire('tr46/package.json') as {version: string};
const punycode = createRequire(tr46Path)('punycode/package.json') as {version: string};
if (tr46.version !== '7.0.0' || punycode.version !== '2.3.1') {
  throw new Error('Expected tr46 7.0.0 and punycode 2.3.1 for the native URL bundle.');
}
const codecPath = resolve(packageRoot, 'src/native-url-utf8.ts');
const parserPath = resolve(providerLib, 'url-state-machine.js');
const expectedImporters = new Set([parserPath, resolve(providerLib, 'percent-encoding.js')]);

const queryCodecImports = new Set(['@exodus/bytes/encoding.js', '@exodus/bytes/whatwg.js']);
const allowedProviderInputs = new Set([
  ...expectedImporters,
  resolve(providerLib, 'infra.js'),
  resolve(providerLib, 'url-miscellaneous.js'),
]);

/** Bind only the pinned parser's UTF-8 imports; legacy codec registration is unnecessary. */
const codecPlugin: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'tileflow-native-url-codec',
  setup(build) {
    const replaced = new Set<string>();
    build.onStart(() => {
      replaced.clear();
    });
    build.onResolve({filter: /^\.\/encoding(?:\.js)?$/}, (args) => {
      if (!expectedImporters.has(resolve(args.importer))) return;
      replaced.add(`relative:${resolve(args.importer)}`);
      return {path: codecPath};
    });
    build.onResolve({filter: /^@exodus\/bytes\/(?:encoding|whatwg)\.js$/}, (args) => {
      if (resolve(args.importer) !== parserPath || !queryCodecImports.has(args.path)) return;
      replaced.add(args.path);
      return {path: codecPath};
    });
    build.onEnd((result) => {
      if (result.errors.length) return;
      const metadata = result.metafile;
      if (!metadata || replaced.size !== expectedImporters.size + queryCodecImports.size) {
        return {
          errors: [{text: 'Native URL build did not replace the four pinned codec imports.'}],
        };
      }
      const workingDirectory = build.initialOptions.absWorkingDir ?? process.cwd();
      const inputs = Object.keys(metadata.inputs).map((path) => resolve(workingDirectory, path));
      const foreign = inputs
        .map((path) => path.replaceAll('\\', '/'))
        .filter((path) => path.includes('/node_modules/'))
        .map((path) => path.slice(path.lastIndexOf('/node_modules/') + 14).split('/')[0] ?? '');
      // Inspect emitted contributions, not merely resolved files that tree-shaking can discard.
      const classicSchemaEmitted = Object.values(metadata.outputs).some((output) =>
        Object.entries(output.inputs).some(
          ([path, contribution]) =>
            contribution.bytesInOutput > 0 &&
            /\/zod\/(?:src\/)?v4\/classic\//u.test(path.replaceAll('\\', '/')),
        ),
      );
      if (classicSchemaEmitted) {
        return {
          errors: [{text: 'The native manifest must not embed the Classic Zod method graph.'}],
        };
      }
      if (
        inputs.includes(resolve(providerLib, 'encoding.js')) ||
        !inputs.includes(codecPath) ||
        foreign.some((name) => !['whatwg-url', 'tr46', 'punycode', 'zod'].includes(name)) ||
        inputs.some((path) => path.startsWith(providerLib) && !allowedProviderInputs.has(path)) ||
        Object.values(metadata.outputs).some((output) =>
          output.imports.some((item) => item.external),
        )
      ) {
        return {
          errors: [
            {
              text: 'Native URL output must contain only the private parser, canonical manifest schema and no external imports.',
            },
          ],
        };
      }
    });
  },
};

export default defineConfig({
  entry: ['src/native.ts'],
  clean: false,
  format: ['esm'],
  platform: 'browser',
  target: 'es2020',
  splitting: false,
  dts: true,
  noExternal: [
    /^whatwg-url(?:\/|$)/u,
    /^@exodus\/bytes(?:\/|$)/u,
    /^tr46(?:\/|$)/u,
    /^punycode(?:\/|$)/u,
    /^zod(?:\/|$)/u,
  ],
  esbuildPlugins: [codecPlugin],
  esbuildOptions(options) {
    options.metafile = true;
    options.legalComments = 'inline';
  },
});
