import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const kotlinString = (value) => JSON.stringify(value).replaceAll('$', '\\$');
const [candidate, output] = process.argv.slice(2);
if (
  !candidate ||
  !output ||
  !isAbsolute(candidate) ||
  !isAbsolute(output) ||
  process.argv.length !== 4
) {
  throw new Error(
    'Usage: native-consumers-prepare.mjs /absolute/candidate /new/absolute/consumers',
  );
}
const receipt = JSON.parse(await readFile(join(candidate, 'candidate.json'), 'utf8'));
await mkdir(output);
const ios = join(output, 'ios');
await mkdir(ios);
for (const path of ['Shared', 'UIKit', 'SwiftUI']) {
  await cp(resolve(root, 'platforms/ios/Examples', path), join(ios, path), {recursive: true});
}
const project = await readFile(resolve(root, 'platforms/ios/Examples/project.yml'), 'utf8');
await writeFile(
  join(ios, 'project.yml'),
  project.replace('path: ..', `path: ${JSON.stringify(join(candidate, 'swift'))}`),
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
await writeFile(
  join(android, 'example/build.gradle.kts'),
  build.replace(
    'implementation(project(":tileflow"))',
    `implementation(${kotlinString(receipt.android.coordinate)})`,
  ),
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
        maven { url = uri(${kotlinString(join(candidate, 'maven'))}) }
        google()
        mavenCentral()
    }
}
rootProject.name = "TileflowCandidateConsumer"
include(":example")
`,
);
await writeFile(
  join(output, 'candidate.json'),
  `${JSON.stringify(
    {
      candidate,
      runtimeHash: receipt.runtime.runtimeHash,
      coordinate: receipt.android.coordinate,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Independent consumers prepared at ${output}. Generate iOS with XcodeGen; Android uses only the local Maven coordinate.`,
);
