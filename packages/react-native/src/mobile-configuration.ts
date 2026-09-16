export type MobileConfiguration = Readonly<{apiOrigin: string; credential: string}>;

export type NativeConfigurationErrorCode =
  | 'NATIVE_CONFIGURATION_INVALID'
  | 'NATIVE_CONFIGURATION_UNAVAILABLE'
  | 'NATIVE_CONFIGURATION_SOURCE_INVALID'
  | 'NATIVE_CONFIGURATION_ORIGIN_MISMATCH'
  | 'NATIVE_CONFIGURATION_REPLACED'
  | 'NATIVE_CONFIGURATION_DISPOSED';

const messages: Record<NativeConfigurationErrorCode, string> = {
  NATIVE_CONFIGURATION_INVALID: 'Native application configuration is invalid.',
  NATIVE_CONFIGURATION_UNAVAILABLE: 'Native application configuration is unavailable.',
  NATIVE_CONFIGURATION_SOURCE_INVALID: 'Hosted source metadata is invalid.',
  NATIVE_CONFIGURATION_ORIGIN_MISMATCH: 'Hosted source origin is not approved by the application.',
  NATIVE_CONFIGURATION_REPLACED: 'Hosted binding resolution was replaced.',
  NATIVE_CONFIGURATION_DISPOSED: 'Hosted binding resolution is disposed.',
};

/** Internal diagnostics never retain input values or a native exception. */
export class NativeConfigurationError extends Error {
  readonly code: NativeConfigurationErrorCode;

  constructor(code: NativeConfigurationErrorCode) {
    super(messages[code]);
    this.name = 'NativeConfigurationError';
    this.code = code;
  }
}

function invalid(): never {
  throw new NativeConfigurationError('NATIVE_CONFIGURATION_INVALID');
}

/**
 * Deliberately narrower than a resource URL: ASCII DNS or canonical dotted-decimal IPv4,
 * HTTPS, optional decimal port and one optional root slash. No URL parser recovery.
 * Keep this grammar identical to MobileConfiguration.kt and TFMobileConfiguration.mm.
 */
export function canonicalMobileApiOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return invalid();
  const match = /^(https):\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?\/?$/iu.exec(value);
  // JavaScript's dollar anchor can precede a final newline; require the complete match.
  if (!match || match[0] !== value) return invalid();
  const host = match[2]!.toLowerCase();
  const labels = host.split('.');
  if (
    host.length > 253 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) return invalid();
  const last = labels[labels.length - 1]!;
  if (!/^[a-z]/u.test(last)) {
    // Prevent WHATWG's shortened, octal, hexadecimal and integer IPv4 aliases.
    if (
      labels.length !== 4 ||
      labels.some((label) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(label) || Number(label) > 255)
    ) return invalid();
  }
  const port = match[3] === undefined ? 443 : Number(match[3]);
  if (port > 65_535) return invalid();
  return `https://${host}${port === 443 ? '' : `:${port}`}`;
}

/** Read data properties only; no getters, inherited fields or coercion hooks. */
export function configurationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

/** The only payload from the native reader is two bounded primitive values. */
export function snapshotMobileConfiguration(value: unknown): MobileConfiguration {
  try {
    const data = configurationRecord(value);
    if (
      Object.keys(data).length !== 2 ||
      !Object.hasOwn(data, 'apiOrigin') ||
      !Object.hasOwn(data, 'credential') ||
      typeof data.credential !== 'string' ||
      data.credential.length !== 58 ||
      !/^tf_public_[0-9a-f]{48}$/u.test(data.credential)
    ) return invalid();
    const apiOrigin = canonicalMobileApiOrigin(data.apiOrigin);
    // Private callers can read these fields. Public serialization/inspection cannot copy them.
    return Object.freeze(Object.defineProperties({}, {
      apiOrigin: {value: apiOrigin},
      credential: {value: data.credential},
    })) as MobileConfiguration;
  } catch {
    return invalid();
  }
}
