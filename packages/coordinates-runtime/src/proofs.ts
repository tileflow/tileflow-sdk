import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {
  coordinatesAnalyticProofSchema,
  type CoordinatesProvenance,
} from '@tileflow/coordinates/contract';

const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.literal(1),
    method: z.object({authority: z.literal('EPSG'), code: z.literal('9602')}).strict(),
    algorithm: z.literal('epsg-9602-static-v1'),
    tolerances: z
      .object({angularDegrees: z.literal(1e-9), linearMetres: z.literal(0.002)})
      .strict(),
    domain: z
      .object({
        ellipsoid: z.literal('oblate-or-sphere'),
        latitude: z.literal('open-poles'),
        longitude: z.literal('defined'),
        normalBranch: z.literal('positive-polar-radius'),
      })
      .strict(),
    requirements: z.tuple([
      z.literal('direct-epsg-9602-conversion'),
      z.literal('static-geographic-3d-and-geocentric-3d'),
      z.literal('equivalent-datum-or-ensemble-ellipsoid-and-prime-meridian'),
      z.literal('declared-axis-units-and-reversible-normalization'),
      z.literal('no-ballpark-no-grids-no-time'),
      z.literal('independent-cartesian-equation-residual'),
      z.literal('forward-and-inverse-residuals'),
      z.literal('source-and-target-crs-areas'),
    ]),
    equations: z
      .object({
        e2: z.string(),
        N: z.string(),
        X: z.string(),
        Y: z.string(),
        Z: z.string(),
        branch: z.string(),
      })
      .strict(),
    controls: z
      .array(
        z
          .object({
            from: z.literal('EPSG:4979'),
            to: z.literal('EPSG:4978'),
            position: z.tuple([z.literal(12), z.literal(55), z.literal(10)]),
            expected: z.tuple([
              z.literal(3586475.2672),
              z.literal(762328.8513),
              z.literal(5201391.7147),
            ]),
            linearToleranceMetres: z.literal(0.001),
            inverseRequired: z.literal(true),
          })
          .strict(),
      )
      .length(1),
    sources: z.array(z.string().url()).min(1).max(8),
  })
  .strict();

/** Only the supported proof document can enable its native method. */
export function describeAnalyticProof(bytes: Uint8Array) {
  if (bytes.byteLength > 65536) throw new Error('PROOF_DOCUMENT_INVALID');
  const document = documentSchema.parse(
    JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)),
  );
  const digest = createHash('sha256').update(bytes).digest('hex');
  return coordinatesAnalyticProofSchema.parse({
    id: `ap_${digest}`,
    digest,
    version: document.version,
    method: document.method,
    algorithm: document.algorithm,
    tolerances: document.tolerances,
  });
}

export async function verifiedAnalyticProofPath(root: string, provenance: CoordinatesProvenance) {
  const proofs = provenance.applicabilityProofs ?? [];
  if (proofs.length === 0) return undefined;
  if (proofs.length !== 1) throw new Error('PROOF_DOCUMENT_INVALID');
  const proof = coordinatesAnalyticProofSchema.parse(proofs[0]);
  const path = join(root, 'proofs', `${proof.id}.json`);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw new Error('PROOF_DOCUMENT_INVALID');
  const actual = describeAnalyticProof(await readFile(path));
  if (JSON.stringify(actual) !== JSON.stringify(proof)) throw new Error('PROOF_DOCUMENT_INVALID');
  return path;
}
