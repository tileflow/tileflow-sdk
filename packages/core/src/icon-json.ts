import {TileflowIconSetError} from './icon-set';

/** Bounded JSON parser which rejects duplicate keys, including escaped equivalents. */
export function parseTileflowIconJson(text: string, maximumBytes: number): unknown {
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new TileflowIconSetError('ICON_LOCK_INVALID', 'Icon JSON exceeds its byte limit');
  }
  let position = 0;
  const fail = (): never => {
    throw new TileflowIconSetError(
      'ICON_LOCK_INVALID',
      `Invalid or duplicate-key icon JSON at offset ${position}`,
    );
  };
  const whitespace = () => {
    while (position < text.length && /[\t\n\r ]/u.test(text[position]!)) position += 1;
  };
  const string = (): string => {
    if (text[position] !== '"') return fail();
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '\\') {
        position += 1;
      } else if (character === '"') {
        try {
          return JSON.parse(text.slice(start, position)) as string;
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 32) return fail();
    whitespace();
    const character = text[position];
    if (character === '"') return string();
    if (character === '{') {
      position += 1;
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      whitespace();
      if (text[position] === '}') {
        position += 1;
        return result;
      }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) return fail();
        keys.add(key);
        whitespace();
        if (text[position++] !== ':') return fail();
        Object.defineProperty(result, key, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        whitespace();
        const delimiter = text[position++];
        if (delimiter === '}') return result;
        if (delimiter !== ',') return fail();
      }
    }
    if (character === '[') {
      position += 1;
      const result: unknown[] = [];
      whitespace();
      if (text[position] === ']') {
        position += 1;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        const delimiter = text[position++];
        if (delimiter === ']') return result;
        if (delimiter !== ',') return fail();
      }
    }
    for (const [literal, parsed] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return parsed;
      }
    }
    const number = text.slice(position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!number || !Number.isFinite(Number(number))) return fail();
    position += number.length;
    return Number(number);
  };
  const result = value(0);
  whitespace();
  if (position !== text.length) return fail();
  return result;
}
