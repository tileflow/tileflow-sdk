import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Mobile jobs run on simulators, emulators and desktop engines. A pull request pays for them only
// when it changes something that reaches the embedded runtime, a native host or the React Native
// native modules; pushes and manual runs always run every job.
const runtimeInputs = [
  '.github/workflows/ci.yml',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'packages/core/',
  'packages/interactions/',
  'packages/mobile-runtime/',
  'scripts/mobile-',
];
const areaInputs = {
  runtime: runtimeInputs,
  ios: [...runtimeInputs, 'platforms/ios/'],
  // The Maven publication reads its coordinates and POM metadata from the native release catalog.
  // The Kotlin offline tests read the offline fixtures the Swift tests own.
  android: [
    ...runtimeInputs,
    'platforms/android/',
    'platforms/native-release.json',
    'platforms/ios/Tests/TileflowTests/Fixtures/Offline/',
  ],
  reactNative: [
    '.github/workflows/ci.yml',
    'packages/react-native/android/',
    'platforms/android/gradle/',
    'platforms/android/gradlew',
    'test-support/react-native-',
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
