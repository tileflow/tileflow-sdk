import {z} from 'zod';

import {
  tileflowWorldReleaseIdMaximumLength,
  tileflowWorldReleaseIdMinimumLength,
  tileflowWorldReleaseIdPattern,
} from './world-release-id-values';

export {
  isTileflowWorldReleaseId,
  tileflowWorldReleaseIdMaximumLength,
  tileflowWorldReleaseIdMinimumLength,
  tileflowWorldReleaseIdPattern,
  tileflowWorldReleaseIdPatternSource,
} from './world-release-id-values';

export const tileflowWorldReleaseIdSchema = z
  .string()
  .min(tileflowWorldReleaseIdMinimumLength)
  .max(tileflowWorldReleaseIdMaximumLength)
  .regex(tileflowWorldReleaseIdPattern);
