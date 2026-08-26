import {
  auditTileflowInteractionJsonDocument,
  type TileflowAnnotation,
  tileflowAnnotationsSchema,
  type TileflowInteractionBinding,
  tileflowInteractionBindingsSchema,
  type TileflowInteractionJsonValue,
  tileflowInteractionLimits,
  type TileflowInteractionTargetRef,
  type TileflowJsonDocumentAuditResult,
} from './contracts';

export type TileflowInteractionDiagnosticCode =
  | 'DUPLICATE_ANNOTATION_ID'
  | 'INVALID_FIELD'
  | 'INVALID_ANNOTATION'
  | 'INVALID_DOCUMENT'
  | 'LIMIT_EXCEEDED'
  | 'MISSING_VIEW'
  | 'OVERLAY_FAILURE'
  | 'SEMANTIC_MANIFEST_MISMATCH'
  | 'STALE_TARGET'
  | 'UNSTABLE_FEATURE_IDENTITY'
  | 'UNSUPPORTED_MODE'
  | 'UNSUPPORTED_TARGET';

export type TileflowInteractionDiagnostic = {
  code: TileflowInteractionDiagnosticCode;
  level: 'error' | 'warning';
  message: string;
  /** RFC 6901 JSON Pointer. The empty string identifies the document root. */
  path?: string;
  target?: TileflowInteractionTargetRef;
};

export type TileflowAnnotationValidationResult =
  | {
      annotations: TileflowAnnotation<TileflowInteractionJsonValue>[];
      diagnostics: [];
      ok: true;
    }
  | {
      diagnostics: TileflowInteractionDiagnostic[];
      ok: false;
    };

export type TileflowInteractionBindingValidationResult =
  | {
      bindings: TileflowInteractionBinding[];
      diagnostics: [];
      ok: true;
    }
  | {
      diagnostics: TileflowInteractionDiagnostic[];
      ok: false;
    };

export function validateTileflowAnnotations(input: unknown): TileflowAnnotationValidationResult {
  const invalidDocument = () => invalidAnnotationsDocument();

  try {
    const topLevelLength = inspectTopLevelArrayLength(input);
    if (!topLevelLength.ok) return invalidDocument();
    if (
      topLevelLength.length !== undefined &&
      topLevelLength.length > tileflowInteractionLimits.maxAnnotations
    ) {
      return {
        diagnostics: [
          diagnostic(
            'LIMIT_EXCEEDED',
            '',
            `Annotations exceed the ${tileflowInteractionLimits.maxAnnotations}-item limit.`,
          ),
        ],
        ok: false,
      };
    }

    const audit = auditTileflowInteractionJsonDocument(input);
    if (!audit.ok) {
      return {
        diagnostics: [documentAuditDiagnostic('Annotations', audit, invalidDocumentMessage)],
        ok: false,
      };
    }

    let parsed: ReturnType<typeof tileflowAnnotationsSchema.safeParse>;
    try {
      parsed = tileflowAnnotationsSchema.safeParse(input);
    } catch {
      return invalidDocument();
    }

    if (!parsed.success) {
      return {
        diagnostics: parsed.error.issues.map((issue) =>
          diagnostic('INVALID_ANNOTATION', jsonPointer(issue.path), issue.message),
        ),
        ok: false,
      };
    }

    const duplicateDiagnostics: TileflowInteractionDiagnostic[] = [];
    const firstIndexById = new Map<string, number>();

    for (const [index, annotation] of parsed.data.entries()) {
      const firstIndex = firstIndexById.get(annotation.id);
      if (firstIndex === undefined) {
        firstIndexById.set(annotation.id, index);
        continue;
      }

      duplicateDiagnostics.push(
        diagnostic(
          'DUPLICATE_ANNOTATION_ID',
          `/${index}/id`,
          `Annotation id "${annotation.id}" duplicates /${firstIndex}/id.`,
        ),
      );
    }

    if (duplicateDiagnostics.length > 0) {
      return {diagnostics: duplicateDiagnostics, ok: false};
    }

    return {annotations: parsed.data, diagnostics: [], ok: true};
  } catch {
    return invalidDocument();
  }
}

export function validateTileflowInteractionBindings(
  input: unknown,
): TileflowInteractionBindingValidationResult {
  const invalidDocument = () => invalidBindingsDocument();

  try {
    const topLevelLength = inspectTopLevelArrayLength(input);
    if (!topLevelLength.ok) return invalidDocument();
    if (
      topLevelLength.length !== undefined &&
      topLevelLength.length > tileflowInteractionLimits.maxBindings
    ) {
      return {
        diagnostics: [
          diagnostic(
            'LIMIT_EXCEEDED',
            '',
            `Interaction bindings exceed the ${tileflowInteractionLimits.maxBindings}-item limit.`,
          ),
        ],
        ok: false,
      };
    }

    const audit = auditTileflowInteractionJsonDocument(input);
    if (!audit.ok) {
      return {
        diagnostics: [
          documentAuditDiagnostic('Interaction bindings', audit, invalidBindingsDocumentMessage),
        ],
        ok: false,
      };
    }

    let parsed: ReturnType<typeof tileflowInteractionBindingsSchema.safeParse>;
    try {
      parsed = tileflowInteractionBindingsSchema.safeParse(input);
    } catch {
      return invalidDocument();
    }

    if (!parsed.success) {
      return {
        diagnostics: parsed.error.issues.map((issue) =>
          diagnostic('INVALID_DOCUMENT', jsonPointer(issue.path), issue.message),
        ),
        ok: false,
      };
    }

    const firstIndexById = new Map<string, number>();
    const diagnostics: TileflowInteractionDiagnostic[] = [];
    for (const [index, binding] of parsed.data.entries()) {
      const firstIndex = firstIndexById.get(binding.id);
      if (firstIndex === undefined) {
        firstIndexById.set(binding.id, index);
        continue;
      }
      diagnostics.push(
        diagnostic(
          'INVALID_DOCUMENT',
          `/${index}/id`,
          `Interaction id "${binding.id}" duplicates /${firstIndex}/id.`,
        ),
      );
    }

    return diagnostics.length > 0
      ? {diagnostics, ok: false}
      : {bindings: parsed.data, diagnostics: [], ok: true};
  } catch {
    return invalidDocument();
  }
}

/*
 * The top-level collection limit is intentionally checked before the document walker. In
 * particular, this rejects a hostile sparse array from its length descriptor without enumerating
 * its keys or asking a schema to iterate billions of holes.
 */
function inspectTopLevelArrayLength(input: unknown): {length?: number; ok: true} | {ok: false} {
  try {
    if (!Array.isArray(input)) return {ok: true};
    const descriptor = Object.getOwnPropertyDescriptor(input, 'length');
    if (
      !descriptor ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'number' ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0
    ) {
      return {ok: false};
    }
    return {length: descriptor.value, ok: true};
  } catch {
    return {ok: false};
  }
}

const invalidDocumentMessage = 'Annotations must be a finite, acyclic JSON document.';
const invalidBindingsDocumentMessage =
  'Interaction bindings must be a finite, acyclic JSON document.';

function invalidAnnotationsDocument(): TileflowAnnotationValidationResult {
  return {
    diagnostics: [diagnostic('INVALID_DOCUMENT', '', invalidDocumentMessage)],
    ok: false,
  };
}

function invalidBindingsDocument(): TileflowInteractionBindingValidationResult {
  return {
    diagnostics: [diagnostic('INVALID_DOCUMENT', '', invalidBindingsDocumentMessage)],
    ok: false,
  };
}

function documentAuditDiagnostic(
  subject: string,
  audit: Extract<TileflowJsonDocumentAuditResult, {ok: false}>,
  invalidMessage: string,
): TileflowInteractionDiagnostic {
  switch (audit.reason) {
    case 'bytes':
      return diagnostic(
        'LIMIT_EXCEEDED',
        '',
        `${subject} exceed the ${tileflowInteractionLimits.maxDocumentBytes}-byte document limit.`,
      );
    case 'depth':
      return diagnostic(
        'LIMIT_EXCEEDED',
        '',
        `${subject} exceed the ${tileflowInteractionLimits.maxDocumentDepth}-level document depth limit.`,
      );
    case 'nodes':
      return diagnostic(
        'LIMIT_EXCEEDED',
        '',
        `${subject} exceed the ${tileflowInteractionLimits.maxDocumentNodes}-node document limit.`,
      );
    case 'properties':
      return diagnostic(
        'LIMIT_EXCEEDED',
        '',
        `${subject} exceed the ${tileflowInteractionLimits.maxDocumentProperties}-property document limit.`,
      );
    case 'invalid':
      return diagnostic('INVALID_DOCUMENT', '', invalidMessage);
  }
}

function diagnostic(
  code: TileflowInteractionDiagnosticCode,
  path: string,
  message: string,
): TileflowInteractionDiagnostic {
  return {code, level: 'error', message, path};
}

function jsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .map((segment) => `/${segment}`)
    .join('');
}
