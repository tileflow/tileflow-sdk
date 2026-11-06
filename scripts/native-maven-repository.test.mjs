import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {publishMavenRepository, readAnonymousMavenFile} from './native-maven-repository.mjs';

const catalog = {
  maven: {
    group: 'dev.tileflow',
    publications: [{artifactId: 'tileflow'}, {artifactId: 'tileflow-foundation'}],
  },
};
const version = '0.1.0-alpha.10';
const listing = 'dev/tileflow/tileflow/maven-metadata.xml';
const claim = `_tileflow/native-releases/dev.tileflow/${version}.sha256`;
const reservationIndex = '_tileflow/native-releases/reservations.json';

function release(tag = version, payload = tag) {
  return new Map(
    catalog.maven.publications.flatMap(({artifactId}) =>
      ['aar', 'pom', 'module'].map((extension) => [
        `dev/tileflow/${artifactId}/${tag}/${artifactId}-${tag}.${extension}`,
        Buffer.from(`${payload} ${artifactId} ${extension}`),
      ]),
    ),
  );
}

function fixture() {
  const objects = new Map();
  const writes = [];
  const anonymous = new Set();
  const hooks = {};

  function seed(key, bytes) {
    const etag = `"${createHash('md5').update(bytes).digest('hex')}"`;
    objects.set(key, {bytes, etag});
  }

  const store = {
    async get(key) {
      return objects.get(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
    async put(key, bytes, condition) {
      await hooks.beforePut?.(key, bytes, condition);
      const existing = objects.get(key);
      const {ifMatch, ifNoneMatch} = condition;
      assert.ok(ifMatch || ifNoneMatch === '*', `Missing condition for ${key}`);
      if (ifMatch ? existing?.etag !== ifMatch : existing) return false;

      seed(key, bytes);
      writes.push(key);
      return true;
    },
  };

  function publish(options = {}) {
    return publishMavenRepository({
      catalog,
      version,
      files: release(),
      store,
      async readPublic(key) {
        anonymous.add(key);
        return hooks.readPublic ? hooks.readPublic(key) : objects.get(key)?.bytes;
      },
      wait: async () => {},
      ...options,
    });
  }

  return {objects, writes, anonymous, hooks, seed, publish};
}

test('lists a release only after all approved files were downloaded anonymously', async () => {
  const {objects, writes, anonymous, hooks, publish} = fixture();
  const files = release();
  hooks.beforePut = (key) => {
    if (key.endsWith('maven-metadata.xml')) {
      for (const file of files.keys()) assert.ok(anonymous.has(file), file);
    }
  };

  await publish({files});
  assert.match(objects.get(listing).bytes.toString(), /<release>0\.1\.0-alpha\.10<\/release>/u);
  for (const [key, bytes] of files) assert.deepEqual(objects.get(key).bytes, bytes);

  const firstWrites = writes.length;
  await publish({files});
  assert.equal(writes.length, firstWrites);
});

test('rejects a version collision or unexpected object before writing anything', async (t) => {
  await t.test('different bytes at an existing version path', async () => {
    const {seed, publish, writes} = fixture();
    const lastKey = [...release().keys()].at(-1);
    seed(lastKey, Buffer.from('existing and different'));

    await assert.rejects(publish(), /conflicts with existing bytes/u);
    assert.deepEqual(writes, []);
  });

  await t.test('an unapproved file under the same version', async () => {
    const {seed, publish, writes} = fixture();
    seed(`dev/tileflow/tileflow/${version}/extra.jar`, Buffer.from('unapproved'));

    await assert.rejects(publish(), /Unexpected existing Maven release object/u);
    assert.deepEqual(writes, []);
  });

  await t.test('malformed version listing', async () => {
    const {seed, publish, writes} = fixture();
    seed(listing, Buffer.from('<metadata>unrecognized</metadata>'));

    await assert.rejects(publish(), /Cannot update.*maven-metadata\.xml/u);
    assert.deepEqual(writes, []);
  });

  await t.test('reservation index for another group', async () => {
    const {seed, publish, writes} = fixture();
    seed(reservationIndex, Buffer.from('{"schemaVersion":1,"group":"other.group","versions":[]}'));

    await assert.rejects(publish(), /Invalid Maven reservation index/u);
    assert.deepEqual(writes, []);
  });
});

test('reserves the version publicly before any immutable writes and resumes after interruption', async () => {
  const {objects, writes, anonymous, hooks, publish} = fixture();
  hooks.beforePut = (key) => {
    if (key !== claim) return;
    assert.ok(anonymous.has(reservationIndex));
    throw new Error('interrupted before claim');
  };

  await assert.rejects(publish(), /interrupted before claim/u);
  assert.deepEqual(writes, [reservationIndex]);
  assert.deepEqual(JSON.parse(objects.get(reservationIndex).bytes).versions, [version]);
  assert.ok(!objects.has(listing));

  hooks.beforePut = null;
  await publish();
  assert.ok(objects.has(listing));
  assert.equal(writes.filter((key) => key === reservationIndex).length, 1);
});

test('writes no claim or release objects when the reservation cannot be verified anonymously', async () => {
  const {objects, writes, hooks, publish} = fixture();
  hooks.readPublic = (key) => (key === reservationIndex ? null : objects.get(key)?.bytes);

  await assert.rejects(publish(), /Could not update and verify.*reservations\.json/u);
  assert.deepEqual(writes, [reservationIndex]);
});

test('resumes interrupted uploads with the same signed bytes', async () => {
  const {objects, writes, hooks, publish} = fixture();
  const files = release();
  const interrupted = [...files.keys()].at(-1);
  hooks.beforePut = (key) => {
    if (key === interrupted) throw new Error('connection lost');
  };

  await assert.rejects(publish(), /connection lost/u);
  assert.ok(objects.has(claim));
  assert.ok(objects.has(files.keys().next().value));
  assert.ok(!objects.has(listing));

  const firstWrites = writes.length;
  hooks.beforePut = null;
  await publish();
  assert.deepEqual(
    writes.slice(firstWrites).filter((key) => files.has(key)),
    [interrupted],
  );
  assert.ok(objects.has(listing));
});

test('does not announce a release served with incorrect anonymous bytes', async () => {
  const {objects, hooks, publish} = fixture();
  const files = release();
  const artifact = files.keys().next().value;
  hooks.readPublic = (key) =>
    key === artifact ? Buffer.from('different bytes served by the CDN') : objects.get(key)?.bytes;

  await assert.rejects(publish(), /Anonymous Maven download did not match approved bytes/u);
  assert.ok(!objects.has(listing));
});

test('concurrent attempts cannot combine different signed versions', async () => {
  const {objects, hooks, publish} = fixture();
  const first = release(version, 'first approved candidate');
  const second = release(version, 'second approved candidate');
  const simultaneous = Promise.withResolvers();
  let contenders = 0;
  hooks.beforePut = async (key) => {
    if (key !== claim) return;
    contenders += 1;
    if (contenders === 2) simultaneous.resolve();
    await simultaneous.promise;
  };

  const results = await Promise.allSettled([publish({files: first}), publish({files: second})]);
  assert.deepEqual(results.map(({status}) => status).sort(), ['fulfilled', 'rejected']);
  assert.match(
    results.find(({status}) => status === 'rejected').reason.message,
    /conflicts with existing bytes/u,
  );

  const winner = results[0].status === 'fulfilled' ? first : second;
  for (const [key, bytes] of winner) assert.deepEqual(objects.get(key).bytes, bytes);
});

test('metadata CAS preserves all versions when a concurrent publication wins a write', async () => {
  const {objects, hooks, publish} = fixture();
  const older = '0.1.0-alpha.9';
  const other = '0.1.0-alpha.11';
  await publish({version: older, files: release(older)});

  let raced = false;
  hooks.beforePut = async (key, _, {ifMatch}) => {
    if (key !== listing || raced) return;
    assert.equal(ifMatch, objects.get(listing).etag);
    raced = true;
    await publish({version: other, files: release(other)});
  };

  await publish();
  assert.ok(raced);
  const metadata = objects.get(listing).bytes.toString();
  assert.deepEqual(
    [...metadata.matchAll(/<version>([^<]+)<\/version>/gu)].map((match) => match[1]),
    [older, version, other],
  );
  assert.ok(metadata.includes(`<latest>${other}</latest>`));
});

test('reservation CAS preserves versions reserved by concurrent publications', async () => {
  const {objects, hooks, publish} = fixture();
  const older = '0.1.0-alpha.9';
  const other = '0.1.0-alpha.11';
  await publish({version: older, files: release(older)});

  let raced = false;
  hooks.beforePut = async (key) => {
    if (key !== reservationIndex || raced) return;
    raced = true;
    await publish({version: other, files: release(other)});
  };

  await publish();
  assert.ok(raced);
  assert.deepEqual(JSON.parse(objects.get(reservationIndex).bytes).versions, [
    older,
    version,
    other,
  ]);
});

test('anonymous downloads retry throttling, server errors, and timeouts', async () => {
  const responses = [new Response(null, {status: 429}), new Response(null, {status: 503})];
  let attempts = 0;
  const actual = await readAnonymousMavenFile('https://example.com', listing, {
    request: async () => {
      attempts += 1;
      if (attempts <= responses.length) return responses[attempts - 1];
      if (attempts === 3) throw new DOMException('Timed out', 'TimeoutError');
      return new Response('approved bytes');
    },
    wait: async () => {},
  });

  assert.equal(actual.toString(), 'approved bytes');
  assert.equal(attempts, 4);
});

test('anonymous downloads stop after bounded retries and fail immediately on 403', async () => {
  for (const [status, expectedAttempts] of [
    [503, 4],
    [403, 1],
  ]) {
    let attempts = 0;
    await assert.rejects(
      readAnonymousMavenFile('https://example.com', listing, {
        request: async () => {
          attempts += 1;
          return new Response(null, {status});
        },
        wait: async () => {},
      }),
      new RegExp(`HTTP ${status}`, 'u'),
    );

    assert.equal(attempts, expectedAttempts);
  }
});

function invokePublisher(bucket, ...options) {
  const script = fileURLToPath(new URL('native-maven-repository.mjs', import.meta.url));
  const local = fileURLToPath(new URL('.', import.meta.url));
  execFileSync(
    process.execPath,
    [script, '--repository', local, '--gnupghome', local, ...options],
    {
      env: {
        R2_ACCOUNT_ID: '0'.repeat(32),
        R2_MAVEN_BUCKET: bucket,
        R2_MAVEN_ACCESS_KEY_ID: 'test',
        R2_MAVEN_SECRET_ACCESS_KEY: 'test',
        NATIVE_SIGNING_KEY_FINGERPRINT: '0'.repeat(40),
      },
      stdio: 'pipe',
    },
  );
}

test('CLI rejects a production target outside the main release workflow', () => {
  assert.throws(
    () => invokePublisher('tileflow-maven', '--version', version),
    /Production Maven publication requires the native publish workflow on main/u,
  );
});

test('CLI rehearsal cannot target the production bucket or URL', () => {
  for (const [bucket, url] of [
    ['tileflow-maven', 'https://pub-test.r2.dev'],
    ['tileflow-maven-rehearsal', 'https://maven.tileflow.dev'],
  ]) {
    assert.throws(
      () =>
        invokePublisher(
          bucket,
          '--version',
          '0.0.0-rehearsal.1',
          '--rehearsal',
          '--public-url',
          url,
        ),
      /Rehearsal requires a rehearsal bucket, public r2\.dev URL and rehearsal version/u,
    );
  }
});
