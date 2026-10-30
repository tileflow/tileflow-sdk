import {appendFile, writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repositoryUrl} from './native-central-portal.mjs';
import {
  mavenArtifactDirectory,
  planNativeVersion,
  readNativeReleaseCatalog,
  swiftRemotes,
} from './native-release-config.mjs';
import {swiftVersions} from './native-swift-release.mjs';

// Derives the next native version from what is already public: Maven Central metadata for every
// catalog artifact and the tags of the Swift distribution repository. No source file carries a
// release version, as with npm.

/** Versions listed by an artifact's Maven metadata; an artifact that was never published has none. */
export async function mavenVersions(
  catalog,
  {fetch: request = fetch, baseUrl = repositoryUrl} = {},
) {
  const versions = new Set();
  for (const {artifactId} of catalog.maven.publications) {
    const url = `${baseUrl}/${mavenArtifactDirectory(catalog, artifactId)}/maven-metadata.xml`;
    const response = await request(url, {headers: {'cache-control': 'no-cache'}});
    if (response.status === 404) continue;
    if (!response.ok)
      throw new Error(`${url} answered ${response.status}; the release cannot be planned.`);
    for (const [, version] of (await response.text()).matchAll(/<version>([^<]+)<\/version>/gu)) {
      versions.add(version.trim());
    }
  }
  return [...versions];
}

export async function planNativeRelease({catalog, sourceRevision, swiftRemote, request}) {
  const plan = planNativeVersion({
    initialVersion: catalog.initialVersion,
    swiftVersions: await swiftVersions(swiftRemote),
    mavenVersions: await mavenVersions(catalog, {fetch: request}),
  });
  return {
    schemaVersion: 1,
    sourceRevision,
    version: plan.to,
    previousVersion: plan.from,
    incompleteVersions: plan.incomplete,
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
    summary.push(`Published on only one side: ${plan.incompleteVersions.join(', ')}.`);
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
