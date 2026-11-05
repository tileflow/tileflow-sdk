import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {
  createBoundaryLookup,
  joinBoundaryRows,
  parseBoundaryLookupCsv,
} from '../packages/core/src/boundary-areas/join.ts';

// Run with node --import tsx. Core supplies the expectations shared by native bindings.
const target = fileURLToPath(new URL('../platforms/boundary-joins.json', import.meta.url));
const rows = (...entries) => entries.map(([key, value]) => ({key, value}));
const madridCsv = [
  'id,class,class_tier,admin_level,iso_3166_1,iso_3166_2,nuts,ref,wikidata,name,ignored',
  '100,region,primary,4,ES,ES-MD,ES30,ES-MD,Q5756,Comunidad de Madrid,skip',
  '100,province_or_county,primary,6,ES,ES-MD,ES30,ES:INE:28,Q5756,Madrid,skip',
  '101,municipality,primary,8,ES,,,ES:INE:28079,Q2807,Madrid,skip',
  '108,municipality,primary,8,ES,,,ES:INE:28092,Q19960,"Móstoles, ""Madrid""\r\nCentro",skip',
  '109,district,primary,9,ES,,,ES:INE:28079:01,Q19960,Centro,skip',
  '110,district,secondary,9,ES,,,,Q0,,skip',
].join('\r\n');
const madrid = parseBoundaryLookupCsv(madridCsv);

const lookups = {madrid};
const cases = [
  {
    name: 'numeric IDs normalize to safe integers, with stable last-wins order',
    rows: rows(
      [' 0x2A ', 1],
      [3, 'three'],
      ['\uFEFF0b101010\uFEFF', null],
      ['0o52', 'last'],
      ['.3e1', 4],
      [9007199254740991, 5],
      ['9007199254740992', 6],
      [9007199254740992, 7],
      [-1, 8],
      [1.25, 9],
      ['0x1p0', 10],
      ['1d', 11],
      [' ', 12],
      ['-0', 13],
    ),
    options: {joinBy: 'id'},
  },
  {
    name: 'direct refs preserve case, normalize whitespace and ignore empty classes',
    rows: rows(['  ref-a ', 1], ['REF-A', 2], ['ref-a', null], [5, 3], ['', 4]),
    options: {joinBy: 'ref', to: 'ref', classes: []},
  },
  {
    name: 'refs preserve distinct Unicode spellings',
    rows: rows(['é', 1], ['e\u0301', 2], ['é', 3]),
    options: {joinBy: 'ref', to: 'ref'},
  },
  {
    name: 'one ID across two classes emits both refs',
    lookup: 'madrid',
    rows: rows([' es-md ', 'active']),
    options: {joinBy: 'iso_3166_2', to: 'ref'},
  },
  {
    name: 'one ID across two classes is unambiguous',
    lookup: 'madrid',
    rows: rows([' es-md ', 1]),
    options: {joinBy: 'iso_3166_2'},
  },
  {
    name: 'class filter restricts a code to one class',
    lookup: 'madrid',
    rows: rows([' es-md ', 1]),
    options: {joinBy: 'iso_3166_2', to: 'ref', classes: ['province_or_county']},
  },
  {
    name: 'an empty class filter matches nothing',
    lookup: 'madrid',
    rows: rows([' es-md ', 1], ['ES-MD', 2]),
    options: {joinBy: 'iso_3166_2', classes: []},
  },
  {
    name: 'Wikidata distinguishes duplicate, unmatched and ambiguous keys',
    lookup: 'madrid',
    rows: rows(
      [' q2807 ', 1],
      ['q19960', 2],
      [' q19960 ', 3],
      ['Q2807', null],
      [' q-missing ', 4],
      ['Q-MISSING', 5],
    ),
    options: {joinBy: 'wikidata'},
  },
  {
    name: 'a match without the target ref is unmatched',
    lookup: 'madrid',
    rows: rows([' q0 ', 1]),
    options: {joinBy: 'wikidata', to: 'ref'},
  },
  {
    name: 'country codes normalize and multiple IDs are ambiguous',
    lookup: 'madrid',
    rows: rows([' es ', 1], [' es ', 2], [' pt ', 3]),
    options: {joinBy: 'iso_3166_1'},
  },
  {
    name: 'NUTS codes normalize',
    lookup: 'madrid',
    rows: rows([' es30 ', 1]),
    options: {joinBy: 'nuts'},
  },
  {
    name: 'ref lookup keeps case and trims whitespace',
    lookup: 'madrid',
    rows: rows([' ES:INE:28079 ', 1], ['es:ine:28079', 2]),
    options: {joinBy: 'ref'},
  },
  {
    name: 'ID lookup resolves normalized numeric string to a ref',
    lookup: 'madrid',
    rows: rows([' 1.01e2 ', 1]),
    options: {joinBy: 'id', to: 'ref'},
  },
  {
    name: 'CSV supports CRLF, escaped quotes, embedded newlines and extra columns',
    csv: madridCsv,
    rows: rows([' q19960 ', 4]),
    options: {joinBy: 'wikidata', classes: ['municipality']},
  },
  {
    name: 'invalid CSV row width',
    csv: 'id,class\n1',
    rows: rows(['ES', 1]),
    options: {joinBy: 'iso_3166_1'},
  },
  {
    name: 'unterminated CSV quote',
    csv: 'id,class\n1,"region',
    rows: rows(['ES', 1]),
    options: {joinBy: 'iso_3166_1'},
  },
  {
    name: 'invalid lookup ID',
    lookup: [{id: -1, class: 'region'}],
    rows: rows(['ES', 1]),
    options: {joinBy: 'iso_3166_1'},
  },
  {
    name: 'invalid lookup class',
    lookup: [{id: 1, class: 'unknown'}],
    rows: rows(['ES', 1]),
    options: {joinBy: 'iso_3166_1'},
  },
  {
    name: 'indirect joins require a lookup',
    rows: rows(['ES', 1]),
    options: {joinBy: 'iso_3166_1'},
  },
].map((test) => {
  try {
    const parsed =
      test.csv !== undefined
        ? parseBoundaryLookupCsv(test.csv)
        : typeof test.lookup === 'string'
          ? lookups[test.lookup]
          : test.lookup;
    const lookup = parsed === undefined ? undefined : createBoundaryLookup(parsed);
    return {
      ...test,
      ...(test.csv === undefined ? {} : {parsed}),
      expected: joinBoundaryRows(test.rows, {...test.options, lookup}),
    };
  } catch (error) {
    return {...test, error: error.message};
  }
});

const config = await resolveConfig(target);
const text = await format(JSON.stringify({schemaVersion: 1, lookups, cases}), {
  ...config,
  filepath: target,
});
const projections = [
  ['platforms/boundary-joins.json', text],
  ['platforms/ios/Tests/TileflowTests/Fixtures/boundary-joins.json', text],
  ['platforms/android/tileflow/src/test/resources/boundary-joins.json', text],
];
for (const [sourceName, targetName] of [
  ['join', 'boundary-join'],
  ['schema', 'boundary-schema'],
]) {
  const sourcePath = `packages/core/src/boundary-areas/${sourceName}.ts`;
  const input = await readFile(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
  const header = `// Generated by scripts/native-boundary-joins-generate.mjs from ${sourcePath}.\n`;
  const path = `packages/react-native/src/generated/${targetName}.ts`;
  projections.push([
    path,
    await format(header + input.replace("from './schema'", "from './boundary-schema'"), {
      ...config,
      filepath: path,
    }),
  ]);
}

for (const [path, content] of projections) {
  const output = new URL(`../${path}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if ((await readFile(output, 'utf8')) !== content) throw new Error(`${path} is stale.`);
  } else {
    await mkdir(dirname(fileURLToPath(output)), {recursive: true});
    await writeFile(output, content);
  }
}
