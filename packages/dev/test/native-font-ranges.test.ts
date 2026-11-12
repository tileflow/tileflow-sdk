import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {tileflowNativeFontUnicodeRanges} from '../src/native-font-ranges';

const font = (path: string) => readFile(new URL(path, import.meta.url));
const covers = (ranges: readonly string[], text: string) =>
  [...text].every((character) => {
    const point = character.codePointAt(0)!;
    return ranges.some((range) => {
      const [start, end] = range
        .slice(2)
        .split('-')
        .map((value) => Number.parseInt(value, 16));
      return start! <= point && point <= end!;
    });
  });

test('a Latin font claims Latin and leaves Greek and other scripts to the next font', async () => {
  const ranges = tileflowNativeFontUnicodeRanges(
    await font('./fixtures/fonts/oxanium/Oxanium-Medium.ttf'),
  );
  assert.ok(covers(ranges, 'Madrid Plaza Mayor éñü'));
  for (const text of ['Ω', 'μ', 'έ', 'Ж', '中', 'ا'])
    assert.equal(covers(ranges, text), false, text);
  // Ascending, disjoint and not adjacent runs, in the form native engines read.
  let previous = -2;
  for (const range of ranges) {
    const match = /^U\+([0-9A-F]{4,6})-([0-9A-F]{4,6})$/u.exec(range);
    assert.ok(match, range);
    const [start, end] = [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16)];
    assert.ok(start <= end && start > previous + 1, range);
    previous = end;
  }
  // The character map's terminating 0xFFFF entry draws nothing and is not claimed.
  assert.equal(covers(ranges, '￿'), false);
});

test('a broad font claims the scripts it draws', async () => {
  const ranges = tileflowNativeFontUnicodeRanges(
    await font('./fixtures/fonts/streets/NotoSans-Bold.ttf'),
  );
  assert.ok(covers(ranges, 'Madrid Ωμέγα Москва'));
  assert.equal(covers(ranges, '中'), false);
});

test('bytes that are not a font fail', () => {
  assert.throws(() => tileflowNativeFontUnicodeRanges(new Uint8Array([0, 1, 0, 0, 0, 0])));
});
