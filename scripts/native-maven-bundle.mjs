import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32, deflateRawSync} from 'node:zlib';
import {
  mavenArtifactDirectory,
  parseAlphaVersion,
  readNativeReleaseCatalog,
} from './native-release-config.mjs';

// Maven Central bundle preparation for the native Android artifacts. Gradle writes an unsigned
// local repository; this script validates it, signs the exact files, adds checksums and writes the
// zip uploaded to the Central Publisher Portal. It uses Node built-ins and the gpg executable only,
// so the isolated publish job needs no workspace install.

const checksumAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];
const primarySuffixes = ['.aar', '.pom', '.module', '-sources.jar', '-javadoc.jar'];

export function primaryFileNames(artifactId, version) {
  return primarySuffixes.map((suffix) => `${artifactId}-${version}${suffix}`);
}

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest('hex');
}

/** A small XML reader for Gradle-generated POMs: elements, attributes and text, no DTDs. */
export function parseXml(source) {
  const root = {name: '#document', children: [], text: ''};
  const stack = [root];
  const token =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/gy;
  const decode = (text) =>
    text
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&');
  let match;
  let position = 0;
  while ((match = token.exec(source))) {
    position = token.lastIndex;
    const [whole, cdata, closing, name, attributes, selfClosing, text] = match;
    const current = stack.at(-1);
    if (whole.startsWith('<!--') || whole.startsWith('<?')) continue;
    if (cdata !== undefined) current.text += cdata;
    else if (text !== undefined) current.text += decode(text);
    else if (closing) {
      if (current.name !== name) throw new Error(`Unbalanced XML element </${name}>.`);
      stack.pop();
    } else {
      if (/<!DOCTYPE|<!ENTITY/u.test(attributes))
        throw new Error('XML declarations are not supported.');
      const element = {name, children: [], text: ''};
      current.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  if (position !== source.length) throw new Error('Malformed XML.');
  if (stack.length !== 1) throw new Error('Unclosed XML element.');
  return root;
}

const child = (element, name) => element?.children.find((item) => item.name === name);
const children = (element, name) => element?.children.filter((item) => item.name === name) ?? [];
const text = (element, ...path) => {
  let current = element;
  for (const name of path) current = child(current, name);
  return current?.text.trim() ?? '';
};

/** Central Portal POM requirements plus the coordinates this release must carry. */
export function validatePom(source, {catalog, artifactId, version}) {
  const problems = [];
  const document = parseXml(source);
  const project = child(document, 'project');
  if (!project) return [`${artifactId}: the POM has no <project>.`];
  const require = (condition, message) => condition || problems.push(`${artifactId}: ${message}`);
  require(text(project, 'modelVersion') === '4.0.0', 'modelVersion must be 4.0.0.');
  require(text(project, 'groupId') ===
    catalog.maven.group, `groupId must be ${catalog.maven.group}.`);
  require(text(project, 'artifactId') === artifactId, `artifactId must be ${artifactId}.`);
  require(text(project, 'version') === version, `version must be ${version}.`);
  require(text(project, 'packaging') === 'aar', 'packaging must be aar.');
  const publication = catalog.maven.publications.find((item) => item.artifactId === artifactId);
  require(text(project, 'name') === publication?.name, 'name must match the release catalog.');
  require(text(project, 'description') ===
    publication?.description, 'description must match the release catalog.');
  require(text(project, 'url') === catalog.project.url, 'url must be the project URL.');
  const licenses = children(child(project, 'licenses'), 'license');
  require(licenses.length > 0 &&
    licenses.every(
      (item) => text(item, 'name') && text(item, 'url'),
    ), 'licenses need a name and URL.');
  const developers = children(child(project, 'developers'), 'developer');
  require(developers.length > 0 &&
    developers.every((item) => text(item, 'name')), 'developers need a name.');
  for (const field of ['url', 'connection', 'developerConnection']) {
    require(text(project, 'scm', field), `scm ${field} is required.`);
  }
  require(!child(project, 'repositories'), 'repositories are not allowed.');
  require(!child(project, 'pluginRepositories'), 'pluginRepositories are not allowed.');
  const published = new Set(catalog.maven.publications.map((item) => item.artifactId));
  for (const dependency of children(child(project, 'dependencies'), 'dependency')) {
    const coordinate = `${text(dependency, 'groupId')}:${text(dependency, 'artifactId')}`;
    const dependencyVersion = text(dependency, 'version');
    if (text(dependency, 'groupId') === catalog.maven.group) {
      require(published.has(
        text(dependency, 'artifactId'),
      ), `${coordinate} is not a published artifact of this release.`);
      require(dependencyVersion === version, `${coordinate} must use ${version}.`);
    }
    require(!/SNAPSHOT|[[\]()+,]|^latest\./u.test(
      dependencyVersion,
    ), `${coordinate} has a non-exact version ${dependencyVersion}.`);
  }
  return problems;
}

/** Gradle module metadata must describe these exact files, sizes and digests. */
export function validateModuleMetadata(source, files, {catalog, artifactId, version}) {
  const problems = [];
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch {
    return [`${artifactId}: Gradle module metadata is not JSON.`];
  }
  const component = metadata.component ?? {};
  if (
    component.group !== catalog.maven.group ||
    component.module !== artifactId ||
    component.version !== version
  ) {
    problems.push(`${artifactId}: Gradle module metadata names another component.`);
  }
  for (const variant of metadata.variants ?? []) {
    if (variant['available-at']) {
      problems.push(`${artifactId}: variant ${variant.name} points to another module.`);
    }
    for (const file of variant.files ?? []) {
      const bytes = files.get(file.url);
      if (!bytes || file.name !== file.url) {
        problems.push(`${artifactId}: module metadata references missing ${file.url}.`);
      } else if (
        file.size !== bytes.length ||
        file.sha1 !== digest('sha1', bytes) ||
        file.sha256 !== digest('sha256', bytes) ||
        file.sha512 !== digest('sha512', bytes)
      ) {
        problems.push(`${artifactId}: module metadata digests differ for ${file.url}.`);
      }
    }
  }
  return problems;
}

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...(await listFiles(join(directory, item.name), path)));
    else if (item.isFile()) result.push(path);
    else throw new Error(`Unexpected non-file in Maven repository: ${path}`);
  }
  return result.sort();
}

/**
 * Validates a Maven repository for one release. Unsigned mode checks a Gradle candidate; signed
 * mode checks a Central bundle directory, where every file also needs signatures and checksums.
 */
export async function validateMavenRepository(directory, options) {
  const {catalog, version, signed = false, verifySignature} = options;
  if (!parseAlphaVersion(version) && !signed && !/^0\.0\.0-/u.test(version)) {
    throw new Error(`Unexpected candidate version ${version}.`);
  }
  const problems = [];
  const all = await listFiles(directory);
  const expected = new Set();
  for (const publication of catalog.maven.publications) {
    const base = `${mavenArtifactDirectory(catalog, publication.artifactId)}/${version}`;
    const files = new Map();
    for (const name of primaryFileNames(publication.artifactId, version)) {
      const path = `${base}/${name}`;
      if (!all.includes(path)) {
        problems.push(`${publication.artifactId}: ${name} is missing.`);
        continue;
      }
      expected.add(path);
      const bytes = await readFile(join(directory, path));
      if (bytes.length === 0) problems.push(`${publication.artifactId}: ${name} is empty.`);
      files.set(name, bytes);
      const companions = signed ? ['asc', ...checksumAlgorithms] : [];
      for (const extension of companions) {
        const companion = `${path}.${extension}`;
        expected.add(companion);
        if (!all.includes(companion)) {
          problems.push(`${publication.artifactId}: ${name}.${extension} is missing.`);
        } else if (extension !== 'asc') {
          const value = (await readFile(join(directory, companion), 'utf8')).trim();
          if (value !== digest(extension, bytes)) {
            problems.push(`${publication.artifactId}: ${name}.${extension} is wrong.`);
          }
        } else if (verifySignature) {
          const signer = await verifySignature(join(directory, path), join(directory, companion));
          if (!signer.ok) problems.push(`${publication.artifactId}: ${name}.asc ${signer.problem}`);
        }
      }
    }
    const pom = files.get(`${publication.artifactId}-${version}.pom`);
    if (pom) {
      problems.push(
        ...validatePom(pom.toString('utf8'), {
          catalog,
          artifactId: publication.artifactId,
          version,
        }),
      );
    }
    const module = files.get(`${publication.artifactId}-${version}.module`);
    if (module) {
      problems.push(
        ...validateModuleMetadata(module.toString('utf8'), files, {
          catalog,
          artifactId: publication.artifactId,
          version,
        }),
      );
    }
    for (const name of ['-sources.jar', '-javadoc.jar', '.aar']) {
      const bytes = files.get(`${publication.artifactId}-${version}${name}`);
      if (bytes && bytes.readUInt32LE(0) !== 0x04034b50) {
        problems.push(
          `${publication.artifactId}: ${publication.artifactId}-${version}${name} is not a zip.`,
        );
      }
    }
  }
  // Gradle's own checksums and metadata may accompany an unsigned candidate; nothing else may.
  for (const path of all) {
    if (expected.has(path)) continue;
    const gradleCompanion =
      !signed &&
      (checksumAlgorithms.some((algorithm) => path.endsWith(`.${algorithm}`)) ||
        /\/maven-metadata\.xml(?:\.\w+)?$/u.test(path));
    if (!gradleCompanion) problems.push(`Unexpected file in Maven repository: ${path}`);
  }
  if (problems.length > 0) {
    throw new Error(`Maven repository ${directory} is not releasable:\n- ${problems.join('\n- ')}`);
  }
  return [...expected].sort();
}

async function gpg(gnupgHome, args, input) {
  return await new Promise((resolvePromise, reject) => {
    const child = execFile(
      'gpg',
      ['--homedir', gnupgHome, '--batch', '--no-tty', ...args],
      {maxBuffer: 16 * 1024 * 1024},
      (error, stdout, stderr) => {
        if (error) reject(new Error(`gpg ${args[0]} failed: ${stderr.trim() || error.message}`));
        else resolvePromise(stdout);
      },
    );
    child.stdin.end(input ?? '');
  });
}

/** Reads the one secret key in a keyring and the facts Central relies on. */
export async function describeSigningKey(gnupgHome, now = Date.now()) {
  const listing = await gpg(gnupgHome, [
    '--with-colons',
    '--fixed-list-mode',
    '--list-secret-keys',
  ]);
  const lines = listing.split('\n').map((line) => line.split(':'));
  const primaries = lines.filter((fields) => fields[0] === 'sec');
  if (primaries.length !== 1) {
    throw new Error(
      `The signing keyring must hold exactly one secret key; found ${primaries.length}.`,
    );
  }
  const index = lines.indexOf(primaries[0]);
  const fingerprint = lines.slice(index + 1).find((fields) => fields[0] === 'fpr')?.[9];
  const [, validity, , , , , expires, , , , , capabilities] = primaries[0];
  const expiresAt = expires ? Number(expires) * 1000 : null;
  if (!fingerprint || !/^[0-9A-F]{40}$/u.test(fingerprint)) {
    throw new Error('The signing key has no v4 fingerprint.');
  }
  if (['r', 'e', 'd', 'i'].includes(validity) || (expiresAt !== null && expiresAt <= now)) {
    throw new Error(`Signing key ${fingerprint} is revoked, expired or disabled.`);
  }
  if (!capabilities.includes('s')) {
    throw new Error(
      `Signing key ${fingerprint} cannot sign with its primary key; Maven Central verifies primary-key signatures.`,
    );
  }
  return {fingerprint, expiresAt};
}

export async function importSigningKey({armoredKey, expectedFingerprint, gnupgHome}) {
  await gpg(gnupgHome, ['--import'], armoredKey);
  const key = await describeSigningKey(gnupgHome);
  const expected = expectedFingerprint?.replaceAll(/\s/gu, '').toUpperCase();
  if (!expected || key.fingerprint !== expected) {
    throw new Error(
      `The signing key ${key.fingerprint} does not match the expected fingerprint ${expected || '(unset)'}.`,
    );
  }
  return key;
}

export function gpgSigner({gnupgHome, fingerprint, passphrase}) {
  return async (path) => {
    await gpg(
      gnupgHome,
      [
        '--yes',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '0',
        // The trailing "!" pins the primary key; Central does not accept subkey signatures.
        '--local-user',
        `${fingerprint}!`,
        '--armor',
        '--detach-sign',
        '--output',
        `${path}.asc`,
        path,
      ],
      `${passphrase ?? ''}\n`,
    );
  };
}

export function gpgSignatureVerifier({gnupgHome, fingerprint}) {
  return async (path, signature) => {
    let status;
    try {
      status = await gpg(gnupgHome, ['--status-fd', '1', '--verify', signature, path]);
    } catch (error) {
      return {ok: false, problem: `does not verify: ${error.message}`};
    }
    const valid = status.split('\n').find((line) => line.startsWith('[GNUPG:] VALIDSIG '));
    const fields = valid?.split(' ') ?? [];
    if (fields[2] !== fingerprint || fields.at(-1) !== fingerprint) {
      return {ok: false, problem: `is not a primary-key signature by ${fingerprint}.`};
    }
    return {ok: true};
  };
}

/** A deterministic zip: sorted entries, fixed 1980-01-01 timestamps, deflate, no extra fields. */
export async function writeZip(output, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const {name, bytes} of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const fileName = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(bytes, {level: 9});
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x0021, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    header.writeUInt16LE(0, 28);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x0021, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(fileName.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, fileName);
    chunks.push(header, fileName, compressed);
    offset += header.length + fileName.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  if (entries.length > 0xffff || offset > 0xffffffff) throw new Error('The bundle needs zip64.');
  await writeFile(output, Buffer.concat([...chunks, directory, end]), {flag: 'wx'});
}

/**
 * Copies the validated primary files into a new directory, signs each one, writes its checksums,
 * validates the signed layout and zips it for the Central Publisher Portal.
 */
export async function createCentralBundle({
  repository,
  catalog,
  version,
  staging,
  output,
  sign,
  verifySignature,
}) {
  const primaries = (await validateMavenRepository(repository, {catalog, version})).filter(
    (path) => !path.endsWith('.asc') && !checksumAlgorithms.some((a) => path.endsWith(`.${a}`)),
  );
  await mkdir(staging);
  for (const path of primaries) {
    const destination = join(staging, path);
    await mkdir(dirname(destination), {recursive: true});
    await copyFile(join(repository, path), destination);
    const bytes = await readFile(destination);
    await sign(destination);
    for (const algorithm of checksumAlgorithms) {
      await writeFile(`${destination}.${algorithm}`, digest(algorithm, bytes));
    }
  }
  const files = await validateMavenRepository(staging, {
    catalog,
    version,
    signed: true,
    verifySignature,
  });
  const entries = [];
  for (const path of files) entries.push({name: path, bytes: await readFile(join(staging, path))});
  await writeZip(output, entries);
  return {
    files: files.length,
    sha256: digest('sha256', await readFile(output)),
  };
}

function parseOptions(args, allowed, flags = []) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (flags.includes(key) && !options.has(key)) {
      options.set(key, true);
      continue;
    }
    if (!allowed.includes(key) || options.has(key) || args[index + 1] === undefined) {
      throw new Error(`Unexpected argument ${key}.`);
    }
    options.set(key, args[index + 1]);
    index += 1;
  }
  return options;
}

function absolute(options, key) {
  const value = options.get(key);
  if (!value || !isAbsolute(value)) throw new Error(`${key} must be an absolute path.`);
  return resolve(value);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const catalog = await readNativeReleaseCatalog();
  if (command === 'validate') {
    const options = parseOptions(args, ['--repository', '--version']);
    const files = await validateMavenRepository(absolute(options, '--repository'), {
      catalog,
      version: options.get('--version'),
    });
    console.log(`Maven candidate is releasable: ${files.length} artifact files.`);
  } else if (command === 'import-key') {
    // The key arrives through the environment so it never appears in a command line or log.
    const options = parseOptions(args, ['--gnupghome']);
    const gnupgHome = absolute(options, '--gnupghome');
    await mkdir(gnupgHome, {mode: 0o700});
    const key = await importSigningKey({
      armoredKey: process.env.NATIVE_SIGNING_KEY ?? '',
      expectedFingerprint: process.env.NATIVE_SIGNING_KEY_FINGERPRINT,
      gnupgHome,
    });
    const days = key.expiresAt ? Math.floor((key.expiresAt - Date.now()) / 86_400_000) : null;
    console.log(
      `Signing key ${key.fingerprint}${days === null ? '' : `, expires in ${days} days`}.`,
    );
    if (days !== null && days < 60) {
      console.log(
        `::warning title=Signing key expires soon::Extend ${key.fingerprint} and republish it.`,
      );
    }
  } else if (command === 'bundle') {
    const options = parseOptions(args, ['--repository', '--version', '--gnupghome', '--output']);
    const gnupgHome = absolute(options, '--gnupghome');
    const output = absolute(options, '--output');
    const {fingerprint} = await describeSigningKey(gnupgHome);
    const staging = await mkdtemp(join(tmpdir(), 'tileflow-central-'));
    await rm(staging, {recursive: true});
    const result = await createCentralBundle({
      repository: absolute(options, '--repository'),
      catalog,
      version: options.get('--version'),
      staging,
      output,
      sign: gpgSigner({
        gnupgHome,
        fingerprint,
        passphrase: process.env.NATIVE_SIGNING_KEY_PASSPHRASE,
      }),
      verifySignature: gpgSignatureVerifier({gnupgHome, fingerprint}),
    });
    await rm(staging, {recursive: true, force: true});
    console.log(
      `Central bundle ${output}: ${result.files} files, SHA-256 ${result.sha256}, signed by ${fingerprint}.`,
    );
  } else if (command === 'keyserver') {
    const options = parseOptions(args, ['--fingerprint']);
    const fingerprint = options.get('--fingerprint')?.toUpperCase() ?? '';
    if (!/^[0-9A-F]{40}$/u.test(fingerprint))
      throw new Error('--fingerprint must be 40 hex digits.');
    const response = await fetch(
      `https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x${fingerprint}`,
    );
    const body = await response.text();
    if (!response.ok || !body.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
      throw new Error(
        `The public key ${fingerprint} is not on keyserver.ubuntu.com, so Maven Central cannot verify the signatures. Publish the signing public key before releasing.`,
      );
    }
    console.log(`Public key ${fingerprint} is available from keyserver.ubuntu.com.`);
  } else {
    throw new Error(
      'Usage: native-maven-bundle.mjs validate|import-key|bundle|keyserver [options]',
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
