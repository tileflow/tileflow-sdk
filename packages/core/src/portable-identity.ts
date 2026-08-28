import {z} from 'zod';
import {
  isTileflowThemeName,
  tileflowPortableIdMaximumLength,
  tileflowPortableIdPattern,
} from './portable-identity-rules';

export {
  isTileflowPortableId,
  isTileflowThemeName,
  tileflowPortableIdMaximumLength,
} from './portable-identity-rules';

/** Canonical, filesystem-safe identity shared by authored and emitted Tileflow resources. */
export const tileflowPortableIdSchema = z
  .string()
  .min(1)
  .max(tileflowPortableIdMaximumLength)
  .regex(tileflowPortableIdPattern, {
    message: 'Expected lowercase kebab-case beginning with a letter',
  })
  .refine(
    (name) =>
      !['constructor', 'prototype'].includes(name) &&
      !/^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/i.test(name),
    'Expected a portable identifier that is not a reserved filename or prototype key',
  );

/** A concrete compiled theme identity. `system` exists only as a browser-side selector. */
export const tileflowThemeNameSchema = tileflowPortableIdSchema.refine(
  isTileflowThemeName,
  'Expected a concrete theme name; system is browser-only',
);
