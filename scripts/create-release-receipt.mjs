import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const sha256Pattern = /^[0-9a-f]{64}$/u;

export async function createReleaseReceipt({bundleSha256, planPath, selectedListPath}) {
  assert.match(bundleSha256, sha256Pattern, 'Release bundle must have a SHA-256 digest.');
  const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'));
  assert.equal(plan?.schemaVersion, 4, 'Unsupported release plan schema.');
  assert.equal(plan.channel, 'alpha', 'Release receipt supports only the alpha channel.');
  assert.match(plan.sourceSha ?? '', /^[0-9a-f]{40}$/u, 'Release plan source SHA is invalid.');
  assert.ok(Array.isArray(plan.packages) && plan.packages.length > 0, 'Release plan is empty.');

  const selectedRoot = dirname(resolve(selectedListPath));
  const relativeTarballs = (await readFile(resolve(selectedListPath), 'utf8'))
    .split('\n')
    .filter(Boolean);
  assert.equal(
    relativeTarballs.length,
    plan.packages.length,
    'Selected tarball count does not match the release plan.',
  );

  const packages = [];
  for (const [index, relativeTarball] of relativeTarballs.entries()) {
    assert.equal(relativeTarball.startsWith('/'), false, 'Selected tarball path must be relative.');
    assert.equal(
      relativeTarball.split('/').includes('..'),
      false,
      'Selected tarball path must not traverse its root.',
    );
    const tarball = resolve(selectedRoot, relativeTarball);
    const [{stdout}, bytes, metadata] = await Promise.all([
      execFileAsync('tar', ['-xOf', tarball, 'package/package.json']),
      readFile(tarball),
      stat(tarball),
    ]);
    const manifest = JSON.parse(stdout);
    const release = plan.packages[index];
    assert.equal(manifest.name, release.name, 'Selected package order differs from release plan.');
    assert.equal(
      manifest.version,
      release.to,
      `${release.name} selected version differs from plan.`,
    );
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    packages.push({
      differences: release.differences,
      from: release.from,
      name: release.name,
      npmIntegrity: `sha512-${sha512}`,
      tarball: basename(tarball),
      tarballSha256: createHash('sha256').update(bytes).digest('hex'),
      tarballSize: metadata.size,
      to: release.to,
    });
  }

  return {
    schemaVersion: 1,
    kind: 'tileflow-npm-release-receipt',
    channel: 'alpha',
    sourceSha: plan.sourceSha,
    bundleSha256,
    packages,
    verification: {
      distTag: 'alpha',
      exactTarballBytes: true,
      registry: 'https://registry.npmjs.org',
    },
  };
}

async function main() {
  const [planPath, selectedListPath, bundleSha256, outputPath, ...rest] = process.argv.slice(2);
  assert.ok(
    planPath && selectedListPath && bundleSha256 && outputPath,
    'Expected plan, selected list, bundle digest, and output path.',
  );
  assert.equal(rest.length, 0, 'Unexpected release-receipt arguments.');
  const receipt = await createReleaseReceipt({bundleSha256, planPath, selectedListPath});
  await writeFile(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`);
  const summary = [
    '## Published npm alpha bundle',
    '',
    `Source: \`${receipt.sourceSha}\``,
    '',
    `Bundle SHA-256: \`${receipt.bundleSha256}\``,
    '',
    ...receipt.packages.map(
      ({name, tarballSha256, to}) => `- \`${name}@${to}\` — tarball SHA-256 \`${tarballSha256}\``,
    ),
    '',
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const {appendFile} = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  } else {
    process.stdout.write(summary);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
