import {appendFile, writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMavenMetadata} from './native-maven-bundle.mjs';
import {
  parseReservationIndex,
  readAnonymousMavenFile,
  reservationIndexKey,
} from './native-maven-repository.mjs';
import {
  compareAlphaVersions,
  mavenArtifactDirectory,
  parseAlphaVersion,
  planNativeVersion,
  readNativeReleaseCatalog,
  swiftRemotes,
} from './native-release-config.mjs';
import {swiftVersions} from './native-swift-release.mjs';

// A fresh dispatch advances past both published and reserved native versions.

/** Includes every listed version and records which ones are absent from some artifacts. */
async function mavenVersionState(
  catalog,
  {fetch: request = fetch, baseUrl = catalog.maven.repositoryUrl} = {},
) {
  const {group, publications} = catalog.maven;
  const appearances = new Map();

  for (const {artifactId} of publications) {
    const url = `${baseUrl}/${mavenArtifactDirectory(catalog, artifactId)}/maven-metadata.xml`;
    const response = await request(url, {headers: {'cache-control': 'no-cache'}});
    if (response.status === 404) continue;
    if (!response.ok)
      throw new Error(`${url} answered ${response.status}; the release cannot be planned.`);

    const versions = readMavenMetadata(Buffer.from(await response.arrayBuffer()), {
      key: url,
      group,
      artifactId,
      acceptsVersion: parseAlphaVersion,
    });
    for (const version of versions) appearances.set(version, (appearances.get(version) ?? 0) + 1);
  }

  const versions = [...appearances.keys()];
  const incomplete = versions.filter((version) => appearances.get(version) < publications.length);
  return {versions, incomplete};
}

export async function mavenVersions(catalog, options) {
  return (await mavenVersionState(catalog, options)).versions;
}

export async function planNativeRelease({catalog, sourceRevision, swiftRemote, request}) {
  const maven = await mavenVersionState(catalog, {fetch: request});
  const index = await readAnonymousMavenFile(catalog.maven.repositoryUrl, reservationIndexKey, {
    request,
  });
  const reserved = index ? parseReservationIndex(index, catalog) : [];
  const plan = planNativeVersion({
    initialVersion: catalog.initialVersion,
    swiftVersions: await swiftVersions(swiftRemote),
    mavenVersions: [...maven.versions, ...reserved],
  });
  const unpublished = reserved.filter((version) => !maven.versions.includes(version));
  const incompleteVersions = [
    ...new Set([...plan.incomplete, ...maven.incomplete, ...unpublished]),
  ];
  return {
    schemaVersion: 1,
    signingTimeUnix: Math.floor(Date.now() / 1000),
    sourceRevision,
    version: plan.to,
    previousVersion: plan.from,
    incompleteVersions: incompleteVersions.sort(compareAlphaVersions),
    swift: {repository: catalog.swift.repository},
    maven: {
      group: catalog.maven.group,
      artifacts: catalog.maven.publications.map(({artifactId}) => artifactId),
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key) => args[args.indexOf(key) + 1];
  const output = value('--output');
  const sourceRevision = value('--source-revision');
  if (!output || !isAbsolute(output) || !/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')) {
    throw new Error(
      'Usage: native-release-plan.mjs --source-revision <sha> --output /absolute/plan.json [--swift-remote URL]',
    );
  }
  const catalog = await readNativeReleaseCatalog();
  const swiftRemote = args.includes('--swift-remote')
    ? value('--swift-remote')
    : swiftRemotes(catalog).fetch;
  const plan = await planNativeRelease({catalog, sourceRevision, swiftRemote});
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {flag: 'wx'});
  const summary = [
    `Native release ${plan.version} (previous: ${plan.previousVersion ?? 'none'}).`,
    `Swift: https://github.com/${plan.swift.repository} tag ${plan.version}.`,
    `Maven: ${plan.maven.artifacts.map((artifact) => `${plan.maven.group}:${artifact}`).join(', ')}.`,
  ];
  if (plan.incompleteVersions.length > 0) {
    summary.push(`Incomplete native versions: ${plan.incompleteVersions.join(', ')}.`);
  }
  console.log(summary.join('\n'));
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `version=${plan.version}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Native release plan\n\n${summary.join('\n\n')}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
