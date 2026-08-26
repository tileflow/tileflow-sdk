import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// The OIDC publish job intentionally installs no workspace dependencies.
const numericAlphaPattern =
  /^((?:0|[1-9]\d*))\.((?:0|[1-9]\d*))\.((?:0|[1-9]\d*))-alpha\.((?:0|[1-9]\d*))$/u;

function nextAlphaVersion(value) {
  const match = numericAlphaPattern.exec(value ?? '');
  assert.ok(match, `Expected a numeric alpha version, found ${value ?? '<missing>'}.`);
  return `${match[1]}.${match[2]}.${match[3]}-alpha.${BigInt(match[4]) + 1n}`;
}

export function classifyPublicationState({baselineState, currentTag, from, targetState, to}) {
  assert.ok(
    baselineState === 'published' || baselineState === 'unpublished',
    'Invalid baseline state.',
  );
  if (baselineState === 'published') {
    assert.equal(to, nextAlphaVersion(from), `Expected ${nextAlphaVersion(from)} after ${from}.`);
  } else {
    assert.equal(from, 'unpublished', 'An unpublished package must have no registry origin.');
    nextAlphaVersion(to);
  }
  assert.ok(['missing', 'identical', 'different'].includes(targetState), 'Invalid target state.');
  if (targetState === 'identical' && currentTag === to) return 'published';
  if (
    targetState === 'missing' &&
    ((baselineState === 'published' && currentTag === from) ||
      (baselineState === 'unpublished' && currentTag === 'unpublished'))
  ) {
    return 'publish';
  }
  if (targetState === 'different') {
    assert.fail(`${to} already exists with different package contents.`);
  }
  if (targetState === 'identical') {
    assert.fail(`${to} exists, but alpha points to ${currentTag}; OIDC cannot repair dist-tags.`);
  }
  assert.fail(
    baselineState === 'unpublished'
      ? `Expected the package to remain unpublished, found alpha at ${currentTag}.`
      : `Expected alpha to point to ${from}, found ${currentTag}.`,
  );
}

async function main() {
  const [from, to, currentTag, targetState, baselineState, ...rest] = process.argv.slice(2);
  assert.equal(rest.length, 0, 'Unexpected publication-decision arguments.');
  console.log(classifyPublicationState({baselineState, currentTag, from, targetState, to}));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
