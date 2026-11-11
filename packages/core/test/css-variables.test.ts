import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeTileflowCssColor} from '../src/css-color';
import {
  hasTileflowCssVariable,
  resolveTileflowCssVariables,
  TileflowCssVariableError,
} from '../src/css-variables';

const variables: Record<string, string> = {
  '--primary': 'oklch(0.55 0.2 260)',
  '--alias': 'var(--primary)',
  '--empty': '',
  '--loop-a': 'var(--loop-b)',
  '--loop-b': 'var(--loop-a)',
  '--padded': '  #123456  ',
  '--percent': '40%',
};
const read = (name: string) => variables[name];

test('finds a variable call and ignores a longer name that ends in var', () => {
  assert.equal(hasTileflowCssVariable('var(--primary)'), true);
  assert.equal(hasTileflowCssVariable('VAR(--primary)'), true);
  assert.equal(hasTileflowCssVariable('color-mix(in oklab, var(--a) 40%, white)'), true);
  assert.equal(hasTileflowCssVariable('#123456'), false);
  assert.equal(hasTileflowCssVariable('somevar(--a)'), false);
});

test('substitutes a variable, trimming its value', () => {
  assert.equal(resolveTileflowCssVariables('var(--primary)', read), 'oklch(0.55 0.2 260)');
  assert.equal(resolveTileflowCssVariables('var( --padded )', read), '#123456');
  assert.equal(resolveTileflowCssVariables('#abcdef', read), '#abcdef');
});

test('uses the fallback when the variable is not set or is empty', () => {
  assert.equal(resolveTileflowCssVariables('var(--missing, #ff0000)', read), '#ff0000');
  assert.equal(resolveTileflowCssVariables('var(--empty, #ff0000)', read), '#ff0000');
  // A fallback may hold commas, as a colour function does.
  assert.equal(resolveTileflowCssVariables('var(--missing, rgb(1, 2, 3))', read), 'rgb(1, 2, 3)');
  // The variable wins over its fallback.
  assert.equal(resolveTileflowCssVariables('var(--primary, red)', read), 'oklch(0.55 0.2 260)');
});

test('resolves variables inside a variable, a fallback, and color-mix()', () => {
  assert.equal(resolveTileflowCssVariables('var(--alias)', read), 'oklch(0.55 0.2 260)');
  assert.equal(
    resolveTileflowCssVariables('var(--missing, var(--also-missing, var(--primary)))', read),
    'oklch(0.55 0.2 260)',
  );
  assert.equal(
    resolveTileflowCssVariables(
      'color-mix(in oklab, var(--primary) var(--percent), var(--missing, white))',
      read,
    ),
    'color-mix(in oklab, oklch(0.55 0.2 260) 40%, white)',
  );
});

test('resolved text is something the colour parser reads', () => {
  const mixed = resolveTileflowCssVariables(
    'color-mix(in srgb, var(--padded) 50%, var(--missing, #ffffff))',
    read,
  );
  assert.equal(normalizeTileflowCssColor(mixed), '#899aab');
});

test('names a variable with no value and no fallback', () => {
  assert.throws(
    () => resolveTileflowCssVariables('var(--missing)', read),
    (error: unknown) =>
      error instanceof TileflowCssVariableError &&
      error.variable === '--missing' &&
      /--missing has no value and no fallback/u.test(error.message),
  );
  assert.throws(
    () => resolveTileflowCssVariables('color-mix(in srgb, var(--primary), var(--gone))', read),
    /--gone has no value/u,
  );
  assert.throws(() => resolveTileflowCssVariables('var(--empty)', read), /--empty has no value/u);
});

test('rejects a cycle and a name that is not a custom property', () => {
  assert.throws(
    () => resolveTileflowCssVariables('var(--loop-a)', read),
    /--loop-a refers to itself/u,
  );
  assert.throws(
    () => resolveTileflowCssVariables('var(primary)', read),
    /not a CSS variable name/u,
  );
});

test('stops a value that expands without end', () => {
  // Each variable names the next one twice, so the expansion doubles at every step.
  const doubling = (name: string) => {
    const next = `--n${Number(name.slice(3)) + 1}`;
    return `var(${next}) var(${next})`;
  };
  assert.throws(
    () => resolveTileflowCssVariables('var(--n0)', doubling),
    (error: unknown) => error instanceof TileflowCssVariableError,
  );
});
