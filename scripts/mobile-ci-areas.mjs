import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Pull requests select the affected native hosts. Pushes and manual runs exercise them all.
const hostedSessionFixtures = 'test-support/mobile/hosted/';
const mapApi = 'platforms/map-api.json';
const nativeInputs = [
  '.github/workflows/ci.yml',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'packages/core/',
  'packages/interactions/',
  'scripts/mobile-',
  'scripts/native-golden-generate.mjs',
  hostedSessionFixtures,
  mapApi,
];
// The fixture server builds its native map with @tileflow/dev from an official map.
const nativeFixtureInputs = ['packages/dev/', 'packages/maps/'];
const areaInputs = {
  ios: [...nativeInputs, ...nativeFixtureInputs, 'platforms/ios/'],
  // The Maven publication reads its coordinates and POM metadata from the native release catalog.
  // The Kotlin tests read the offline, marine and native evaluator fixtures the Swift tests own.
  android: [
    ...nativeInputs,
    ...nativeFixtureInputs,
    'platforms/android/',
    'platforms/native-release.json',
    'platforms/ios/Tests/TileflowTests/Fixtures/Offline/',
    'platforms/ios/Tests/TileflowTests/Fixtures/Marine/',
    'platforms/ios/Tests/TileflowTests/Fixtures/Native/',
  ],
  reactNative: [
    '.github/workflows/ci.yml',
    'packages/react-native/android/',
    'platforms/android/gradle/',
    'platforms/android/gradlew',
    'test-support/react-native-',
    hostedSessionFixtures,
    mapApi,
  ],
};

// Inputs ending in a separator are prefixes; the others name exact files.
const matches = (path, input) => (/[/-]$/u.test(input) ? path.startsWith(input) : path === input);

/** Paths are repository-relative. A null path list means the change set is unknown. */
export function mobileAreas(paths) {
  return Object.fromEntries(
    Object.entries(areaInputs).map(([area, inputs]) => [
      area,
      paths === null || paths.some((path) => inputs.some((input) => matches(path, input))),
    ]),
  );
}

function changedPaths({event, base}) {
  if (event !== 'pull_request' && event !== 'merge_group') return null;
  // A pull_request checkout is GitHub's merge commit; its first parent is the target branch.
  const from = event === 'pull_request' ? 'HEAD^1' : base;
  if (!from) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', from, 'HEAD'], {encoding: 'utf8'})
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = changedPaths({
    event: process.env.GITHUB_EVENT_NAME,
    base: process.env.MOBILE_CI_BASE,
  });
  const areas = mobileAreas(paths);
  console.error(
    paths === null
      ? 'Change set unknown: every mobile job runs.'
      : `${paths.length} changed paths.`,
  );
  for (const [area, selected] of Object.entries(areas)) console.log(`${area}=${selected}`);
}
