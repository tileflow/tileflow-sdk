import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {mobilePackages, mobileVersions} from './mobile-smoke-contract.mjs';
import {buildMobileAndroid, buildMobileIos} from './mobile-smoke-native.mjs';
import {packMobilePackages} from './mobile-smoke-pack.mjs';
import {
  createMobileContext,
  withMobileWorkspace,
  writeMobileFile,
  writeMobileJson,
} from './mobile-smoke-workspace.mjs';

const output = (stdout = '') => ({stdout: Buffer.from(stdout), stderr: Buffer.alloc(0)});
const nativeConfig = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageImportPath: 'import dev.tileflow.reactnative.TileflowNativeAdmissionPackage;',
        packageInstance: 'new TileflowNativeAdmissionPackage()',
      },
      ios: {},
    },
  },
};
function bytecode() {
  const bytes = Buffer.alloc(64);
  bytes.writeBigUInt64LE(0x1f1903c103bc1fc6n, 0);
  bytes.writeUInt32LE(96, 8);
  bytes.writeUInt32LE(bytes.length, 32);
  return bytes;
}
async function fixtureParent(t) {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-mobile-adapter-test-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  return parent;
}
async function writeFixture(path, content) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, content);
}

test('staged build and pack adapters use pnpm, fresh output and license inputs without touching source', async (t) => {
  const parent = await fixtureParent(t);
  const repository = join(parent, 'source');
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'docs/modules-api-reference.json',
  ]) {
    await writeFixture(join(repository, file), '{}\n');
  }
  await writeFixture(join(repository, 'LICENSE'), 'Fixture license\n');
  await writeFixture(
    join(repository, 'scripts', 'package-license.mjs'),
    '// Fixture hook; not executed.\n',
  );
  const baseFiles = ['package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
  const nativeFiles = [
    'react-native.config.cjs',
    'android/build.gradle',
    'android/src/main/java/Fixture.kt',
    'ios/tileflow_native_admission.rb',
    'ios/Fixture.mm',
    'TileflowNativeAdmission.podspec',
  ];
  for (const name of mobilePackages) {
    const manifest = {
      name: `@tileflow/${name}`,
      version: '0.0.0-development',
      exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
      ...(name === 'react-native'
        ? {
            dependencies: {
              '@tileflow/core': 'workspace:>=0.1.0-alpha.16 <0.1.0-beta.0',
              '@tileflow/interactions': 'workspace:*',
            },
          }
        : {}),
    };
    await writeFixture(
      join(repository, 'packages', name, 'package.json'),
      JSON.stringify(manifest),
    );
    await writeFixture(join(repository, 'packages', name, 'dist', 'stale.js'), 'stale');
    if (name === 'react-native')
      for (const file of nativeFiles)
        await writeFixture(
          join(repository, 'packages', name, file),
          file === 'react-native.config.cjs'
            ? `module.exports = ${JSON.stringify(nativeConfig)};`
            : 'fixture',
        );
  }
  const calls = [];
  await withMobileWorkspace(
    async (root) => {
      const archives = new Map();
      const context = await createMobileContext(root, {
        run: async (command, args, options) => {
          calls.push([command, ...args]);
          if (command === 'pnpm' && args[0] === 'install') {
            assert.deepEqual(args, ['install', '--frozen-lockfile', '--ignore-scripts']);
            assert.equal(await readFile(join(options.cwd, 'LICENSE'), 'utf8'), 'Fixture license\n');
            await access(join(options.cwd, 'scripts', 'package-license.mjs'));
            for (const name of mobilePackages)
              await assert.rejects(access(join(options.cwd, 'packages', name, 'dist')), {
                code: 'ENOENT',
              });
            return output();
          }
          if (command === 'pnpm' && args[0] === '--filter') {
            const name = args[1].slice('@tileflow/'.length);
            for (const file of ['index.js', 'index.d.ts'])
              await writeFixture(join(options.cwd, 'packages', name, 'dist', file), 'export {};');
            return output();
          }
          if (command === 'pnpm' && args[0] === 'pack') {
            const manifest = JSON.parse(await readFile(join(options.cwd, 'package.json'), 'utf8'));
            assert.equal(manifest.version, mobileVersions.package);
            assert.doesNotMatch(JSON.stringify(manifest), /workspace:/u);
            const name = manifest.name.slice('@tileflow/'.length);
            const path = join(args[2], `${name}.tgz`);
            await writeFile(path, `mock tarball ${name}`);
            const files = [...baseFiles, ...(name === 'react-native' ? nativeFiles : [])];
            const contents = new Map();
            for (const file of files)
              contents.set(
                file,
                file === 'LICENSE'
                  ? Buffer.from('Fixture license\n')
                  : await readFile(join(options.cwd, file)),
              );
            archives.set(path, contents);
            return output(
              JSON.stringify({name: manifest.name, version: manifest.version, filename: path}),
            );
          }
          if (command === 'tar') {
            const contents = archives.get(args[1]);
            assert.ok(contents);
            if (args[0] === '-tzf')
              return output([...contents.keys()].map((file) => `package/${file}\n`).join(''));
            if (args[0] === '-tvzf')
              return output(
                [...contents.keys()].map((file) => `-rw-r--r-- package/${file}\n`).join(''),
              );
            assert.equal(args[0], '-xzf');
            for (const [file, bytes] of contents)
              await writeFixture(join(args[3], 'package', file), bytes);
            return output();
          }
          assert.equal(command, process.execPath);
          return output(JSON.stringify(nativeConfig));
        },
      });
      const packed = await packMobilePackages(context, repository, {command: 'pnpm', prefix: []});
      assert.deepEqual(
        packed.tarballs.map(({name}) => name),
        mobilePackages.map((name) => `@tileflow/${name}`),
      );
      assert.ok(packed.tarballs.every(({identity}) => /^[a-f0-9]{64}$/u.test(identity.sha256)));
      assert.equal(
        calls.filter(([command, operation]) => command === 'pnpm' && operation === 'pack').length,
        3,
      );
      assert.equal(
        calls.some(([command]) => command === 'npm'),
        false,
      );
    },
    {parent},
  );
  for (const name of mobilePackages) {
    const source = JSON.parse(
      await readFile(join(repository, 'packages', name, 'package.json'), 'utf8'),
    );
    assert.equal(source.version, '0.0.0-development');
    assert.equal(
      await readFile(join(repository, 'packages', name, 'dist', 'stale.js'), 'utf8'),
      'stale',
    );
    await assert.rejects(access(join(repository, 'packages', name, 'LICENSE')), {code: 'ENOENT'});
  }
});

for (const kind of ['expo', 'bare']) {
  test(`${kind} Android adapter checks Release APK metadata and embedded Hermes`, async (t) => {
    const parent = await fixtureParent(t);
    await withMobileWorkspace(
      async (root) => {
        const consumer = {kind, directory: join(root, 'consumers', kind)};
        const android = join(consumer.directory, 'android');
        await writeMobileFile(
          root,
          join(android, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
          'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.0.0-bin.zip\n',
        );
        let bundle = bytecode();
        const context = await createMobileContext(root, {
          run: async (command, args) => {
            if (command === 'unzip') {
              assert.equal(args[2], 'assets/index.android.bundle');
              return output(bundle);
            }
            assert.equal(command, join(android, 'gradlew'));
            assert.ok(args.includes(':app:assembleRelease'));
            const directory = join(android, 'app', 'build', 'outputs', 'apk', 'release');
            await writeMobileJson(root, join(directory, 'output-metadata.json'), {
              variantName: 'release',
              elements: [{outputFile: 'app-release.apk'}],
            });
            await writeMobileFile(
              root,
              join(directory, 'app-release.apk'),
              'Mock binary, not a native build.',
            );
            return output();
          },
        });
        const receipt = await buildMobileAndroid(context, consumer);
        assert.equal(receipt.configuration, 'Release');
        assert.equal(receipt.files[0].hermes.version, 96);
        assert.equal(receipt.files[0].name, `${kind}/app-release.apk`);
        assert.equal(JSON.stringify(receipt).includes(root), false);
        bundle = Buffer.from('Not Hermes');
        await assert.rejects(buildMobileAndroid(context, consumer), {code: 'BINARY_INVALID'});
      },
      {parent},
    );
  });

  test(`${kind} iOS adapter discovers the app from build settings and rejects non-Hermes output`, async (t) => {
    const parent = await fixtureParent(t);
    await withMobileWorkspace(
      async (root) => {
        const consumer = {
          kind,
          directory: join(root, 'consumers', kind),
          scheme: kind === 'expo' ? 'HelloWorld' : 'TileflowBareSmoke',
        };
        const productDirectory = join(root, `derived-${kind}`, 'nonstandard', 'Products');
        const wrapper = `${consumer.scheme}.app`;
        let bundle = bytecode();
        const context = await createMobileContext(root, {
          run: async (command, args) => {
            if (command === 'pod') {
              assert.deepEqual(args, ['install']);
              await writeMobileFile(
                root,
                join(consumer.directory, 'ios', 'Podfile.lock'),
                'TileflowNativeAdmission (0.1.0-alpha.16)\nMapLibreReactNative (11.3.10)\n',
              );
              return output();
            }
            assert.equal(command, 'xcodebuild');
            assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
            if (args.includes('-showBuildSettings'))
              return output(
                JSON.stringify([
                  {
                    target: consumer.scheme,
                    buildSettings: {
                      WRAPPER_EXTENSION: 'app',
                      CONFIGURATION: 'Release',
                      PLATFORM_NAME: 'iphonesimulator',
                      TARGET_BUILD_DIR: productDirectory,
                      WRAPPER_NAME: wrapper,
                      EXECUTABLE_NAME: consumer.scheme,
                    },
                  },
                ]),
              );
            await writeMobileFile(
              root,
              join(productDirectory, wrapper, consumer.scheme),
              'Mock executable, not a native build.',
            );
            await writeMobileFile(root, join(productDirectory, wrapper, 'main.jsbundle'), bundle);
            return output();
          },
        });
        const receipt = await buildMobileIos(context, consumer);
        assert.equal(receipt.destination, 'simulator');
        assert.equal(receipt.hermes.version, 96);
        assert.equal(receipt.files[1].name, `${kind}/${wrapper}/main.jsbundle`);
        assert.equal(JSON.stringify(receipt).includes(root), false);
        bundle = Buffer.from('Plain JavaScript');
        await assert.rejects(buildMobileIos(context, consumer), {code: 'BINARY_INVALID'});
      },
      {parent},
    );
  });
}
