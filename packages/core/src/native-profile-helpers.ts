/** Resource budgets apply to validation work, not downloaded resources or native GPU memory. */
export const tileflowNativeProfileLimits = Object.freeze({
  maximumStyleBytes: 8 * 1024 * 1024,
  maximumDepth: 64,
  // Streets currently traverses ~122k values; 160k keeps ~30% deterministic headroom.
  maximumNodes: 160_000,
  maximumSources: 128,
  maximumLayers: 4_096,
  maximumIssues: 32,
  maximumFontFaces: 16,
  maximumFontBytes: 1024 * 1024,
});

/** Fixed output budget for a prepared native-v1 style, never a raw input allowance. */
export const tileflowNativePreparedStyleLimits = Object.freeze({
  ...tileflowNativeProfileLimits,
  // Full Streets themes lower to 513321/513231 nodes. 540k leaves 5.20%/5.22% headroom.
  maximumNodes: 540_000,
});

type NativeJsonStage = 'input' | 'prepared';

/** Issue links and missing support entries are not released SDK version evidence. */
export function supportsNativeVersions(
  support: Readonly<Record<string, unknown>>,
  engines: Readonly<{android: string; ios: string}>,
): boolean {
  return (['android', 'ios'] as const).every((platform) => {
    const since = support[platform];
    if (typeof since !== 'string' || !/^\d+\.\d+\.\d+$/u.test(since)) return false;
    const wanted = since.split('.').map(Number);
    const actual = engines[platform].split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      if (actual[index] !== wanted[index]) return actual[index]! > wanted[index]!;
    }
    return true;
  });
}

/** Return an ancestor pointer rather than echo URL- or credential-shaped object keys. */
export function nativePointer(parent: string, key: string): string {
  if (key.length > 128 || /[\p{Cc}\\]|:\/\/|tf_(?:live|public)_|[?=]/u.test(key)) return parent;
  const path = `${parent}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  return path.length > 300 ? parent : path;
}

/** One traversal and JSON policy; only the two fixed node allowances differ. */
export function isBoundedNativeJson(input: unknown, stage: NativeJsonStage = 'input'): boolean {
  if (stage !== 'input' && stage !== 'prepared') return false;
  const limits =
    stage === 'prepared' ? tileflowNativePreparedStyleLimits : tileflowNativeProfileLimits;
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new Set<object>();
  const encoder = new TextEncoder();
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > limits.maximumNodes || depth > limits.maximumDepth) {
      return false;
    }
    if (typeof value === 'string') {
      if (value.length > limits.maximumStyleBytes) return false;
      stringBytes += encoder.encode(value).byteLength;
      return stringBytes <= limits.maximumStyleBytes;
    }
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol' || key === 'toJSON')) return false;
    if (
      Array.isArray(value) &&
      (value.length > limits.maximumNodes || Object.keys(value).length !== value.length)
    ) {
      return false;
    }
    ancestors.add(value);
    for (const key of keys as string[]) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        !visit(key, depth + 1) ||
        !visit(descriptor.value, depth + 1)
      ) {
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  };
  try {
    return (
      visit(input, 0) &&
      encoder.encode(JSON.stringify(input)).byteLength <= limits.maximumStyleBytes
    );
  } catch {
    return false;
  }
}
