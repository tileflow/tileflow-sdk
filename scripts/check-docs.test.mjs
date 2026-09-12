import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {localLinkTarget, parseMarkdown} from './check-docs.mjs';

test('Markdown exposes marked examples and ignores headings and links inside fences', () => {
  const document = parseMarkdown(
    '# Package\n<!-- docs:check -->\n\n```ts\n// [not prose](missing.md)\nconst x = 1;\n```\n## Install\n',
  );
  assert.equal(document.blocks.length, 1);
  assert.equal(document.blocks[0].marked, true);
  assert.equal(document.blocks[0].language, 'ts');
  assert.equal(document.headings.length, 2);
  assert.ok(!document.prose.includes('missing.md'));
});

test('Markdown rejects missing languages, unclosed fences, and orphan markers', () => {
  for (const content of [
    '```\nx\n```',
    '```ts\nx',
    '<!-- docs:check -->',
    '<!-- docs:check -->\nNot a fence',
  ]) {
    assert.throws(() => parseMarkdown(content));
  }
});

test('Long fences can contain shorter fences without closing', () => {
  const document = parseMarkdown('````md\n```ts\nconst x = 1;\n```\n````');
  assert.equal(document.blocks.length, 1);
  assert.ok(document.blocks[0].code.includes('```ts'));
});

test('Repository URLs and relative links resolve locally without network requests', () => {
  const root = resolve('fixture');
  const source = resolve(root, 'packages/example/README.md');
  assert.equal(
    localLinkTarget('./docs/guide.md#section', source, root),
    resolve(root, 'packages/example/docs/guide.md'),
  );
  assert.equal(
    localLinkTarget('https://github.com/tileflow/tileflow-sdk/blob/main/README.md', source, root),
    resolve(root, 'README.md'),
  );
  assert.equal(
    localLinkTarget(
      'https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/README.md',
      source,
      root,
    ),
    resolve(root, 'README.md'),
  );
  assert.equal(localLinkTarget('https://example.com/guide', source, root), undefined);
  assert.equal(localLinkTarget('#section', source, root), undefined);
  assert.throws(() => localLinkTarget('/docs/guide', source, root));
});
