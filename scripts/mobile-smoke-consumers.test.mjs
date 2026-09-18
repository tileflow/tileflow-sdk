import assert from 'node:assert/strict';
import {access, mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {createMobileConsumer} from './mobile-smoke-consumers.mjs';
import {mobileAppSource, mobilePackages, mobileVersions} from './mobile-smoke-contract.mjs';
import {
  copyMobileInputs,
  createMobileContext,
  withMobileWorkspace,
  writeMobileFile,
  writeMobileJson,
} from './mobile-smoke-workspace.mjs';

const output = (value) => ({
  stdout: Buffer.from(value === undefined ? '' : JSON.stringify(value)),
  stderr: Buffer.alloc(0),
});

async function consumerFixture(root, kind, defect) {
  const directory = join(root, 'consumers', kind);
  const templateDirectory = join(root, 'template');
  const manifest = {
    name: kind === 'expo' ? 'expo-template-bare-minimum' : 'TileflowBareSmoke',
    version: kind === 'expo' ? mobileVersions.expoTemplate : '0.0.1',
    dependencies: {
      react: mobileVersions.react,
      'react-native': mobileVersions.reactNative,
      ...(kind === 'expo' ? {expo: `~${mobileVersions.expo}`} : {}),
    },
    devDependencies: {
      typescript: '^5.8.3',
      ...(kind === 'bare'
        ? Object.fromEntries(
            ['cli', 'cli-platform-android', 'cli-platform-ios'].map((name) => [
              `@react-native-community/${name}`,
              mobileVersions.consumerCli,
            ]),
          )
        : {}),
    },
  };
  await writeMobileJson(root, join(templateDirectory, 'package.json'), manifest);
  await writeMobileFile(
    root,
    join(templateDirectory, 'App.js'),
    'export default function App() {}',
  );
  await writeMobileFile(
    root,
    join(templateDirectory, 'android', 'gradlew'),
    '# Fixture, never executed.',
  );
  await writeMobileFile(
    root,
    join(templateDirectory, 'android', 'gradle.properties'),
    'hermesEnabled=true\n',
  );
  await writeMobileFile(
    root,
    join(templateDirectory, 'ios', 'Podfile'),
    'post_install do |installer|\n  react_native_post_install(\n    installer,\n    config[:reactNativePath]\n  )\nend\n',
  );

  const tarballs = [];
  for (const name of mobilePackages) {
    const packageDirectory = join(root, 'unpacked', name);
    const files = ['package.json', 'dist/index.js', 'dist/index.d.ts'];
    await writeMobileJson(root, join(packageDirectory, 'package.json'), {
      name: `@tileflow/${name}`,
      version: mobileVersions.package,
    });
    for (const file of files.slice(1))
      await writeMobileFile(root, join(packageDirectory, file), 'export {};\n');
    tarballs.push({
      name: `@tileflow/${name}`,
      version: mobileVersions.package,
      path: join(root, 'packs', `${name}.tgz`),
      directory: packageDirectory,
      files,
    });
  }
  const templates = {
    expo: {directory: templateDirectory},
    bare: {path: join(root, 'bare-template.tgz')},
    generator: join(root, 'tools', 'generator.js'),
  };
  const nativeRoot = join(directory, 'node_modules', '@tileflow', 'react-native');
  const autolinking = {
    dependencies: {
      '@tileflow/react-native': {
        root: nativeRoot,
        platforms: {
          android: {
            sourceDir: join(nativeRoot, 'android'),
            packageInstance: 'new TileflowNativeAdmissionPackage()',
          },
          ios: {podspecPath: join(nativeRoot, 'TileflowNativeAdmission.podspec')},
        },
      },
      '@maplibre/maplibre-react-native': {platforms: {android: {}, ios: {}}},
    },
  };
  if (defect === 'android-discovery')
    autolinking.dependencies['@tileflow/react-native'].platforms.android = null;
  if (defect === 'ios-discovery')
    autolinking.dependencies['@tileflow/react-native'].platforms.ios.podspecPath = join(
      root,
      'unrelated',
      'TileflowNativeAdmission.podspec',
    );

  const calls = [];
  const context = await createMobileContext(root, {
    run: async (command, args, settings) => {
      if (args[0] === templates.generator) {
        calls.push('generate');
        assert.equal(command, process.execPath);
        assert.equal(args[args.indexOf('--directory') + 1], directory);
        assert.equal(args[args.indexOf('--template') + 1], `file:${templates.bare.path}`);
        assert.ok(args.includes('--skip-install'));
        await copyMobileInputs(templateDirectory, directory);
        if (defect === 'generator') throw new Error('Private generator failure');
        return output();
      }
      if (command === 'npm') {
        calls.push('install');
        assert.deepEqual(args, ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.equal(settings.cwd, directory);
        const consumer = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        for (const [name, version] of Object.entries({
          ...consumer.dependencies,
          ...consumer.devDependencies,
        })) {
          const packageRoot = join(directory, 'node_modules', ...name.split('/'));
          const packed = tarballs.find((entry) => entry.name === name);
          if (packed) {
            assert.equal(version, `file:../../packs/${name.slice('@tileflow/'.length)}.tgz`);
            await copyMobileInputs(packed.directory, packageRoot);
          } else {
            await writeMobileJson(root, join(packageRoot, 'package.json'), {
              name,
              version,
              ...(name === '@react-native-community/cli' ? {bin: {'rnc-cli': 'build/bin.js'}} : {}),
            });
            if (name === '@react-native-community/cli')
              await writeMobileFile(
                root,
                join(packageRoot, 'build', 'bin.js'),
                '// Never executed.\n',
              );
          }
        }
        await writeMobileJson(root, join(directory, 'package-lock.json'), {lockfileVersion: 3});
        if (defect === 'installed-bytes')
          await writeMobileFile(root, join(nativeRoot, 'dist', 'index.js'), 'different bytes');
        return output();
      }
      assert.equal(command, process.execPath);
      if (args[0] === '-e') {
        calls.push('resolve');
        const entries = mobilePackages.map((name) =>
          join(directory, 'node_modules', '@tileflow', name, 'dist', 'index.js'),
        );
        return output([...entries, entries[0], entries[1]]);
      }
      if (args[0].endsWith('/typescript/bin/tsc')) {
        calls.push('typescript');
        assert.deepEqual(args.slice(1), ['--project', 'tsconfig.json']);
        assert.equal(await readFile(join(directory, 'App.tsx'), 'utf8'), mobileAppSource);
        const tsconfig = JSON.parse(await readFile(join(directory, 'tsconfig.json'), 'utf8'));
        assert.deepEqual(tsconfig.files, ['App.tsx']);
        assert.equal(tsconfig.compilerOptions.noEmit, true);
        assert.equal(tsconfig.compilerOptions.paths, undefined);
        return output();
      }
      if (kind === 'expo') {
        assert.ok(args.includes('react-native-config'));
        calls.push(`autolink-${args.at(-1)}`);
      } else {
        assert.equal(args[1], 'config');
        calls.push('autolink-both');
      }
      return output(autolinking);
    },
  });
  return {context, directory, templates, packages: {tarballs}, calls};
}

for (const kind of ['expo', 'bare']) {
  test(`${kind} consumer composes packed public usage and ordinary autolinking with injected commands`, async () => {
    await withMobileWorkspace(async (root) => {
      const f = await consumerFixture(root, kind);
      const result = await createMobileConsumer(f.context, kind, f.packages, f.templates);
      assert.deepEqual(f.calls, [
        ...(kind === 'bare' ? ['generate'] : []),
        'install',
        'resolve',
        'typescript',
        ...(kind === 'expo' ? ['autolink-android', 'autolink-ios'] : ['autolink-both']),
      ]);
      assert.equal(result.receipt.typeScript, 'compiled');
      assert.equal(result.receipt.autolinking.android, 'discovered');
      assert.equal(result.receipt.autolinking.ios, 'discovered');
      assert.equal(result.receipt.directVersions['@tileflow/react-native'], mobileVersions.package);
      assert.doesNotMatch(JSON.stringify(result.receipt), /file:|workspace:|\/tmp\//u);
      assert.equal(JSON.stringify(result.receipt).includes(root), false);
      const podfile = await readFile(join(f.directory, 'ios', 'Podfile'), 'utf8');
      assert.equal(podfile.match(/\$MLRN\.post_install/g)?.length, 1);
      assert.equal(podfile.match(/tileflow_native_admission_post_install/g)?.length, 1);
      if (kind === 'expo')
        await assert.rejects(access(join(f.directory, 'App.js')), {code: 'ENOENT'});
    });
  });
  for (const defect of ['android-discovery', 'ios-discovery', 'installed-bytes']) {
    test(`${kind} rejects ${defect} instead of recording consumer success`, async () => {
      let ownedRoot;
      await assert.rejects(
        withMobileWorkspace(async (root) => {
          ownedRoot = root;
          const f = await consumerFixture(root, kind, defect);
          await createMobileConsumer(f.context, kind, f.packages, f.templates);
        }),
        {code: defect === 'installed-bytes' ? 'INSTALL_INVALID' : 'AUTOLINK_INVALID'},
      );
      await assert.rejects(access(ownedRoot), {code: 'ENOENT'});
    });
  }
}

test('partial bare generator failure retires the exact workspace without attempting installation', async () => {
  let ownedRoot;
  let calls;
  await assert.rejects(
    withMobileWorkspace(async (root) => {
      ownedRoot = root;
      const f = await consumerFixture(root, 'bare', 'generator');
      calls = f.calls;
      await mkdir(join(root, 'partial'), {recursive: true});
      await createMobileConsumer(f.context, 'bare', f.packages, f.templates);
    }),
    {code: 'COMMAND_FAILED'},
  );
  assert.deepEqual(calls, ['generate']);
  await assert.rejects(access(ownedRoot), {code: 'ENOENT'});
});
