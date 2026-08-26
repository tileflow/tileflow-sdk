import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const publicReleaseBlockersFileName = 'PUBLIC_RELEASE_BLOCKERS.json';
export const publicReleaseBlockersKind = 'tileflow-public-release-blockers';
export const publicReleaseBlockersSchemaVersion = 1;

const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);
const blockerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class PublicReleaseBlockedError extends Error {
  constructor(document) {
    const ids = document.blockers.map(({id}) => id).join(', ');
    super(
      `Public SDK release is blocked by ${publicReleaseBlockersFileName}: ${ids}. Resolve every item and remove the file in a reviewed change.`,
    );
    this.name = 'PublicReleaseBlockedError';
    this.blockers = document.blockers;
  }
}

export async function readPublicReleaseBlockers(root = repositoryRoot) {
  const path = join(resolve(root), publicReleaseBlockersFileName);
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  let document;
  try {
    document = JSON.parse(source);
  } catch (error) {
    throw new TypeError(`${publicReleaseBlockersFileName} must contain valid JSON.`, {
      cause: error,
    });
  }
  return validatePublicReleaseBlockers(document);
}

export function validatePublicReleaseBlockers(document) {
  if (!isPlainRecord(document)) {
    throw new TypeError(`${publicReleaseBlockersFileName} must contain an object.`);
  }
  const allowedKeys = new Set(['blockers', 'kind', 'schemaVersion']);
  const unknownKey = Object.keys(document).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new TypeError(`${publicReleaseBlockersFileName} has unknown key ${unknownKey}.`);
  }
  if (document.kind !== publicReleaseBlockersKind) {
    throw new TypeError(`${publicReleaseBlockersFileName} has an unsupported kind.`);
  }
  if (document.schemaVersion !== publicReleaseBlockersSchemaVersion) {
    throw new TypeError(`${publicReleaseBlockersFileName} has an unsupported schema version.`);
  }
  if (!Array.isArray(document.blockers) || document.blockers.length < 1) {
    throw new TypeError(`${publicReleaseBlockersFileName} must contain at least one blocker.`);
  }
  if (document.blockers.length > 64) {
    throw new TypeError(`${publicReleaseBlockersFileName} contains too many blockers.`);
  }

  const ids = new Set();
  const blockers = document.blockers.map((blocker, index) => {
    if (!isPlainRecord(blocker)) {
      throw new TypeError(`${publicReleaseBlockersFileName} blocker ${index} must be an object.`);
    }
    const blockerKeys = Object.keys(blocker);
    if (
      blockerKeys.length !== 2 ||
      !Object.hasOwn(blocker, 'id') ||
      !Object.hasOwn(blocker, 'summary')
    ) {
      throw new TypeError(
        `${publicReleaseBlockersFileName} blocker ${index} must contain only id and summary.`,
      );
    }
    if (typeof blocker.id !== 'string' || !blockerIdPattern.test(blocker.id)) {
      throw new TypeError(`${publicReleaseBlockersFileName} blocker ${index} has an invalid id.`);
    }
    if (ids.has(blocker.id)) {
      throw new TypeError(`${publicReleaseBlockersFileName} has duplicate blocker ${blocker.id}.`);
    }
    ids.add(blocker.id);
    if (
      typeof blocker.summary !== 'string' ||
      blocker.summary.length < 1 ||
      blocker.summary.length > 1_000 ||
      blocker.summary !== blocker.summary.trim() ||
      /[\p{Cc}]/u.test(blocker.summary)
    ) {
      throw new TypeError(
        `${publicReleaseBlockersFileName} blocker ${blocker.id} has an invalid summary.`,
      );
    }
    return Object.freeze({id: blocker.id, summary: blocker.summary});
  });

  return Object.freeze({
    blockers: Object.freeze(blockers),
    kind: publicReleaseBlockersKind,
    schemaVersion: publicReleaseBlockersSchemaVersion,
  });
}

export async function assertPublicReleaseReady(root = repositoryRoot) {
  const document = await readPublicReleaseBlockers(root);
  if (document) throw new PublicReleaseBlockedError(document);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function main() {
  try {
    await assertPublicReleaseReady();
    console.log(
      `Public SDK release interlock is open: ${publicReleaseBlockersFileName} is absent.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(`::error title=Public SDK release blocked::${escapeWorkflowCommand(message)}`);
    }
    console.error(message);
    process.exitCode = 1;
  }
}

function escapeWorkflowCommand(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
