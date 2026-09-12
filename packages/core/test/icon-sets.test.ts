import assert from 'node:assert/strict';
import test from 'node:test';
import {defineMap, parseTileflowMap} from '../src';
import {
  collectTileflowIconSetReferences,
  iconSet,
  tileflowIconSetSourceSchema,
  type TileflowIconSource,
} from '../src/icon-set';
import {parseTileflowIconJson} from '../src/icon-json';
import {
  parseTileflowIconsLockfile,
  serializeTileflowIconsLockfile,
  type TileflowIconsLockfileV1,
} from '../src/icon-lock';
import {
  hashTileflowIconComposition,
  parseTileflowIconComposition,
  type TileflowIconCompositionV1,
} from '../src/icon-composition';
import {
  hashTileflowIconPackageManifest,
  tileflowIconPackageManifestSchema,
} from '../src/icon-package';
import {hashTileflowMapRevision, type TileflowEffectiveMapSourceAssets} from '../src/build';
import {extendStreets} from './map-fixture';

async function fixtureLock(): Promise<TileflowIconsLockfileV1> {
  const manifest = tileflowIconPackageManifestSchema.parse({
    format: 'tileflow-icon-package-v1',
    files: ['sprite.json', 'sprite.png', 'sprite@2x.json', 'sprite@2x.png'].map((name) => ({
      name,
      contentType: name.endsWith('.json') ? 'application/json' : 'image/png',
      byteLength: 1,
      sha256: 'a'.repeat(64),
    })),
    iconNames: ['marker'],
    renderedIcons: [{name: 'marker', pixelSha256: {oneX: 'b'.repeat(64), twoX: 'c'.repeat(64)}}],
    sprites: {
      oneX: {width: 2, height: 1, pixelRatio: 1},
      twoX: {width: 4, height: 2, pixelRatio: 2},
    },
  });
  return {
    lockfileVersion: 1,
    sets: {
      '@acme/brand': {
        teamId: 'team_fixture',
        setId: `ics_${'a'.repeat(16)}`,
        versionId: `icv_${'a'.repeat(16)}`,
        version: 1,
        packageId: `icp_${'a'.repeat(16)}`,
        contentHash: await hashTileflowIconPackageManifest(manifest),
        manifest,
        spriteUrl: `https://api.tileflow.dev/sprites/icp_${'a'.repeat(16)}/sprite`,
      },
    },
  };
}

function fixtureReceipt(lock: TileflowIconsLockfileV1): TileflowIconCompositionV1 {
  const pin = lock.sets['@acme/brand']!;
  return {
    format: 'tileflow-icon-composition-v1',
    compositionVersion: 1,
    packageHash: pin.contentHash,
    contributors: [
      {
        kind: 'icon-set',
        reference: '@acme/brand',
        teamId: pin.teamId,
        setId: pin.setId,
        versionId: pin.versionId,
        version: pin.version,
        packageId: pin.packageId,
        contentHash: pin.contentHash,
        iconIds: ['marker'],
      },
    ],
    winners: [
      {
        id: 'marker',
        contributor: 0,
        width: 2,
        height: 1,
        pixelSha256: {oneX: 'b'.repeat(64), twoX: 'c'.repeat(64)},
      },
    ],
  };
}

test('iconSet is a frozen, explicit portable descriptor', () => {
  assert.deepEqual(iconSet('@acme/brand'), {kind: 'icon-set', reference: '@acme/brand'});
  assert.equal(Object.isFrozen(iconSet('@acme/brand')), true);
  for (const reference of [
    '@Acme/brand',
    '@acme/Brand',
    '@acme/brand@1',
    '@acme/../brand',
    '@acme//brand',
    '@acme/brand ',
    '@acme/brand?token=x',
    `@${'a'.repeat(65)}/brand`,
  ]) {
    assert.equal(
      tileflowIconSetSourceSchema.safeParse({kind: 'icon-set', reference}).success,
      false,
    );
  }
  assert.equal(
    tileflowIconSetSourceSchema.safeParse({...iconSet('@acme/brand'), token: 'secret'}).success,
    false,
  );
});

test('inheritance, replacement, empty arrays and explicit mixed order retain their meaning', () => {
  const base = extendStreets({id: 'base', icons: [iconSet('@acme/brand')]});
  assert.deepEqual(
    parseTileflowMap(defineMap({id: 'child', version: 1, extends: base})).icons,
    base.icons,
  );
  assert.deepEqual(
    parseTileflowMap(defineMap({id: 'child', version: 1, extends: base, icons: []})).icons,
    [],
  );
  assert.deepEqual(
    parseTileflowMap(defineMap({id: 'child', version: 1, extends: base, icons: ['./icons']})).icons,
    ['./icons'],
  );
  const sources = [iconSet('@acme/brand'), iconSet('@acme/transport'), './icons'] as const;
  assert.deepEqual(parseTileflowMap(extendStreets({id: 'main', icons: sources})).icons, sources);
  assert.throws(() =>
    parseTileflowMap(extendStreets({id: 'main', icons: [sources[0], sources[0]]})),
  );
  assert.throws(() => parseTileflowMap(extendStreets({id: 'main', fonts: [sources[0] as never]})));
});

test('the complete contributor sequence is bounded at 32', () => {
  const sources: TileflowIconSource[] = Array.from({length: 32}, (_, index) =>
    iconSet(`@acme/set-${index}`),
  );
  assert.equal(collectTileflowIconSetReferences(sources).length, 32);
  assert.throws(() => collectTileflowIconSetReferences([...sources, './icons']));
  assert.throws(() => collectTileflowIconSetReferences([sources[0]!, sources[0]!]));
});

test('strict icon JSON rejects duplicate, escaped-equivalent, malformed and deeply nested keys', () => {
  for (const text of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '[{"a":1,"a":2}]',
    '{"a":1,}',
    '[1,]',
    '0 1',
    '01',
    'NaN',
    '1e999',
    '['.repeat(34) + '0' + ']'.repeat(34),
  ])
    assert.throws(() => parseTileflowIconJson(text, 1024));
  assert.throws(() => parseTileflowIconJson('"long"', 2));
  assert.deepEqual(parseTileflowIconJson('{"a":[true,false,null,-1.5e2,"x"]}', 1024), {
    a: [true, false, null, -150, 'x'],
  });
  const prototype = parseTileflowIconJson('{"__proto__":{"polluted":true}}', 1024) as object;
  assert.equal(Object.hasOwn(prototype, '__proto__'), true);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('lock serialization is canonical and checks exact selected references and manifest hashes', async () => {
  const lock = await fixtureLock();
  const encoded = await serializeTileflowIconsLockfile(lock);
  assert.ok(encoded.endsWith('\n'));
  assert.equal(
    await serializeTileflowIconsLockfile(
      await parseTileflowIconsLockfile(encoded, [iconSet('@acme/brand')]),
    ),
    encoded,
  );
  await assert.rejects(parseTileflowIconsLockfile(lock, []));
  await assert.rejects(parseTileflowIconsLockfile(lock, [iconSet('@acme/transport')]));
  await assert.rejects(parseTileflowIconsLockfile({...lock, lockfileVersion: 2}));
  await assert.rejects(parseTileflowIconsLockfile({...lock, credentials: 'not-allowed'}));
  const corrupt = structuredClone(lock);
  corrupt.sets['@acme/brand']!.contentHash = 'f'.repeat(64);
  await assert.rejects(parseTileflowIconsLockfile(corrupt));
  await assert.rejects(
    parseTileflowIconsLockfile('{"lockfileVersion":1,"lockfileVersion":1,"sets":{}}'),
  );
});

test('lock rejects unsafe delivery URLs, version numbers, identity aliasing and mixed Teams', async () => {
  const lock = await fixtureLock();
  const pin = lock.sets['@acme/brand']!;
  for (const spriteUrl of [
    pin.spriteUrl + '?token=x',
    pin.spriteUrl + '#fragment',
    pin.spriteUrl.replace('https:', 'http:'),
    pin.spriteUrl.replace('https://', 'https://secret@'),
    pin.spriteUrl.replace('/sprites/', '/sprites/../'),
    pin.spriteUrl.replace('icp_', 'wrong_'),
  ]) {
    await assert.rejects(
      parseTileflowIconsLockfile({...lock, sets: {'@acme/brand': {...pin, spriteUrl}}}),
    );
  }
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(
      parseTileflowIconsLockfile({...lock, sets: {'@acme/brand': {...pin, version}}}),
    );
  await assert.rejects(
    parseTileflowIconsLockfile({...lock, sets: {...lock.sets, '@acme/alias': pin}}),
  );
  await assert.rejects(
    parseTileflowIconsLockfile({
      ...lock,
      sets: {
        ...lock.sets,
        '@other/brand': {...pin, teamId: 'another', setId: `ics_${'b'.repeat(16)}`},
      },
    }),
  );
});

test('receipts validate the complete ordered winner closure without source metadata', async () => {
  const receipt = fixtureReceipt(await fixtureLock());
  assert.deepEqual(parseTileflowIconComposition(receipt), receipt);
  assert.throws(() => parseTileflowIconComposition({...receipt, originalSourceHashes: []}));
  assert.throws(() => parseTileflowIconComposition({...receipt, winners: []}));
  assert.throws(() =>
    parseTileflowIconComposition({...receipt, winners: [{...receipt.winners[0], contributor: 1}]}),
  );
  const shadowed = structuredClone(receipt);
  shadowed.contributors.push({kind: 'local', iconIds: ['marker']});
  assert.throws(() => parseTileflowIconComposition(shadowed));
  shadowed.winners[0]!.contributor = 1;
  assert.deepEqual(parseTileflowIconComposition(shadowed), shadowed);
  assert.notEqual(
    await hashTileflowIconComposition(receipt),
    await hashTileflowIconComposition(shadowed),
  );
});

test('shared artifact content and consumed revisions are distinct map identity inputs', async () => {
  const receipt = fixtureReceipt(await fixtureLock());
  const map = parseTileflowMap(extendStreets({id: 'main', icons: [iconSet('@acme/brand')]}));
  const {contributor: _contributor, ...pixels} = receipt.winners[0]!;
  const sources: TileflowEffectiveMapSourceAssets = {
    fonts: [],
    icons: [{kind: 'rendered-icon', ...pixels}],
    iconComposition: receipt,
  };
  const original = await hashTileflowMapRevision(map, sources);
  assert.equal(await hashTileflowMapRevision(map, structuredClone(sources)), original);
  const changed = structuredClone(sources);
  const dependency = changed.iconComposition!.contributors[0]!;
  assert.equal(dependency.kind, 'icon-set');
  if (dependency.kind !== 'icon-set') throw new Error('Expected set dependency');
  dependency.version = 2;
  dependency.versionId = `icv_${'b'.repeat(16)}`;
  assert.equal(changed.iconComposition!.packageHash, receipt.packageHash);
  assert.notEqual(await hashTileflowMapRevision(map, changed), original);
  await assert.rejects(hashTileflowMapRevision(map, {fonts: [], icons: sources.icons}));
  await assert.rejects(
    hashTileflowMapRevision(
      parseTileflowMap(extendStreets({id: 'main', icons: [iconSet('@acme/other')]})),
      sources,
    ),
  );
});
