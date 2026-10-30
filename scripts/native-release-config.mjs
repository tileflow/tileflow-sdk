import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// The native catalog is shared with Gradle (`platforms/android/gradle/publishing.gradle.kts`):
// one place names every published Maven artifact and the Swift distribution repository.
export const nativeReleaseCatalogPath = 'platforms/native-release.json';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const alphaPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/u;
const repositoryPattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;
const artifactPattern = /^[a-z][a-z0-9-]*$/u;

export async function readNativeReleaseCatalog(root = repositoryRoot) {
  const source = await readFile(resolve(root, nativeReleaseCatalogPath), 'utf8');
  return validateNativeReleaseCatalog(JSON.parse(source));
}

export function validateNativeReleaseCatalog(catalog) {
  const fail = (message) => {
    throw new TypeError(`${nativeReleaseCatalogPath}: ${message}`);
  };
  if (catalog?.schemaVersion !== 1) fail('unsupported schemaVersion.');
  if (!parseAlphaVersion(catalog.initialVersion)) fail('initialVersion must be X.Y.Z-alpha.N.');
  if (!repositoryPattern.test(catalog.sourceRepository ?? '')) fail('invalid sourceRepository.');
  if (!repositoryPattern.test(catalog.swift?.repository ?? '')) fail('invalid swift.repository.');
  if (catalog.swift.branch !== 'main') fail('swift.branch must be main.');
  for (const key of ['name', 'url', 'organizationUrl']) {
    if (!/^\S.*\S$/u.test(catalog.project?.[key] ?? '')) fail(`project.${key} is required.`);
  }
  if (!catalog.project.license?.name || !catalog.project.license?.url) {
    fail('project.license needs a name and url.');
  }
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test(catalog.maven?.group ?? '')) {
    fail('invalid maven.group.');
  }
  const publications = catalog.maven.publications;
  if (!Array.isArray(publications) || publications.length === 0) fail('no Maven publications.');
  const modules = new Set();
  const artifacts = new Set();
  for (const publication of publications) {
    for (const key of ['module', 'artifactId', 'name', 'description']) {
      if (typeof publication?.[key] !== 'string' || publication[key].trim() !== publication[key]) {
        fail(`publication ${JSON.stringify(publication?.module)} needs a trimmed ${key}.`);
      }
    }
    if (
      !artifactPattern.test(publication.module) ||
      !artifactPattern.test(publication.artifactId)
    ) {
      fail(`publication ${publication.module} has an invalid module or artifactId.`);
    }
    if (modules.has(publication.module) || artifacts.has(publication.artifactId)) {
      fail(`publication ${publication.module} is duplicated.`);
    }
    modules.add(publication.module);
    artifacts.add(publication.artifactId);
  }
  return catalog;
}

/** `X.Y.Z-alpha.N` only: native releases follow the npm alpha channel and never infer intent. */
export function parseAlphaVersion(version) {
  const match = alphaPattern.exec(typeof version === 'string' ? version : '');
  if (!match) return null;
  const [major, minor, patch, alpha] = match.slice(1).map(Number);
  return {major, minor, patch, alpha};
}

export function compareAlphaVersions(left, right) {
  const a = parseAlphaVersion(left);
  const b = parseAlphaVersion(right);
  if (!a || !b) throw new TypeError(`Cannot compare ${left} and ${right}.`);
  for (const key of ['major', 'minor', 'patch', 'alpha']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}

/**
 * One version names every native artifact of a release: the Swift tag and all Maven coordinates.
 * The latest version visible on either side is the baseline, so a release that reached only one
 * side is never reused. Anything other than an alpha version fails closed.
 */
export function planNativeVersion({initialVersion, swiftVersions, mavenVersions}) {
  if (!parseAlphaVersion(initialVersion)) throw new TypeError('Invalid initial version.');
  const unexpected = [...swiftVersions, ...mavenVersions].filter((v) => !parseAlphaVersion(v));
  if (unexpected.length > 0) {
    throw new Error(
      `Published native versions must be X.Y.Z-alpha.N; found ${[...new Set(unexpected)].join(', ')}.`,
    );
  }
  const published = [...new Set([...swiftVersions, ...mavenVersions])].sort(compareAlphaVersions);
  const from = published.at(-1) ?? null;
  let to = initialVersion;
  if (from) {
    const {major, minor, patch, alpha} = parseAlphaVersion(from);
    to = `${major}.${minor}.${patch}-alpha.${alpha + 1}`;
  }
  const swift = new Set(swiftVersions);
  const maven = new Set(mavenVersions);
  return {
    from,
    to,
    incomplete: published.filter((version) => !swift.has(version) || !maven.has(version)),
  };
}

export function swiftRemotes(catalog) {
  return {
    fetch: `https://github.com/${catalog.swift.repository}.git`,
    push: `git@github.com:${catalog.swift.repository}.git`,
  };
}

export function mavenArtifactDirectory(catalog, artifactId) {
  return `${catalog.maven.group.replaceAll('.', '/')}/${artifactId}`;
}
