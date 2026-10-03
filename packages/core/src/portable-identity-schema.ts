import type {ManifestStringOperations} from './manifest-schema-operations';
import {
  isTileflowThemeName,
  tileflowPortableIdMaximumLength,
  tileflowPortableIdPattern,
} from './portable-identity-rules';

/** The identity contract is declared once; adapters supply only schema operations. */
export function createPortableIdentitySchemas(operations: ManifestStringOperations) {
  const bounded = operations.maxLength(
    operations.minLength(operations.string(), 1),
    tileflowPortableIdMaximumLength,
  );
  const pattern = operations.regex(
    bounded,
    tileflowPortableIdPattern,
    'Expected lowercase kebab-case beginning with a letter',
  );
  const tileflowPortableIdSchema = operations.refine(
    pattern,
    (name) =>
      !['constructor', 'prototype'].includes(name) &&
      !/^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/i.test(name),
    'Expected a portable identifier that is not a reserved filename or prototype key',
  );
  const tileflowThemeNameSchema = operations.refine(
    tileflowPortableIdSchema,
    isTileflowThemeName,
    'Expected a concrete theme name; system is browser-only',
  );
  return {tileflowPortableIdSchema, tileflowThemeNameSchema};
}
