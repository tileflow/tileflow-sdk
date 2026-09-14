import type {z} from 'zod';
import {classicManifestStringOperations} from './manifest-schema-classic';
import {createPortableIdentitySchemas} from './portable-identity-schema';

export {
	isTileflowPortableId,
	isTileflowThemeName,
	tileflowPortableIdMaximumLength,
} from './portable-identity-rules';

const schemas = createPortableIdentitySchemas(classicManifestStringOperations);

/** Canonical, filesystem-safe identity shared by authored and emitted Tileflow resources. */
export const tileflowPortableIdSchema = schemas.tileflowPortableIdSchema as z.ZodString;

/** A concrete compiled theme identity. `system` exists only as a browser-side selector. */
export const tileflowThemeNameSchema = schemas.tileflowThemeNameSchema as z.ZodString;
