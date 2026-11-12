import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const reportFileName = 'report.json';
export const commentMarker = '<!-- tileflow-visual-review -->';
export const statusContext = 'Tileflow visual review';

export const limits = Object.freeze({
  maximumChanges: 50,
  maximumImageBytes: 5 * 1024 * 1024,
  maximumImageSide: 8192,
  maximumReceiptBytes: 256 * 1024,
  maximumReportBytes: 1024 * 1024,
  maximumScenes: 30,
  maximumText: 500,
  maximumTotalBytes: 100 * 1024 * 1024,
});

const scenePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const shaPattern = /^[0-9a-f]{40}$/;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sceneStatuses = new Set([
  'changed',
  'missing-baseline',
  'runtime-mismatch',
  'scene-mismatch',
  'unchanged',
]);
const changeKinds = new Set(['add', 'change', 'remove']);

/**
 * Scenes that need a human decision. Renderer noise and unchanged scenes never do.
 */
export function needsApproval(scene) {
  return scene.status !== 'unchanged' && !scene.noise;
}

export function evidenceFile(scene, kind) {
  return `${scene}.${kind === 'receipt' ? 'receipt.json' : `${kind}.png`}`;
}

/**
 * Parses evidence produced by pull request code. Everything here is attacker-controlled on a fork,
 * so paths are derived from validated scene names and text keeps only what the report needs.
 */
export async function readUntrustedReport(directory) {
  const raw = await readBoundedFile(join(directory, reportFileName), limits.maximumReportBytes);
  let document;
  try {
    document = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('The evidence report is not valid JSON.');
  }
  assertObject(document, 'report');
  if (document.schemaVersion !== 1) throw new Error('Unsupported evidence report version.');
  const report = {
    schemaVersion: 1,
    pullRequest: positiveInteger(document.pullRequest, 'pullRequest'),
    headSha: sha(document.headSha, 'headSha'),
    baseSha: sha(document.baseSha, 'baseSha'),
    cliVersion: text(document.cliVersion),
    exitCode: integer(document.exitCode, 'exitCode'),
    failure: document.failure == null ? null : text(document.failure),
    scenes: list(document.scenes, 'scenes', limits.maximumScenes).map(parseScene),
    semantic: list(document.semantic, 'semantic', limits.maximumScenes).map(parseSemantic),
    warnings: list(document.warnings, 'warnings', 20).map(text),
  };
  if (new Set(report.scenes.map(({scene}) => scene)).size !== report.scenes.length) {
    throw new Error('The evidence report repeats a scene.');
  }
  return report;
}

/**
 * Loads every image the report promises, verifying each is a bounded regular PNG.
 */
export async function readUntrustedImages(directory, report) {
  const files = [];
  let total = 0;
  const add = async (scene, kind, reader) => {
    const name = evidenceFile(scene.scene, kind);
    const bytes = await reader(join(directory, 'scenes', name));
    total += bytes.length;
    if (total > limits.maximumTotalBytes) throw new Error('The evidence is too large.');
    files.push({name, bytes});
  };
  for (const scene of report.scenes) {
    if (scene.images.before) await add(scene, 'before', readPng);
    if (scene.images.after) await add(scene, 'after', readPng);
    if (scene.images.diff) await add(scene, 'diff', readPng);
    if (scene.images.receipt) {
      await add(scene, 'receipt', (path) => readReceipt(path, scene));
    }
  }
  return files;
}

async function readPng(path) {
  const bytes = await readBoundedFile(path, limits.maximumImageBytes);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error('An evidence image is not a PNG.');
  }
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') throw new Error('An evidence PNG is invalid.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > limits.maximumImageSide ||
    height > limits.maximumImageSide
  ) {
    throw new Error('An evidence PNG has unsupported dimensions.');
  }
  return bytes;
}

async function readReceipt(path, scene) {
  const bytes = await readBoundedFile(path, limits.maximumReceiptBytes);
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('An evidence receipt is not valid JSON.');
  }
  if (receipt?.scene?.name !== scene.scene || receipt?.image?.sha256 !== scene.afterSha256) {
    throw new Error('An evidence receipt does not describe its image.');
  }
  return bytes;
}

async function readBoundedFile(path, maximumBytes) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('Evidence must be regular files.');
  if (info.size > maximumBytes) throw new Error('An evidence file is too large.');
  return readFile(path);
}

function parseScene(value) {
  assertObject(value, 'scene');
  if (typeof value.scene !== 'string' || !scenePattern.test(value.scene)) {
    throw new Error('The evidence report has an unsupported scene name.');
  }
  if (!sceneStatuses.has(value.status)) throw new Error('Unknown scene status.');
  assertObject(value.images, 'images');
  return {
    scene: value.scene,
    map: text(value.map),
    status: value.status,
    noise: value.noise === true,
    exactPixels: metric(value.exactPixels),
    perceptualPixels: metric(value.perceptualPixels),
    totalPixels: metric(value.totalPixels),
    afterSha256: value.afterSha256 == null ? null : sha256(value.afterSha256),
    images: {
      before: value.images.before === true,
      after: value.images.after === true,
      diff: value.images.diff === true,
      receipt: value.images.receipt === true,
    },
  };
}

function parseSemantic(value) {
  assertObject(value, 'semantic diff');
  return {
    map: text(value.map),
    message: value.message == null ? null : text(value.message),
    total: metric(value.total) ?? 0,
    changes: list(value.changes ?? [], 'changes', limits.maximumChanges).map((change) => {
      assertObject(change, 'semantic change');
      if (!changeKinds.has(change.kind)) throw new Error('Unknown semantic change kind.');
      return {
        kind: change.kind,
        path: text(change.path),
        before: change.before === undefined ? null : text(JSON.stringify(change.before)),
        after: change.after === undefined ? null : text(JSON.stringify(change.after)),
      };
    }),
  };
}

function assertObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The evidence ${label} is invalid.`);
  }
}

function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`The evidence ${label} list is invalid.`);
  }
  return value;
}

function text(value) {
  return String(value ?? '').slice(0, limits.maximumText);
}

function metric(value) {
  if (value == null) return null;
  return integer(value, 'metric');
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}.`);
  return value;
}

function positiveInteger(value, label) {
  if (integer(value, label) < 1) throw new Error(`Invalid ${label}.`);
  return value;
}

function sha(value, label) {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function sha256(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Invalid image hash.');
  }
  return value;
}
