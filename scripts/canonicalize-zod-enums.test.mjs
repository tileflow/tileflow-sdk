import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalizeZodEnumDeclarations} from './canonicalize-zod-enums.mjs';

test('sorts generated Zod enum maps and literal unions without changing other declarations', () => {
  const source = [
    'declare const enumSchema: z.ZodEnum<{',
    '    zebra: "zebra";',
    '    alpha: "alpha";',
    '}>;',
    'declare const record: {',
    '    zebra: string;',
    '    alpha: string;',
    '};',
    'declare const nested: z.ZodOptional<z.ZodEnum<{',
    '    "top-right": "top-right";',
    '    "bottom-left": "bottom-left";',
    '}>>;',
    'declare const placement: {',
    '    position?: "center" | "right" | "left" | undefined;',
    '};',
    '',
  ].join('\n');
  const expected = [
    'declare const enumSchema: z.ZodEnum<{',
    '    alpha: "alpha";',
    '    zebra: "zebra";',
    '}>;',
    'declare const record: {',
    '    zebra: string;',
    '    alpha: string;',
    '};',
    'declare const nested: z.ZodOptional<z.ZodEnum<{',
    '    "bottom-left": "bottom-left";',
    '    "top-right": "top-right";',
    '}>>;',
    'declare const placement: {',
    '    position?: "center" | "left" | "right" | undefined;',
    '};',
    '',
  ].join('\n');

  assert.equal(canonicalizeZodEnumDeclarations(source), expected);
  assert.equal(canonicalizeZodEnumDeclarations(expected), expected);
});
