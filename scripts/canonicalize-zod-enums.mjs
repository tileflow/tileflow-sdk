import assert from 'node:assert/strict';
import {lstat, readdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const enumMarker = 'z.ZodEnum<{\n';
const enumPropertyPattern =
  /^(\s*)((?:"(?:[^"\\]|\\.)*"|[A-Za-z_$][A-Za-z0-9_$]*)):\s*"(?:[^"\\]|\\.)*";$/u;
const stringLiteral = String.raw`"(?:[^"\\]|\\.)*"`;
const stringLiteralUnionPattern = new RegExp(
  `(?:${stringLiteral})(?: \\| ${stringLiteral})+`,
  'gu',
);

export function canonicalizeZodEnumDeclarations(source) {
  let output = '';
  let offset = 0;

  while (offset < source.length) {
    const start = source.indexOf(enumMarker, offset);
    if (start < 0) {
      output += source.slice(offset);
      break;
    }

    const bodyStart = start + enumMarker.length;
    const parsed = parseEnumBody(source, bodyStart);
    if (!parsed) {
      output += source.slice(offset, bodyStart);
      offset = bodyStart;
      continue;
    }

    output += source.slice(offset, bodyStart);
    output += parsed.properties
      .toSorted((left, right) => compareEnumProperty(left, right))
      .map(({line}) => line)
      .join('\n');
    output += '\n';
    offset = parsed.end;
  }

  return output.replace(stringLiteralUnionPattern, (value) =>
    value
      .split(' | ')
      .toSorted((left, right) => compareStringLiteral(left, right))
      .join(' | '),
  );
}

function parseEnumBody(source, bodyStart) {
  const properties = [];
  let offset = bodyStart;

  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    if (newline < 0) return null;
    const line = source.slice(offset, newline);
    if (/^\s*\}>/u.test(line)) {
      return properties.length > 0 ? {end: offset, properties} : null;
    }

    const match = line.match(enumPropertyPattern);
    if (!match) return null;
    properties.push({key: enumPropertyKey(match[2]), line});
    offset = newline + 1;
  }

  return null;
}

function enumPropertyKey(value) {
  return value.startsWith('"') ? JSON.parse(value) : value;
}

function compareEnumProperty(left, right) {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function compareStringLiteral(left, right) {
  return compareEnumProperty({key: JSON.parse(left)}, {key: JSON.parse(right)});
}

async function declarationFiles(root) {
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), `Declaration root is invalid: ${root}.`);
  const files = [];

  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      assert.ok(entry.isFile() && !entry.isSymbolicLink(), `Declaration file is invalid: ${path}.`);
      if (/\.d\.(?:cts|mts|ts)$/u.test(entry.name)) files.push(path);
    }
  }

  await visit(resolve(root));
  return files;
}

async function main() {
  const roots = process.argv.slice(2);
  assert.ok(roots.length > 0, 'Expected one or more declaration roots.');
  let changed = 0;

  for (const root of roots) {
    for (const path of await declarationFiles(root)) {
      const source = await readFile(path, 'utf8');
      const canonical = canonicalizeZodEnumDeclarations(source);
      if (canonical === source) continue;
      await writeFile(path, canonical);
      changed += 1;
    }
  }

  console.log(`Canonicalized ${changed} declaration file(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
