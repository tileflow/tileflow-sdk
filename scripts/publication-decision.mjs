import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {nextAlphaVersion} from './release-config.mjs';

export function classifyPublicationState({currentTag, from, targetState, to}) {
  assert.equal(to, nextAlphaVersion(from), `Expected ${nextAlphaVersion(from)} after ${from}.`);
  assert.ok(['missing', 'identical', 'different'].includes(targetState), 'Invalid target state.');
  if (targetState === 'identical' && currentTag === to) return 'published';
  if (targetState === 'missing' && currentTag === from) return 'publish';
  if (targetState === 'different') {
    assert.fail(`${to} already exists with different package contents.`);
  }
  if (targetState === 'identical') {
    assert.fail(`${to} exists, but alpha points to ${currentTag}; OIDC cannot repair dist-tags.`);
  }
  assert.fail(`Expected alpha to point to ${from}, found ${currentTag}.`);
}

async function main() {
  const [from, to, currentTag, targetState, ...rest] = process.argv.slice(2);
  assert.equal(rest.length, 0, 'Unexpected publication-decision arguments.');
  console.log(classifyPublicationState({currentTag, from, targetState, to}));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
