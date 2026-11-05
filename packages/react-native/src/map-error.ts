import {nativeErrorInfo, nativeErrorMessage} from './native-error';

export type MapErrorEvent = Readonly<{
  code: string;
  message: string;
  recoverable: boolean;
  context?: Readonly<Record<string, unknown>>;
}>;

export class TileflowMapError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(event: MapErrorEvent) {
    super(event.message);
    this.name = 'TileflowMapError';
    this.code = event.code;
    this.recoverable = event.recoverable;
    if (event.context) this.context = event.context;
  }
}

export function mapError(value: unknown): TileflowMapError {
  if (value instanceof TileflowMapError) return value;
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const info = nativeErrorInfo(value) ?? raw;
  const code =
    typeof info.code === 'string'
      ? info.code
      : typeof raw.code === 'string'
        ? raw.code
        : 'rendererFailed';
  const context =
    typeof info.context === 'object' && info.context !== null
      ? (info.context as Record<string, unknown>)
      : undefined;
  return new TileflowMapError({
    code,
    message: nativeErrorMessage(value, 'The native map operation failed.'),
    recoverable: info.recoverable === true,
    ...(context ? {context} : {}),
  });
}

export const retiredMap = () =>
  new TileflowMapError({
    code: 'disposed',
    message: 'The map is no longer mounted.',
    recoverable: false,
  });
