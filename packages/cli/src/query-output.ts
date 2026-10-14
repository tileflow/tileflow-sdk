/** Resolve an RFC 6901 pointer without consulting object prototypes. */
export function selectJsonPointer(value: unknown, pointer = ''): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) {
    throw new Error('--path must be an RFC 6901 JSON Pointer, such as /modules/roads.');
  }
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`No value at JSON Pointer ${pointer}.`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function parseQueryInteger(value: string, name: string, maximum: number): number {
  if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return Number(value);
}

/** A bounded tree projection. Omitted pointers are explicit and can be queried again. */
export function boundJson(value: unknown, options: {limit: number; depth: number}) {
  let remaining = options.limit;
  let truncated = false;
  const omitted: string[] = [];
  function omit(path: string) {
    truncated = true;
    if (omitted.length < options.limit) omitted.push(path);
  }
  function visit(node: unknown, path: string, depth: number): unknown {
    if (typeof node === 'string' && node.length > 4_096) {
      omit(path);
      return node.slice(0, 4_096);
    }
    if (!node || typeof node !== 'object') return node;
    const entries = Object.entries(node);
    if (depth === 0 && entries.length) {
      omit(path);
      return Array.isArray(node) ? [] : {};
    }
    const result: Record<string, unknown> | unknown[] = Array.isArray(node) ? [] : {};
    for (const [key, child] of entries) {
      const childPath = `${path}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
      if (remaining === 0) {
        omit(childPath);
        continue;
      }
      remaining--;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: visit(child, childPath, depth - 1),
      });
    }
    return result;
  }
  const data = visit(value, '', options.depth);
  return {data, projection: {...options, truncated, omitted}};
}
