import {z} from 'zod';
import {compareCodeUnits, serializeCanonicalJson, sha256Hex, tileflowIconIdSchema, tileflowIconPackageContentHashSchema, tileflowIconPackageLimits} from './icon-package';
import {TileflowIconSetError, tileflowIconSetIdSchema, tileflowIconSetPackageIdSchema, tileflowIconSetReferenceSchema, tileflowIconSetTeamIdSchema, tileflowIconSetVersionIdSchema, tileflowIconSourceLimit} from './icon-set';

export const tileflowIconCompositionMaximumBytes = 1024 * 1024;
const idsSchema = z.array(tileflowIconIdSchema).max(tileflowIconPackageLimits.maxIconCount).refine(
	(ids) => new Set(ids).size === ids.length && ids.every((id, index) => index === 0 || compareCodeUnits(ids[index - 1]!, id) < 0),
	'Icon exports must be unique and sorted by code unit',
);
const localContributorSchema = z.object({kind: z.literal('local'), iconIds: idsSchema}).strict();
const packageContributorSchema = z.object({
	kind: z.literal('package'),
	package: z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u),
	iconIds: idsSchema,
}).strict();
const setContributorSchema = z.object({
	kind: z.literal('icon-set'),
	reference: tileflowIconSetReferenceSchema,
	teamId: tileflowIconSetTeamIdSchema,
	setId: tileflowIconSetIdSchema,
	versionId: tileflowIconSetVersionIdSchema,
	version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	packageId: tileflowIconSetPackageIdSchema,
	contentHash: tileflowIconPackageContentHashSchema,
	iconIds: idsSchema.min(1),
}).strict();

export const tileflowRenderedIconIdentitySchema = z.object({
	kind: z.literal('rendered-icon'),
	id: tileflowIconIdSchema,
	width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension / 2),
	height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension / 2),
	pixelSha256: z.object({oneX: tileflowIconPackageContentHashSchema, twoX: tileflowIconPackageContentHashSchema}).strict(),
}).strict();
export type TileflowRenderedIconIdentity = z.infer<typeof tileflowRenderedIconIdentitySchema>;

export const tileflowIconCompositionSchema = z.object({
	format: z.literal('tileflow-icon-composition-v1'),
	compositionVersion: z.literal(1),
	packageHash: tileflowIconPackageContentHashSchema,
	contributors: z.array(z.discriminatedUnion('kind', [localContributorSchema, packageContributorSchema, setContributorSchema])).min(1).max(tileflowIconSourceLimit),
	winners: z.array(tileflowRenderedIconIdentitySchema.omit({kind: true}).extend({contributor: z.number().int().min(0).max(tileflowIconSourceLimit - 1)})).min(1).max(tileflowIconPackageLimits.maxIconCount),
}).strict().superRefine((receipt, context) => {
	const expected = new Map<string, number>();
	const references = new Set<string>();
	const sets = new Set<string>();
	const versions = new Set<string>();
	const teams = new Set<string>();
	const teamSlugs = new Set<string>();
	for (const [ordinal, contributor] of receipt.contributors.entries()) {
		if (contributor.kind === 'icon-set') {
			if (references.has(contributor.reference) || sets.has(contributor.setId) || versions.has(contributor.versionId)) {
				context.addIssue({code: 'custom', path: ['contributors', ordinal], message: 'Duplicate icon set dependency'});
			}
			references.add(contributor.reference);
			sets.add(contributor.setId);
			versions.add(contributor.versionId);
			teams.add(contributor.teamId);
			teamSlugs.add(contributor.reference.split('/')[0]!);
		}
		for (const id of contributor.iconIds) expected.set(id, ordinal);
	}
	if (teams.size !== 1 || teamSlugs.size !== 1) context.addIssue({code: 'custom', path: ['contributors'], message: 'A shared composition must contain exact dependencies from one Team'});
	const names = [...expected.keys()].sort(compareCodeUnits);
	if (names.length !== receipt.winners.length || receipt.winners.some((winner, index) => names[index] !== winner.id || expected.get(winner.id) !== winner.contributor)) {
		context.addIssue({code: 'custom', path: ['winners'], message: 'Winners must exactly cover the sorted last-wins export closure'});
	}
	if (new TextEncoder().encode(serializeCanonicalJson(receipt)).byteLength > tileflowIconCompositionMaximumBytes) {
		context.addIssue({code: 'custom', message: 'Composition receipt exceeds its byte limit'});
	}
});

export type TileflowIconCompositionV1 = z.infer<typeof tileflowIconCompositionSchema>;
export type TileflowIconContributorIdentity = TileflowIconCompositionV1['contributors'][number];

export function parseTileflowIconComposition(input: unknown): TileflowIconCompositionV1 {
	const parsed = tileflowIconCompositionSchema.safeParse(input);
	if (!parsed.success) throw new TileflowIconSetError('ICON_COMPOSITION_INVALID', 'Invalid ordered icon composition receipt', {cause: parsed.error});
	return parsed.data;
}

/** Dependency identity is separate from the generated artifact's content hash. */
export async function hashTileflowIconComposition(input: TileflowIconCompositionV1): Promise<string> {
	return sha256Hex(`tileflow-icon-composition-v1\0${serializeCanonicalJson(parseTileflowIconComposition(input))}`);
}
