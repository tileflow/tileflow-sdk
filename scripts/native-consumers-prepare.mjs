import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Prepares independent consumers of a native candidate: the UIKit and SwiftUI examples, the Swift
// integration tests hosted in an app, and the Android example. They use only the candidate's Swift
// package and Maven repository, never this repository's sources.
//
//   --swift-url URL         resolve the Swift package from a git URL at the candidate's exact
//                           version tag (as SwiftPM consumers do) instead of a local path
//   --maven-repository DIR  resolve Android artifacts from another local repository, such as an
//                           signed Maven bundle, instead of the candidate's `maven/`

const root = fileURLToPath(new URL('../', import.meta.url));
const kotlinString = (value) => JSON.stringify(value).replaceAll('$', '\\$');
const usage =
  'Usage: native-consumers-prepare.mjs /absolute/candidate /new/absolute/consumers [--swift-url URL] [--maven-repository /absolute/repository|https://repository]';
const [candidate, output, ...rest] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < rest.length; index += 2) {
  const [key, value] = rest.slice(index, index + 2);
  if (!['--swift-url', '--maven-repository'].includes(key) || !value || options.has(key)) {
    throw new Error(usage);
  }
  options.set(key, value);
}
if (!candidate || !output || !isAbsolute(candidate) || !isAbsolute(output)) throw new Error(usage);
const mavenRepository = options.get('--maven-repository') ?? join(candidate, 'maven');
if (!isAbsolute(mavenRepository) && !/^https:\/\/[^\s]+$/u.test(mavenRepository))
  throw new Error(usage);
const receipt = JSON.parse(await readFile(join(candidate, 'candidate.json'), 'utf8'));
const swiftPackage = join(candidate, receipt.swift?.path ?? 'swift');
const packageReference = options.has('--swift-url')
  ? `url: ${JSON.stringify(options.get('--swift-url'))}\n    exactVersion: ${JSON.stringify(receipt.version)}`
  : `path: ${JSON.stringify(swiftPackage)}`;
const replacePackage = (project) => {
  if (!project.includes('    path: ..\n'))
    throw new Error('Unexpected XcodeGen package reference.');
  return project.replace('    path: ..\n', `    ${packageReference}\n`);
};
await mkdir(output);
const ios = join(output, 'ios');
await mkdir(ios);
for (const path of ['Shared', 'UIKit', 'SwiftUI']) {
  await cp(resolve(root, 'platforms/ios/Examples', path), join(ios, path), {recursive: true});
}
const project = await readFile(resolve(root, 'platforms/ios/Examples/project.yml'), 'utf8');
await writeFile(join(ios, 'project.yml'), replacePackage(project));

// The integration tests run against the candidate's package and its own copy of the tests.
const integration = join(output, 'ios-integration');
await mkdir(integration);
for (const path of ['AppDelegate.swift', 'TestBundle.swift', 'ServiceContentTests.swift']) {
  await cp(resolve(root, 'platforms/ios/IntegrationTests', path), join(integration, path));
}
const integrationProject = replacePackage(
  await readFile(resolve(root, 'platforms/ios/IntegrationTests/project.yml'), 'utf8'),
)
  .replaceAll('../Tests/TileflowTests', join(swiftPackage, 'Tests/TileflowTests'))
  .replaceAll('../Tests/TileflowServiceTests', join(swiftPackage, 'Tests/TileflowServiceTests'));
if (integrationProject.includes('../'))
  throw new Error('The integration project still uses sources.');
await writeFile(join(integration, 'project.yml'), integrationProject);

const servicesIos = join(output, 'ios-services');
await mkdir(servicesIos);
await writeFile(
  join(servicesIos, 'project.yml'),
  `name: TileflowServicesConsumer
options:
  deploymentTarget:
    iOS: '16.0'
packages:
  Tileflow:
    ${packageReference}
settings:
  base:
    SWIFT_VERSION: '6.0'
    GENERATE_INFOPLIST_FILE: YES
    CODE_SIGNING_ALLOWED: NO
targets:
  ServicesExample:
    type: application
    platform: iOS
    sources: [AppDelegate.swift]
    dependencies:
      - package: Tileflow
        product: TileflowServices
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: dev.tileflow.candidate.services
`,
);
await writeFile(
  join(servicesIos, 'AppDelegate.swift'),
  `import UIKit
import TileflowServices

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let configuration = try! TileflowConfiguration()
    _ = TileflowSearch(configuration: configuration)
    _ = TileflowRouting(configuration: configuration)
    _ = TileflowElevation(configuration: configuration)
    _ = TileflowGeoIP(configuration: configuration)
    return true
  }
}
`,
);

const android = join(output, 'android');
await mkdir(android);
for (const path of ['gradle', 'gradlew', 'gradlew.bat', 'gradle.properties']) {
  await cp(resolve(root, 'platforms/android', path), join(android, path), {recursive: true});
}
await cp(resolve(root, 'platforms/android/example/src'), join(android, 'example/src'), {
  recursive: true,
});
const build = await readFile(resolve(root, 'platforms/android/example/build.gradle.kts'), 'utf8');
const modules = receipt.android.modules ?? {tileflow: receipt.android.coordinate};
const consumerBuild = build.replaceAll(
  /implementation\(project\(":([a-z-]+)"\)\)/gu,
  (line, module) => {
    if (!modules[module]) throw new Error(`The candidate has no artifact for :${module}.`);
    return `implementation(${kotlinString(modules[module])})`;
  },
);
if (consumerBuild.includes('project(')) throw new Error('The example still uses a project.');
await writeFile(join(android, 'example/build.gradle.kts'), consumerBuild);
const servicesAndroid = join(android, 'services');
await mkdir(join(servicesAndroid, 'src/main/java/dev/tileflow/candidate/services'), {
  recursive: true,
});
if (!modules['tileflow-services'] || !modules['tileflow-foundation'])
  throw new Error('The candidate must include services and foundation.');
await writeFile(
  join(servicesAndroid, 'build.gradle.kts'),
  `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "dev.tileflow.candidate.services"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.tileflow.candidate.services"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = ${kotlinString(receipt.version)}
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(${kotlinString(modules['tileflow-services'])})
}
`,
);
await writeFile(
  join(servicesAndroid, 'src/main/AndroidManifest.xml'),
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="Services">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
);
await writeFile(
  join(servicesAndroid, 'src/main/java/dev/tileflow/candidate/services/MainActivity.kt'),
  `package dev.tileflow.candidate.services

import android.app.Activity
import android.os.Bundle
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.search.TileflowSearch
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.elevation.TileflowElevation
import dev.tileflow.geoip.TileflowGeoIP

class MainActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val configuration = TileflowConfiguration()
        TileflowSearch(this, configuration)
        TileflowRouting(this, configuration)
        TileflowElevation(this, configuration)
        TileflowGeoIP(this, configuration)
    }
}
`,
);
const plugins = await readFile(resolve(root, 'platforms/android/build.gradle.kts'), 'utf8');
await writeFile(
  join(android, 'build.gradle.kts'),
  plugins
    .split('\n')
    .filter((line) => !line.includes('org.jetbrains.dokka'))
    .join('\n'),
);
await writeFile(
  join(android, 'settings.gradle.kts'),
  `pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        exclusiveContent {
            forRepository { maven { url = uri(${kotlinString(mavenRepository)}) } }
            filter { includeGroup(${kotlinString(receipt.android.coordinate.split(':')[0])}) }
        }
        google()
        mavenCentral()
    }
}
rootProject.name = "TileflowCandidateConsumer"
include(":example", ":services")
`,
);
await writeFile(
  join(output, 'candidate.json'),
  `${JSON.stringify(
    {
      candidate,
      version: receipt.version,
      engines: receipt.engines,
      coordinate: receipt.android.coordinate,
      swiftPackage: options.get('--swift-url') ?? swiftPackage,
      mavenRepository,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Independent consumers prepared at ${output}. Generate the iOS projects with XcodeGen; Android resolves ${receipt.android.coordinate} only from ${mavenRepository}.`,
);
