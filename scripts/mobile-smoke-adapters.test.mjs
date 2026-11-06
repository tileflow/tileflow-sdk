import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {mobilePackages, mobileVersions} from './mobile-smoke-contract.mjs';
import {
  buildMobileAndroid,
  buildMobileIos,
  checkMobilePrerequisites,
  readNativeCandidate,
} from './mobile-smoke-native.mjs';
import {packMobilePackages} from './mobile-smoke-pack.mjs';
import {
  createMobileContext,
  readMobileFile,
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
        packageImportPath: 'import dev.tileflow.reactnative.TileflowReactNativePackage;',
        packageInstance: 'new TileflowReactNativePackage()',
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
    'ios/tileflow_post_install.rb',
    'ios/Fixture.mm',
    'src/index.ts',
    'ios/Sources/Fixture.swift',
    'src/specs/NativeTileflowMapModule.ts',
    'src/specs/NativeTileflowServices.ts',
    'src/specs/NativeTileflowOffline.ts',
    'src/specs/TileflowMapViewNativeComponent.ts',
    'src/specs/TileflowMarkerViewNativeComponent.ts',
    'plugin/index.cjs',
    'plugin/transforms.cjs',
    'TileflowReactNative.podspec',
  ];
  for (const name of mobilePackages) {
    const manifest = {
      name: `@tileflow/${name}`,
      version: '0.0.0-development',
      'react-native': './src/index.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          'react-native': './src/index.ts',
          import: './dist/index.js',
        },
      },
      codegenConfig: {name: 'TileflowReactNativeSpec', type: 'all', jsSrcsDir: 'src/specs'},
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
        1,
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

/** A native candidate as scripts/native-release-prepare.mjs writes it, with no real artifacts. */
async function nativeCandidate(root) {
  const directory = join(root, 'candidate');
  await writeMobileJson(root, join(directory, 'candidate.json'), {
    schemaVersion: 1,
    version: '0.0.0-local.1',
    swift: {path: 'swift'},
    android: {
      coordinate: 'dev.tileflow:tileflow:0.0.0-local.1',
      modules: Object.fromEntries(
        ['tileflow', 'tileflow-services', 'tileflow-foundation'].map((name) => [
          name,
          `dev.tileflow:${name}:0.0.0-local.1`,
        ]),
      ),
    },
  });
  await writeMobileFile(root, join(directory, 'swift', 'Package.swift'), '// Fixture.\n');
  for (const artifact of ['tileflow', 'tileflow-services', 'tileflow-foundation']) {
    for (const suffix of ['.pom', '.aar', '.module', '-sources.jar', '-javadoc.jar'])
      await writeMobileFile(
        root,
        join(
          directory,
          'maven/dev/tileflow',
          artifact,
          '0.0.0-local.1',
          `${artifact}-0.0.0-local.1${suffix}`,
        ),
        'Fixture.\n',
      );
  }
  return directory;
}

test('native smoke requires all three complete candidate artifacts at the declared version', async (t) => {
  const root = await realpath(await fixtureParent(t));
  const directory = await nativeCandidate(root);
  const context = {env: {TILEFLOW_NATIVE_CANDIDATE: directory}};
  assert.equal((await readNativeCandidate(context)).version, '0.0.0-local.1');
  for (const artifact of ['tileflow', 'tileflow-services', 'tileflow-foundation']) {
    const file = join(
      directory,
      'maven/dev/tileflow',
      artifact,
      '0.0.0-local.1',
      `${artifact}-0.0.0-local.1.aar`,
    );
    await rm(file);
    await assert.rejects(readNativeCandidate(context), {code: 'PREREQUISITE_MISSING'});
    await writeFile(file, 'Fixture.\n');
  }
  await writeFile(join(directory, 'INCOMPLETE'), 'Building.\n');
  await assert.rejects(readNativeCandidate(context), {code: 'PREREQUISITE_MISSING'});
  await rm(join(directory, 'INCOMPLETE'));
  const file = join(directory, 'candidate.json');
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  receipt.android.modules['tileflow-services'] = 'dev.tileflow:tileflow-services:0.0.0-old.1';
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(readNativeCandidate(context), {code: 'PREREQUISITE_MISSING'});
});

test('Android prerequisites verify the local Java 17 compiler independently of the Java 21 runtime', async (t) => {
  const root = await realpath(await fixtureParent(t));
  const java21 = join(root, 'java21');
  const java17 = join(root, 'java17');
  const sdk = join(root, 'sdk');
  for (const path of [
    ...[java21, java17].flatMap((home) => ['java', 'javac'].map((name) => join(home, 'bin', name))),
    join(sdk, 'platforms', 'android-36', 'android.jar'),
    join(sdk, 'build-tools', '36.0.0', 'aapt2'),
    join(sdk, 'ndk', '27.1.12297006', 'source.properties'),
    join(sdk, 'licenses', 'android-sdk-license'),
  ])
    await writeFixture(path, 'fixture');
  let compilerVersion = '17.0.20';
  const context = {
    env: {
      JAVA_HOME: java21,
      TILEFLOW_JAVA_17_HOME: java17,
      ANDROID_HOME: sdk,
      TILEFLOW_NATIVE_CANDIDATE: await nativeCandidate(root),
    },
    run: async (command) => {
      if (command === 'pnpm') return output('11.13.1');
      if (command === 'npm') return output('11.6.2');
      if (command === join(java21, 'bin', 'java')) return output('openjdk version "21.0.9"');
      if (command === join(java21, 'bin', 'javac')) return output('javac 21.0.9');
      if (command === join(java17, 'bin', 'java'))
        return output(`openjdk version "${compilerVersion}"`);
      if (command === join(java17, 'bin', 'javac')) return output(`javac ${compilerVersion}`);
      return output();
    },
  };
  const check = () =>
    checkMobilePrerequisites(
      context,
      'android',
      'pnpm@11.13.1',
      {command: 'pnpm', prefix: []},
      'darwin',
    );
  assert.equal((await check()).javaToolchain17, '17.0.20');
  compilerVersion = '21.0.9';
  await assert.rejects(check(), {code: 'TOOLCHAIN_MISMATCH', prerequisite: 'java-17'});
  compilerVersion = '17.0.20';
  delete context.env.TILEFLOW_JAVA_17_HOME;
  await assert.rejects(check(), {code: 'PREREQUISITE_MISSING', prerequisite: 'java-17'});
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
        await writeMobileFile(root, join(android, 'gradle.properties'), 'hermesEnabled=true\n');
        await writeMobileFile(
          root,
          join(android, 'build.gradle'),
          'buildscript {\n  ext {\n    minSdkVersion = 24\n  }\n}\n',
        );
        await writeMobileFile(
          root,
          join(consumer.directory, 'node_modules/@tileflow/react-native/plugin/transforms.cjs'),
          await readFile(
            new URL('../packages/react-native/plugin/transforms.cjs', import.meta.url),
          ),
        );
        let bundle = bytecode();
        const context = await createMobileContext(root, {
          environment: {
            TILEFLOW_NATIVE_CANDIDATE: await nativeCandidate(root),
            JAVA_HOME: '/java21',
            TILEFLOW_JAVA_17_HOME: '/java17',
          },
          run: async (command, args) => {
            if (command === 'unzip') {
              assert.equal(args[2], 'assets/index.android.bundle');
              return output(bundle);
            }
            assert.equal(command, join(android, 'gradlew'));
            assert.ok(args.includes(':app:assembleRelease'));
            assert.ok(args.includes('-Porg.gradle.java.installations.paths=/java17,/java21'));
            assert.ok(args.includes('-Porg.gradle.java.installations.auto-download=false'));
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
        const mavenUrl = kind === 'expo' ? 'https://public.example.test/maven' : undefined;
        const receipt = await buildMobileAndroid(context, consumer, mavenUrl);
        assert.equal(receipt.configuration, 'Release');
        assert.equal(receipt.nativeMavenRepository, mavenUrl ?? 'local-candidate');
        assert.equal(receipt.nativeCandidate, '0.0.0-local.1');
        const properties = (
          await readMobileFile(root, join(android, 'gradle.properties'))
        ).toString();
        assert.ok(
          properties
            .split('\n')
            .includes(`tileflowMavenRepository=${mavenUrl ?? join(root, 'candidate', 'maven')}`),
        );
        assert.match(properties, /^tileflowNativeVersion=0\.0\.0-local\.1$/mu);
        assert.match(properties, /^android\.minSdkVersion=26$/mu);
        const build = (await readMobileFile(root, join(android, 'build.gradle'))).toString();
        assert.match(build, /minSdkVersion = 26/u);
        assert.match(build, /exclusiveContent \{[\s\S]*includeGroup\('dev\.tileflow'\)/u);
        assert.equal(receipt.files[0].hermes.version, 96);
        assert.equal(receipt.files[0].name, `${kind}/app-release.apk`);
        assert.equal(JSON.stringify(receipt).includes(root), false);
        bundle = Buffer.from('Not Hermes');
        await assert.rejects(buildMobileAndroid(context, consumer), {code: 'BINARY_INVALID'});
      },
      {parent},
    );
  });

  test(`${kind} iOS adapter verifies Hermes and embedded dynamic frameworks`, async (t) => {
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
        const ios = join(consumer.directory, 'ios');
        await writeMobileFile(
          root,
          join(ios, 'Podfile'),
          'platform :ios, min_ios_version_supported\n',
        );
        await writeMobileFile(
          root,
          join(ios, `${consumer.scheme}.xcodeproj`, 'project.pbxproj'),
          'IPHONEOS_DEPLOYMENT_TARGET = 15.1;\n',
        );
        const candidate = await nativeCandidate(root);
        let bundle = bytecode();
        let embedMapLibre = true;
        let embedDependency = true;
        const frameworks = join(productDirectory, wrapper, 'Frameworks');
        const context = await createMobileContext(root, {
          environment: {TILEFLOW_NATIVE_CANDIDATE: candidate},
          run: async (command, args, options) => {
            if (command === 'pod') {
              assert.deepEqual(args, ['install']);
              assert.equal(options.env.TILEFLOW_SWIFT_PACKAGE_PATH, join(candidate, 'swift'));
              await writeMobileFile(
                root,
                join(consumer.directory, 'ios', 'Podfile.lock'),
                'TileflowReactNative (0.1.0-alpha.16)\n',
              );
              return output();
            }
            if (command === 'xcrun') {
              assert.deepEqual(args.slice(0, 2), ['otool', '-L']);
              const dependency = args[2].endsWith('/MapLibre')
                ? '@rpath/FixtureDependency.framework/FixtureDependency'
                : args[2].endsWith('/FixtureDependency')
                  ? '/System/Library/Frameworks/Metal.framework/Metal'
                  : '@rpath/MapLibre.framework/MapLibre';
              return output(
                `${args[2]}:\n\t${dependency} (compatibility version 1.0.0, current version 1.0.0)\n`,
              );
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
            for (const [name, embed] of [
              ['MapLibre', embedMapLibre],
              ['FixtureDependency', embedDependency],
            ]) {
              const binary = join(frameworks, `${name}.framework`, name);
              if (embed) await writeMobileFile(root, binary, 'Mock dynamic framework.');
              else await rm(binary, {force: true});
            }
            return output();
          },
        });
        const receipt = await buildMobileIos(context, consumer);
        assert.equal(receipt.destination, 'simulator');
        assert.equal(receipt.nativeCandidate, '0.0.0-local.1');
        assert.equal(
          (await readMobileFile(root, join(ios, 'Podfile'))).toString(),
          "platform :ios, '16.0'\n",
        );
        assert.equal(receipt.hermes.version, 96);
        assert.equal(receipt.files[1].name, `${kind}/${wrapper}/main.jsbundle`);
        assert.equal(JSON.stringify(receipt).includes(root), false);
        bundle = Buffer.from('Plain JavaScript');
        await assert.rejects(buildMobileIos(context, consumer), {code: 'BINARY_INVALID'});
        bundle = bytecode();
        embedMapLibre = false;
        await assert.rejects(buildMobileIos(context, consumer), {code: 'BINARY_INVALID'});
        embedMapLibre = true;
        embedDependency = false;
        await assert.rejects(buildMobileIos(context, consumer), {code: 'BINARY_INVALID'});
      },
      {parent},
    );
  });
}
