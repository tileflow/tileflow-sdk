import assert from 'node:assert/strict';

const [candidateArgument, currentArgument] = process.argv.slice(2);
const candidate = parseVersion(candidateArgument);
const current = parseVersion(currentArgument);

assert.ok(
  compareVersions(candidate, current) >= 0,
  `Candidate ${candidateArgument} would move the dist-tag behind ${currentArgument}.`,
);

console.log(`Version order is safe: ${candidateArgument} >= ${currentArgument}.`);

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/u.exec(value ?? '');
  assert.ok(match, `Unsupported release version: ${value ?? ''}.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    alpha: match[4] === undefined ? undefined : Number(match[4]),
  };
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.alpha === right.alpha) return 0;
  if (left.alpha === undefined) return 1;
  if (right.alpha === undefined) return -1;
  return left.alpha > right.alpha ? 1 : -1;
}
