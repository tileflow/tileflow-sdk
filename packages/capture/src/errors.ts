export type TileflowCaptureErrorCode =
  | 'ABORTED'
  | 'APPLICATION_ORIGIN_REQUIRED'
  | 'APPLICATION_ORIGIN_INVALID'
  | 'APPLICATION_NAVIGATION_FAILED'
  | 'APPLICATION_TARGET_NOT_FOUND'
  | 'APPLICATION_TARGET_AMBIGUOUS'
  | 'APPLICATION_ERROR'
  | 'BASELINE_INVALID'
  | 'BROWSER_INSTALL_FAILED'
  | 'BROWSER_MISSING'
  | 'BROWSER_START_FAILED'
  | 'CAPTURE_TIMEOUT'
  | 'INVALID_PNG'
  | 'MAP_LOAD_FAILED'
  | 'RENDER_FAILED'
  | 'RESOURCE_FAILED'
  | 'SCENE_NOT_FOUND'
  | 'SCREENSHOT_FAILED'
  | 'STYLE_INVALID'
  | 'SYNTHETIC_ASSET_NOT_FOUND'
  | 'WORLD_RESOLUTION_FAILED';

export type TileflowCapturePhase =
  | 'style-validation'
  | 'browser-start'
  | 'resource-load'
  | 'map-load'
  | 'map-idle'
  | 'screenshot';

export type TileflowCaptureDiagnostic = {
  message: string;
  path: string;
};

export type TileflowCaptureResourceKind =
  | 'glyph'
  | 'other-http'
  | 'sprite-image'
  | 'sprite-json'
  | 'tilejson'
  | 'vector-tile';

export type TileflowCaptureResourceDiagnostic = {
  context?: string;
  kind: TileflowCaptureResourceKind;
  origin: string;
  status?: number;
};

export type TileflowCaptureErrorDetails = {
  diagnostics?: TileflowCaptureDiagnostic[];
  phase?: TileflowCapturePhase;
  resources?: TileflowCaptureResourceDiagnostic[];
};

export type TileflowCaptureErrorOptions = ErrorOptions & {
  details?: TileflowCaptureErrorDetails;
};

export class TileflowCaptureError extends Error {
  readonly code: TileflowCaptureErrorCode;
  readonly details?: TileflowCaptureErrorDetails;

  constructor(
    code: TileflowCaptureErrorCode,
    message: string,
    options?: TileflowCaptureErrorOptions,
  ) {
    super(message, options?.cause === undefined ? undefined : {cause: options.cause});
    this.name = 'TileflowCaptureError';
    this.code = code;
    this.details = normalizeDetails(options?.details);
  }
}

export function captureErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TileflowCaptureError) {
    return error.message;
  }

  return fallback;
}

function normalizeDetails(
  details: TileflowCaptureErrorDetails | undefined,
): TileflowCaptureErrorDetails | undefined {
  if (!details) return undefined;
  const diagnostics = (details.diagnostics ?? [])
    .map((diagnostic) => ({
      message: boundText(diagnostic.message.replace(/[\r\n]+/g, ' ').trim(), 300),
      path: boundText(diagnostic.path.replaceAll('\\', '/'), 300),
    }))
    .sort((left, right) => {
      const leftKey = `${left.path}\u0000${left.message}`;
      const rightKey = `${right.path}\u0000${right.message}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .slice(0, 32);
  const resources = (details.resources ?? [])
    .map(normalizeResource)
    .filter((resource): resource is TileflowCaptureResourceDiagnostic => resource !== undefined)
    .sort((left, right) => {
      const leftKey = `${left.kind}\u0000${left.origin}\u0000${left.status ?? ''}\u0000${left.context ?? ''}`;
      const rightKey = `${right.kind}\u0000${right.origin}\u0000${right.status ?? ''}\u0000${right.context ?? ''}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .filter(
      (resource, index, values) =>
        index === 0 || JSON.stringify(resource) !== JSON.stringify(values[index - 1]),
    )
    .slice(0, 8);
  const normalized = {
    ...(details.phase ? {phase: details.phase} : {}),
    ...(diagnostics.length > 0 ? {diagnostics} : {}),
    ...(resources.length > 0 ? {resources} : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeResource(
  resource: TileflowCaptureResourceDiagnostic,
): TileflowCaptureResourceDiagnostic | undefined {
  let origin: string;
  try {
    origin = new URL(resource.origin).origin;
  } catch {
    return undefined;
  }
  const status =
    resource.status !== undefined &&
    Number.isInteger(resource.status) &&
    resource.status >= 100 &&
    resource.status <= 599
      ? resource.status
      : undefined;
  const context = resource.context
    ? boundText(resource.context.replace(/[^A-Za-z0-9 _.,:@+-]/g, '').trim(), 128)
    : undefined;

  return {
    ...(context ? {context} : {}),
    kind: resource.kind,
    origin,
    ...(status === undefined ? {} : {status}),
  };
}

function boundText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
