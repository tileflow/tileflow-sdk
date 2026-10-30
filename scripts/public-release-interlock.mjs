import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const publicReleaseBlockersFileName = 'PUBLIC_RELEASE_BLOCKERS.json';
// Native Swift/Kotlin releases have their own interlock with the same schema, so npm and native
// prerequisites never block each other.
export const nativeReleaseBlockersFileName = 'NATIVE_RELEASE_BLOCKERS.json';
const interlockFileNames = [publicReleaseBlockersFileName, nativeReleaseBlockersFileName];
export const publicReleaseBlockersKind = 'tileflow-public-release-blockers';
export const publicReleaseBlockersSchemaVersion = 1;

const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);
const blockerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class PublicReleaseBlockedError extends Error {
  constructor(document, fileName = publicReleaseBlockersFileName) {
    const ids = document.blockers.map(({id}) => id).join(', ');
    super(
      `Public SDK release is blocked by ${fileName}: ${ids}. Resolve every item and remove the file in a reviewed change.`,
    );
    this.name = 'PublicReleaseBlockedError';
    this.blockers = document.blockers;
  }
}

export async function readPublicReleaseBlockers(
  root = repositoryRoot,
  fileName = publicReleaseBlockersFileName,
) {
  if (!interlockFileNames.includes(fileName)) throw new TypeError(`Unknown interlock ${fileName}.`);
  const path = join(resolve(root), fileName);
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
    throw new TypeError(`${fileName} must contain valid JSON.`, {
      cause: error,
    });
  }
  return validatePublicReleaseBlockers(document, fileName);
}

export function validatePublicReleaseBlockers(document, fileName = publicReleaseBlockersFileName) {
  if (!isPlainRecord(document)) {
    throw new TypeError(`${fileName} must contain an object.`);
  }
  const allowedKeys = new Set(['blockers', 'kind', 'schemaVersion']);
  const unknownKey = Object.keys(document).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new TypeError(`${fileName} has unknown key ${unknownKey}.`);
  }
  if (document.kind !== publicReleaseBlockersKind) {
    throw new TypeError(`${fileName} has an unsupported kind.`);
  }
  if (document.schemaVersion !== publicReleaseBlockersSchemaVersion) {
    throw new TypeError(`${fileName} has an unsupported schema version.`);
  }
  if (!Array.isArray(document.blockers) || document.blockers.length < 1) {
    throw new TypeError(`${fileName} must contain at least one blocker.`);
  }
  if (document.blockers.length > 64) {
    throw new TypeError(`${fileName} contains too many blockers.`);
  }

  const ids = new Set();
  const blockers = document.blockers.map((blocker, index) => {
    if (!isPlainRecord(blocker)) {
      throw new TypeError(`${fileName} blocker ${index} must be an object.`);
    }
    const blockerKeys = Object.keys(blocker);
    if (
      blockerKeys.length !== 2 ||
      !Object.hasOwn(blocker, 'id') ||
      !Object.hasOwn(blocker, 'summary')
    ) {
      throw new TypeError(`${fileName} blocker ${index} must contain only id and summary.`);
    }
    if (typeof blocker.id !== 'string' || !blockerIdPattern.test(blocker.id)) {
      throw new TypeError(`${fileName} blocker ${index} has an invalid id.`);
    }
    if (ids.has(blocker.id)) {
      throw new TypeError(`${fileName} has duplicate blocker ${blocker.id}.`);
    }
    ids.add(blocker.id);
    if (
      typeof blocker.summary !== 'string' ||
      blocker.summary.length < 1 ||
      blocker.summary.length > 1_000 ||
      blocker.summary !== blocker.summary.trim() ||
      /[\p{Cc}]/u.test(blocker.summary)
    ) {
      throw new TypeError(`${fileName} blocker ${blocker.id} has an invalid summary.`);
    }
    return Object.freeze({id: blocker.id, summary: blocker.summary});
  });

  return Object.freeze({
    blockers: Object.freeze(blockers),
    kind: publicReleaseBlockersKind,
    schemaVersion: publicReleaseBlockersSchemaVersion,
  });
}

export async function assertPublicReleaseReady(
  root = repositoryRoot,
  fileName = publicReleaseBlockersFileName,
) {
  const document = await readPublicReleaseBlockers(root, fileName);
  if (document) throw new PublicReleaseBlockedError(document, fileName);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function main() {
  const fileName = process.argv[2] ?? publicReleaseBlockersFileName;
  try {
    if (process.argv.length > 3) throw new TypeError('Pass at most one interlock file name.');
    await assertPublicReleaseReady(repositoryRoot, fileName);
    console.log(`Public SDK release interlock is open: ${fileName} is absent.`);
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
