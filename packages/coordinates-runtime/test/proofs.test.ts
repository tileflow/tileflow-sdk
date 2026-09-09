import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {digest} from '../src/identity';
import {describeAnalyticProof, verifiedAnalyticProofPath} from '../src/proofs';
import {coordinatesExecutionReleaseSchema} from '../src/release';
import {createSetupFixture} from './setup-fixture';

const document = await readFile(new URL('../proofs/epsg-9602-static-v1.json', import.meta.url));
const proof = describeAnalyticProof(document);

test('only a supported, versioned EPSG9602 document produces a proof descriptor', () => {
  assert.equal(proof.id, `ap_${proof.digest}`);
  for (const mutate of [
    (value: any) => {
      value.method.code = '9603';
    },
    (value: any) => {
      value.version = 2;
    },
    (value: any) => {
      value.tolerances.linearMetres = 1;
    },
    (value: any) => {
      value.domain.normalBranch = 'unrestricted';
    },
    (value: any) => {
      value.requirements.pop();
    },
  ]) {
    const value = JSON.parse(document.toString());
    mutate(value);
    assert.throws(() => describeAnalyticProof(Buffer.from(JSON.stringify(value))));
  }
});

test('proof bytes and every artifact inventory bind to the execution release', async () => {
  const fixture = await createSetupFixture();
  const root = await mkdtemp(join(tmpdir(), 'tileflow-analytic-proof-'));
  try {
    const release = structuredClone(fixture.release);
    const execution = {
      ...release.execution,
      numericConvention: 'explicit-axis-models-v2' as const,
      applicabilityProofs: [proof],
    };
    const candidate = {...release, execution};
    const reseal = () => {
      const {releaseId: _id, ...identity} = candidate;
      candidate.releaseId = `cr_${digest(identity)}`;
    };
    reseal();
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(candidate).success, false);
    candidate.artifacts[0].files.push({
      path: `proofs/${proof.id}.json`,
      bytes: document.length,
      sha256: proof.digest,
      executable: false,
      assetId: candidate.artifacts[0].assets[0].id,
    });
    reseal();
    const parsed = coordinatesExecutionReleaseSchema.parse(candidate);
    const provenance = {...parsed.execution, artifact: {id: 'fixture', digest: 'a'.repeat(64)}};
    await assert.rejects(verifiedAnalyticProofPath(root, provenance));
    await mkdir(join(root, 'proofs'));
    const path = join(root, 'proofs', `${proof.id}.json`);
    await writeFile(path, document);
    assert.equal(await verifiedAnalyticProofPath(root, provenance), path);
    await writeFile(path, Buffer.concat([document, Buffer.from(' ')]));
    await assert.rejects(verifiedAnalyticProofPath(root, provenance), /PROOF_DOCUMENT_INVALID/);
    assert.equal(
      await verifiedAnalyticProofPath(root, {...provenance, applicabilityProofs: []}),
      undefined,
    );
    candidate.artifacts[0].files.at(-1)!.sha256 = 'f'.repeat(64);
    reseal();
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(candidate).success, false);
    candidate.execution.applicabilityProofs = [];
    reseal();
    assert.equal(coordinatesExecutionReleaseSchema.safeParse(candidate).success, false);
  } finally {
    await fixture.close();
    await rm(root, {recursive: true, force: true});
  }
});
