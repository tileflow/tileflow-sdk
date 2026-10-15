import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  parseTileflowCaptureReceipt,
  type TileflowCapture,
  tileflowVisualArtifactLimits,
  type TileflowVisualReviewCapture,
} from '@tileflow/capture';
import {
  normalizeTileflowCaptureScene,
  serializeCanonicalJson,
  sha256Hex,
  tileflowCaptureSceneSchema,
} from '@tileflow/core';
import {assertNoSymlinkComponents, writeAtomicFileSet} from './capture-output';

export const captureRecordDirectory = '.tileflow/captures/records';
const maximumRecordBytes = 128 * 1024;

/** Immutable evidence is independent of the mutable scene output and the source config. */
export async function saveCaptureRecord(capture: TileflowCapture, cwd: string): Promise<string> {
  if (!capture.definition)
    throw new Error(
      'Capture has no normalized scene definition. Rebuild @tileflow/capture before using this CLI.',
    );
  const record = {
    schemaVersion: 1,
    definition: capture.definition,
    receipt: capture.receipt,
    warnings: capture.warnings,
  };
  const source = serializeCanonicalJson(record);
  if (Buffer.byteLength(source) > maximumRecordBytes)
    throw new Error('Capture record exceeds its byte limit.');
  const id = await sha256Hex(source);
  const directory = resolve(cwd, captureRecordDirectory);
  await writeAtomicFileSet({
    boundaryPath: cwd,
    force: false,
    managed: false,
    label: 'Capture record',
    files: [
      {path: resolve(directory, `${id}.json`), source},
      {path: resolve(directory, `${id}.png`), source: capture.png},
    ],
  });
  return id;
}

export async function readCaptureRecord(
  id: string,
  directory: string,
): Promise<TileflowVisualReviewCapture> {
  if (!/^[a-f0-9]{64}$/u.test(id))
    throw new Error('Capture ID must be the full 64-character ID returned by capture.');
  const root = resolve(directory);
  await assertNoSymlinkComponents(root, root);
  const source = await readBoundedFile(resolve(root, `${id}.json`), maximumRecordBytes);
  if ((await sha256Hex(source)) !== id)
    throw new Error('Saved capture record does not match its ID.');
  const record = JSON.parse(source.toString('utf8')) as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error('Unsupported capture record version.');
  const receipt = parseTileflowCaptureReceipt(JSON.stringify(record.receipt));
  const definition = normalizeTileflowCaptureScene(
    tileflowCaptureSceneSchema.parse(record.definition),
  );
  if (!definition.theme) throw new Error('Saved capture requires a concrete theme.');
  if ((await sha256Hex(serializeCanonicalJson(definition))) !== receipt.scene.sha256)
    throw new Error('Saved scene definition does not match its receipt.');
  const png = await readBoundedFile(
    resolve(root, `${id}.png`),
    tileflowVisualArtifactLimits.maximumPngBytes,
  );
  if ((await sha256Hex(png)) !== receipt.image.sha256)
    throw new Error('Saved capture PNG does not match its receipt.');
  if (
    !Array.isArray(record.warnings) ||
    record.warnings.some((warning) => typeof warning !== 'string')
  )
    throw new Error('Invalid capture warnings.');
  return {
    definition: {...definition, theme: definition.theme},
    capture: {
      scene: receipt.scene.name,
      map: receipt.scene.map,
      theme: receipt.scene.theme,
      target: receipt.scene.target,
      png,
      receipt,
      sha256: receipt.image.sha256,
      sceneSha256: receipt.scene.sha256,
      styleSha256: receipt.style.sha256,
      width: receipt.image.cssWidth,
      height: receipt.image.cssHeight,
      dpr: receipt.image.dpr,
      renderer: receipt.renderer,
      networkDependent: receipt.networkDependent,
      warnings: record.warnings as string[],
    },
  };
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumBytes)
      throw new Error('Saved capture artifact is not a bounded regular file.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error('Saved capture artifact changed while reading.');
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await file.close();
  }
}
