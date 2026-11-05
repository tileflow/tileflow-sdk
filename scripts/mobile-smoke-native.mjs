import {realpath, stat} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {
  assertHermesBytecode,
  assertMobilePlatform,
  MobileSmokeError,
  mobileVersions,
  requireMobile,
} from './mobile-smoke-contract.mjs';
import {parseCommandJson} from './mobile-smoke-pack.mjs';
import {
  assertOwnedPath,
  mobileFileIdentity,
  readMobileFile,
  readMobileJson,
  writeMobileFile,
} from './mobile-smoke-workspace.mjs';
import {primaryFileNames} from './native-maven-bundle.mjs';
import {readNativeReleaseCatalog} from './native-release-config.mjs';

/**
 * The native SDK candidate the consumers build against, from TILEFLOW_NATIVE_CANDIDATE: a
 * directory that `scripts/native-release-prepare.mjs` wrote, with the Swift package and the Maven
 * repository of one version. Native builds need it until the native SDKs are published.
 */
export async function readNativeCandidate(context) {
  const directory = context.env.TILEFLOW_NATIVE_CANDIDATE;
  const missing = () =>
    new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', 'native-candidate');
  if (!directory || !isAbsolute(directory) || resolve(directory) !== directory) throw missing();
  let receipt;
  try {
    receipt = JSON.parse(
      (await readMobileFile(directory, join(directory, 'candidate.json'))).toString(),
    );
  } catch {
    throw missing();
  }
  const version = receipt?.version;
  const swift = join(directory, receipt?.swift?.path ?? 'swift');
  const maven = join(directory, 'maven');
  if (
    receipt?.schemaVersion !== 1 ||
    typeof version !== 'string' ||
    !/^[0-9A-Za-z.-]+$/u.test(version)
  )
    throw missing();
  try {
    await stat(join(directory, 'INCOMPLETE'));
    throw missing();
  } catch (error) {
    if (error.code !== 'ENOENT') throw missing();
  }
  const catalog = await readNativeReleaseCatalog();
  const paths = [join(swift, 'Package.swift')];
  if (Object.keys(receipt.android?.modules ?? {}).length !== catalog.maven.publications.length)
    throw missing();
  for (const {module, artifactId} of catalog.maven.publications) {
    const coordinate = `${catalog.maven.group}:${artifactId}:${version}`;
    if (
      receipt.android.modules[module] !== coordinate ||
      (module === 'tileflow' && receipt.android.coordinate !== coordinate)
    )
      throw missing();
    paths.push(
      ...primaryFileNames(artifactId, version).map((name) =>
        join(maven, catalog.maven.group.replaceAll('.', '/'), artifactId, version, name),
      ),
    );
  }
  for (const path of paths) {
    try {
      await assertOwnedPath(directory, path);
      if (!(await stat(path)).isFile()) throw missing();
    } catch {
      throw missing();
    }
  }
  return {directory, version, swift, maven};
}

const minimumIos = '16.0';
const minimumAndroid = 26;

/** Raises a consumer Podfile's platform and its Xcode project's deployment target to iOS 16. */
export function iosConsumerFiles(podfile, project) {
  const platform = /^platform :ios, .*$/mu;
  requireMobile(platform.test(podfile), 'TEMPLATE_INVALID', 'ios');
  return {
    podfile: podfile.replace(platform, `platform :ios, '${minimumIos}'`),
    project: project.replaceAll(
      /IPHONEOS_DEPLOYMENT_TARGET = (?:1[0-5](?:\.\d+)?|"1[0-5](?:\.\d+)?");/gu,
      `IPHONEOS_DEPLOYMENT_TARGET = ${minimumIos};`,
    ),
  };
}

/** Points a consumer's Gradle build at the candidate and raises its minimum to API 26. */
export function androidConsumerFiles(properties, build, candidate) {
  const repository = `maven { url = uri(${JSON.stringify(candidate.maven)}) }`;
  const nextProperties = `${properties.replace(/\s*$/u, '')}
tileflowMavenRepository=${candidate.maven}
tileflowNativeVersion=${candidate.version}
android.minSdkVersion=${minimumAndroid}
`;
  let nextBuild = build.replace(/minSdkVersion = (\d+)/u, (line, value) =>
    Number(value) < minimumAndroid ? `minSdkVersion = ${minimumAndroid}` : line,
  );
  nextBuild = /allprojects\s*\{\s*\n\s*repositories\s*\{/u.test(nextBuild)
    ? nextBuild.replace(/(allprojects\s*\{\s*\n\s*repositories\s*\{\n)/u, `$1    ${repository}\n`)
    : `${nextBuild.replace(/\s*$/u, '')}\n\nallprojects {\n  repositories {\n    ${repository}\n  }\n}\n`;
  return {properties: nextProperties, build: nextBuild};
}

export async function checkMobilePrerequisites(
  context,
  mode,
  packageManager,
  pnpm,
  platform = process.platform,
) {
  assertMobilePlatform(mode, platform);
  const requirePrerequisite = (condition, name, code = 'PREREQUISITE_MISSING') => {
    if (!condition) throw new MobileSmokeError(code, 'prerequisites', name);
  };
  requirePrerequisite(
    Number(process.versions.node.split('.')[0]) >= 22,
    'node',
    'TOOLCHAIN_MISMATCH',
  );
  const probe = async (name, command, args) => {
    try {
      return await context.run(command, args, {
        step: 'prerequisites',
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024,
      });
    } catch (error) {
      throw new MobileSmokeError(
        error instanceof MobileSmokeError ? error.code : 'PREREQUISITE_MISSING',
        'prerequisites',
        name,
      );
    }
  };
  const pnpmVersion = (await probe('pnpm', pnpm.command, [...pnpm.prefix, '--version'])).stdout
    .toString()
    .trim();
  const npmVersion = (await probe('npm', 'npm', ['--version'])).stdout.toString().trim();
  requirePrerequisite(packageManager === `pnpm@${pnpmVersion}`, 'pnpm', 'TOOLCHAIN_MISMATCH');
  requirePrerequisite(/^\d+\.\d+\.\d+$/u.test(npmVersion), 'npm', 'TOOLCHAIN_MISMATCH');
  await probe('tar', 'tar', ['--version']);
  const tools = {node: process.versions.node, pnpm: pnpmVersion, npm: npmVersion};
  if (mode !== 'packed') tools.nativeCandidate = (await readNativeCandidate(context)).version;
  if (mode === 'android') {
    const javaHome = context.env.JAVA_HOME;
    const java17Home = context.env.TILEFLOW_JAVA_17_HOME;
    const sdk = context.env.ANDROID_HOME ?? context.env.ANDROID_SDK_ROOT;
    requirePrerequisite(javaHome && resolve(javaHome) === javaHome, 'java-21');
    requirePrerequisite(
      java17Home && isAbsolute(java17Home) && resolve(java17Home) === java17Home,
      'java-17',
    );
    requirePrerequisite(sdk && resolve(sdk) === sdk, 'android-sdk-36');
    if (context.env.ANDROID_HOME && context.env.ANDROID_SDK_ROOT) {
      try {
        requirePrerequisite(
          (await realpath(context.env.ANDROID_HOME)) ===
            (await realpath(context.env.ANDROID_SDK_ROOT)),
          'android-sdk-36',
          'TOOLCHAIN_MISMATCH',
        );
      } catch (error) {
        throw error instanceof MobileSmokeError
          ? error
          : new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', 'android-sdk-36');
      }
    }
    const inputs = [
      ['java-21', join(javaHome, 'bin', 'java')],
      ['java-21', join(javaHome, 'bin', 'javac')],
      ['java-17', join(java17Home, 'bin', 'java')],
      ['java-17', join(java17Home, 'bin', 'javac')],
      [
        'android-sdk-36',
        join(sdk, 'platforms', `android-${mobileVersions.compileSdk}`, 'android.jar'),
      ],
      ['android-build-tools-36.0.0', join(sdk, 'build-tools', mobileVersions.buildTools, 'aapt2')],
      ['android-ndk-27.1.12297006', join(sdk, 'ndk', mobileVersions.ndk, 'source.properties')],
      ['android-sdk-licenses', join(sdk, 'licenses', 'android-sdk-license')],
    ];
    for (const [name, path] of inputs) {
      try {
        const metadata = await stat(path);
        requirePrerequisite(metadata.isFile() && metadata.size > 0, name);
      } catch {
        throw new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', name);
      }
    }
    const java = await probe('java-21', join(javaHome, 'bin', 'java'), ['-version']);
    const javac = await probe('java-21', join(javaHome, 'bin', 'javac'), ['-version']);
    const javaVersion = Buffer.concat([java.stdout, java.stderr])
      .toString()
      .match(/version "(21\.[\d.]+)(?:[^"\n]*)"/u)?.[1];
    requirePrerequisite(
      javaVersion &&
        /^javac 21\./u.test(Buffer.concat([javac.stdout, javac.stderr]).toString().trim()),
      'java-21',
      'TOOLCHAIN_MISMATCH',
    );
    const java17 = await probe('java-17', join(java17Home, 'bin', 'java'), ['-version']);
    const javac17 = await probe('java-17', join(java17Home, 'bin', 'javac'), ['-version']);
    const compilerVersion = Buffer.concat([java17.stdout, java17.stderr])
      .toString()
      .match(/version "(17\.[\d.]+)(?:[^"\n]*)"/u)?.[1];
    requirePrerequisite(
      compilerVersion &&
        /^javac 17\./u.test(Buffer.concat([javac17.stdout, javac17.stderr]).toString().trim()),
      'java-17',
      'TOOLCHAIN_MISMATCH',
    );
    await probe('unzip', 'unzip', ['-v']);
    Object.assign(tools, {
      java: javaVersion,
      javaToolchain17: compilerVersion,
      compileSdk: mobileVersions.compileSdk,
      buildTools: mobileVersions.buildTools,
      ndk: mobileVersions.ndk,
    });
  } else if (mode === 'ios') {
    await probe('xcode', 'xcode-select', ['-p']);
    const xcode = (await probe('xcode', 'xcodebuild', ['-version'])).stdout
      .toString()
      .match(/^Xcode ([\d.]+)$/mu)?.[1];
    const simulatorSdk = (
      await probe('ios-simulator-sdk', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])
    ).stdout
      .toString()
      .trim();
    const cocoaPods = (await probe('cocoapods', 'pod', ['--version'])).stdout.toString().trim();
    requirePrerequisite(xcode, 'xcode', 'TOOLCHAIN_MISMATCH');
    requirePrerequisite(
      /^\d+(?:\.\d+)+$/u.test(simulatorSdk),
      'ios-simulator-sdk',
      'TOOLCHAIN_MISMATCH',
    );
    requirePrerequisite(/^\d+\.\d+\.\d+$/u.test(cocoaPods), 'cocoapods', 'TOOLCHAIN_MISMATCH');
    Object.assign(tools, {xcode, simulatorSdk, cocoaPods});
  }
  return tools;
}

export function androidReleaseArguments(javaHome, java17Home) {
  for (const [home, name] of [
    [javaHome, 'java-21'],
    [java17Home, 'java-17'],
  ]) {
    if (!home || !isAbsolute(home) || resolve(home) !== home)
      throw new MobileSmokeError('PREREQUISITE_MISSING', 'prerequisites', name);
  }
  return [
    ':app:assembleRelease',
    '--no-daemon',
    '--console=plain',
    '--max-workers=2',
    '-PhermesEnabled=true',
    '-Pandroid.builder.sdkDownload=false',
    `-Porg.gradle.java.installations.paths=${java17Home},${javaHome}`,
    '-Porg.gradle.java.installations.auto-download=false',
    '-Dorg.gradle.internal.http.connectionTimeout=120000',
    '-Dorg.gradle.internal.http.socketTimeout=120000',
  ];
}
export function iosReleaseArguments(consumer, derived, packages) {
  return [
    '-workspace',
    join(consumer.directory, 'ios', `${consumer.scheme}.xcworkspace`),
    '-scheme',
    consumer.scheme,
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    derived,
    '-clonedSourcePackagesDirPath',
    packages,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
  ];
}

export async function buildMobileAndroid(context, consumer) {
  const directory = join(consumer.directory, 'android');
  const step = `android-${consumer.kind}`;
  const wrapper = (
    await readMobileFile(
      context.root,
      join(directory, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    )
  ).toString();
  requireMobile(
    wrapper.includes(`gradle-${mobileVersions.gradle}-bin.zip`) &&
      wrapper.includes('services.gradle.org/distributions/'),
    'TEMPLATE_INVALID',
    step,
  );
  const candidate = await readNativeCandidate(context);
  const files = androidConsumerFiles(
    (await readMobileFile(context.root, join(directory, 'gradle.properties'))).toString(),
    (await readMobileFile(context.root, join(directory, 'build.gradle'))).toString(),
    candidate,
  );
  await writeMobileFile(context.root, join(directory, 'gradle.properties'), files.properties);
  await writeMobileFile(context.root, join(directory, 'build.gradle'), files.build);
  await context.run(
    join(directory, 'gradlew'),
    androidReleaseArguments(context.env.JAVA_HOME, context.env.TILEFLOW_JAVA_17_HOME),
    {
      cwd: directory,
      step,
      timeoutMs: 60 * 60 * 1000,
    },
  );
  const output = join(directory, 'app', 'build', 'outputs', 'apk', 'release');
  const metadata = await readMobileJson(context.root, join(output, 'output-metadata.json'));
  requireMobile(
    metadata.variantName === 'release' &&
      Array.isArray(metadata.elements) &&
      metadata.elements.length > 0 &&
      metadata.elements.length <= 8,
    'BINARY_INVALID',
    step,
  );
  const names = metadata.elements.map((element) => element.outputFile);
  requireMobile(
    names.every((name) => typeof name === 'string' && /^[A-Za-z0-9._-]+\.apk$/u.test(name)) &&
      new Set(names).size === names.length,
    'BINARY_INVALID',
    step,
  );
  const apks = [];
  for (const name of names.sort()) {
    const apk = join(output, name);
    await assertOwnedPath(context.root, apk);
    const bundle = await context.run('unzip', ['-p', apk, 'assets/index.android.bundle'], {
      step,
      maxOutputBytes: 64 * 1024 * 1024,
    });
    const hermes = assertHermesBytecode(bundle.stdout);
    apks.push({
      ...(await mobileFileIdentity(context.root, apk, `${consumer.kind}/${name}`)),
      hermes,
    });
  }
  return {
    consumer: consumer.kind,
    platform: 'android',
    configuration: 'Release',
    gradle: mobileVersions.gradle,
    nativeCandidate: candidate.version,
    files: apks,
  };
}

export async function buildMobileIos(context, consumer) {
  const directory = join(consumer.directory, 'ios');
  const step = `ios-${consumer.kind}`;
  const candidate = await readNativeCandidate(context);
  const podfilePath = join(directory, 'Podfile');
  const projectPath = join(directory, `${consumer.scheme}.xcodeproj`, 'project.pbxproj');
  const files = iosConsumerFiles(
    (await readMobileFile(context.root, podfilePath)).toString(),
    (await readMobileFile(context.root, projectPath)).toString(),
  );
  await writeMobileFile(context.root, podfilePath, files.podfile);
  await writeMobileFile(context.root, projectPath, files.project);
  await context.run('pod', ['install'], {
    cwd: directory,
    step,
    timeoutMs: 30 * 60 * 1000,
    env: {USE_HERMES: '1', TILEFLOW_SWIFT_PACKAGE_PATH: candidate.swift},
  });
  const lockPath = join(directory, 'Podfile.lock');
  const lock = (await readMobileFile(context.root, lockPath)).toString();
  requireMobile(
    /TileflowReactNative \(/u.test(lock) && !/MapLibreReactNative \(/u.test(lock),
    'AUTOLINK_INVALID',
    step,
  );
  const derived = join(context.root, `derived-${consumer.kind}`);
  const packages = join(context.root, `spm-${consumer.kind}`);
  const args = iosReleaseArguments(consumer, derived, packages);
  await context.run('xcodebuild', [...args, '-quiet', 'build'], {
    cwd: directory,
    step,
    timeoutMs: 60 * 60 * 1000,
    env: {USE_HERMES: '1'},
  });
  const settings = parseCommandJson(
    await context.run('xcodebuild', [...args, '-quiet', '-showBuildSettings', '-json'], {
      cwd: directory,
      step,
      timeoutMs: 5 * 60 * 1000,
    }),
  );
  requireMobile(Array.isArray(settings), 'BINARY_INVALID', step);
  const targets = settings.filter(
    (entry) => entry.target === consumer.scheme && entry.buildSettings?.WRAPPER_EXTENSION === 'app',
  );
  requireMobile(targets.length === 1, 'BINARY_INVALID', step);
  const build = targets[0].buildSettings;
  requireMobile(
    build.CONFIGURATION === 'Release' &&
      build.PLATFORM_NAME === 'iphonesimulator' &&
      typeof build.TARGET_BUILD_DIR === 'string' &&
      /^[A-Za-z0-9_-]+\.app$/u.test(build.WRAPPER_NAME) &&
      /^[A-Za-z0-9_-]+$/u.test(build.EXECUTABLE_NAME),
    'BINARY_INVALID',
    step,
  );
  const app = join(build.TARGET_BUILD_DIR, build.WRAPPER_NAME);
  await assertOwnedPath(derived, app);
  const bundlePath = join(app, 'main.jsbundle');
  const hermes = assertHermesBytecode(
    await readMobileFile(context.root, bundlePath, 64 * 1024 * 1024),
  );
  const executable = await mobileFileIdentity(
    context.root,
    join(app, build.EXECUTABLE_NAME),
    `${consumer.kind}/${build.WRAPPER_NAME}/${build.EXECUTABLE_NAME}`,
  );
  const bundle = await mobileFileIdentity(
    context.root,
    bundlePath,
    `${consumer.kind}/${build.WRAPPER_NAME}/main.jsbundle`,
  );
  const frameworks = await verifyIosEmbeddedFrameworks(
    context,
    app,
    build.EXECUTABLE_NAME,
    consumer.kind,
  );
  return {
    consumer: consumer.kind,
    platform: 'ios',
    destination: 'simulator',
    configuration: 'Release',
    hermes,
    nativeCandidate: candidate.version,
    files: [executable, bundle, ...frameworks],
    podsLock: await mobileFileIdentity(context.root, lockPath, `${consumer.kind}-Podfile.lock`),
  };
}

/** Follow the app's dynamic framework links, including links between embedded frameworks. */
export async function verifyIosEmbeddedFrameworks(context, app, executable, kind) {
  const step = `ios-${kind}`;
  const pending = [join(app, executable)];
  const visited = new Set(pending);
  const files = [];

  while (pending.length) {
    const binary = pending.shift();
    await assertOwnedPath(context.root, binary);
    const linked = await context.run('xcrun', ['otool', '-L', binary], {step});
    const dependencies = [
      ...linked.stdout.toString().matchAll(/^\s+(@rpath\/\S+\.framework\/\S+)\s+\(/gmu),
    ];

    for (const [, dependency] of dependencies) {
      const match = /^@rpath\/([A-Za-z0-9_.-]+)\.framework\/\1$/u.exec(dependency);
      requireMobile(match, 'BINARY_INVALID', step);
      const relative = `Frameworks/${match[1]}.framework/${match[1]}`;
      const path = join(app, relative);
      if (visited.has(path)) continue;
      visited.add(path);

      try {
        files.push(
          await mobileFileIdentity(
            context.root,
            path,
            `${kind}/${app.split('/').at(-1)}/${relative}`,
          ),
        );
      } catch (error) {
        if (error.code === 'ENOENT') throw new MobileSmokeError('BINARY_INVALID', step);
        throw error;
      }
      pending.push(path);
    }
  }

  return files;
}
