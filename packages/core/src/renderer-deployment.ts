import {z} from 'zod';
import {tileflowMaxPitch} from './camera-limits';
import {
  assertTileflowInteractionManifestLayers,
  type TileflowInteractionManifest,
} from './cartography/interaction-manifest';
import {compactDeploymentWebFamily, expandTileflowDeploymentArtifact} from './family-deployment';
import {
  tileflowIconCompositionSchema,
  tileflowRenderedIconIdentitySchema,
} from './icon-composition';
import {serializeCanonicalJson, sha256Hex} from './icon-package';
import {classicManifestSchemaOperations} from './manifest-schema-classic';
import {tileflowNativeBuildRecordSchema} from './native-build-record';
import {readTileflowNativeDegradations} from './native-capabilities';
import {validateTileflowNativePreparedStyle} from './native-profile';
import {createTileflowNativeFamily, tileflowNativeFamilySchema} from './native-profile-family';
import {tileflowNativeProfileLimits} from './native-profile-helpers';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';
import {type TileflowTimeOfDayVariants, validateTileflowTimeOfDayVariants} from './time-of-day';
import {createTileflowTimeOfDaySchema} from './time-of-day-schema';

/**
 * Transport and validation bounds of a Hosted renderer deployment, not renderer or commercial
 * quotas. Each is measured on the UTF-8 bytes of canonical JSON, before any transport encoding.
 * The web request carries the web family plus the native family's build manifest, build record and
 * document index; every native document (each theme style and the family document) then travels
 * in its own request.
 */
export const tileflowRendererDeploymentLimits = Object.freeze({
  maximumWebBytes: 2_000_000,
  maximumWebRequestBytes: 16 * 1024 * 1024,
  maximumDocumentBytes: tileflowNativeProfileLimits.maximumStyleBytes,
  maximumNativeFamilyBytes: 32 * 1024 * 1024,
  maximumThemes: 64,
});
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const modelNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const recordSchema = z.record(z.string().min(1).max(256), z.unknown());
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sourceAssetsSchema = z
  .object({
    fonts: z
      .array(
        z
          .object({
            family: z.string().min(1).max(128),
            sha256: hashSchema,
            style: z.enum(['italic', 'normal', 'oblique']),
            weight: z.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900']),
          })
          .strict(),
      )
      .max(64),
    icons: z
      .array(
        z.union([
          z
            .object({
              format: z.enum(['jpeg', 'png', 'svg', 'webp']),
              id: tileflowPortableIdSchema,
              kind: z.enum(['icon', 'pattern']),
              sha256: hashSchema,
            })
            .strict(),
          tileflowRenderedIconIdentitySchema,
        ]),
      )
      .max(512),
    iconComposition: tileflowIconCompositionSchema.optional(),
    /** The source glTF binaries of the map's own tree models, by level of detail. */
    models: z
      .array(
        z
          .object({id: modelNameSchema, level: z.enum(['far', 'mid', 'near']), sha256: hashSchema})
          .strict(),
      )
      .min(1)
      .max(256)
      .optional(),
  })
  .strict();
const themeBuildSchema = z
  .object({
    colorScheme: z.enum(['dark', 'light']),
    dataRequirements: recordSchema,
    sourceRequirements: recordSchema,
    styleSha256: hashSchema,
    themeId: tileflowPortableIdSchema,
    themeVersion: positive,
  })
  .strict();
const mapBuildSchema = z
  .object({
    assetSetSha256: hashSchema,
    defaultTheme: tileflowThemeNameSchema,
    lineage: z
      .array(z.object({id: tileflowPortableIdSchema, mapVersion: positive}).strict())
      .min(1)
      .max(64),
    mapRevisionSha256: hashSchema,
    mapRevisionSchemaVersion: z.literal(2).optional(),
    mapVersion: positive,
    semanticCompiler: z
      .object({name: z.literal('tileflow-semantic'), version: z.literal(1)})
      .strict(),
    sourceAssets: sourceAssetsSchema,
    systemThemes: z
      .object({dark: tileflowThemeNameSchema, light: tileflowThemeNameSchema})
      .strict()
      .optional(),
    themes: z.record(tileflowThemeNameSchema, themeBuildSchema),
    timeOfDay: (
      createTileflowTimeOfDaySchema(
        classicManifestSchemaOperations,
        tileflowThemeNameSchema,
      ) as z.ZodType<TileflowTimeOfDayVariants>
    ).optional(),
  })
  .strict();
const buildManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    maps: z.record(tileflowPortableIdSchema, mapBuildSchema),
    provenance: z
      .object({
        schemaVersion: z.literal(1),
        lockfile: z
          .object({format: z.enum(['bun', 'npm', 'pnpm', 'yarn']), sha256: hashSchema})
          .strict()
          .optional(),
        packages: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
      })
      .strict()
      .optional(),
  })
  .strict();
const familyShape = {
  buildManifest: buildManifestSchema,
  styles: z.record(tileflowThemeNameSchema, recordSchema),
};
/** Tileflow's own tilesets, which a Team source can never name. */
const platformTilesets = new Set([
  'bathymetry',
  'bathymetry-dem',
  'boundaries',
  'nautical',
  'terrain',
  'world',
]);
const teamSourcesSchema = z
  .record(
    tileflowPortableIdSchema,
    z
      .object({
        tileset: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        type: z.enum(['raster', 'vector']),
      })
      .strict(),
  )
  .superRefine((sources, context) => {
    const entries = Object.entries(sources);
    const tilesets = new Set<string>();
    if (entries.length > 16) context.addIssue({code: 'custom', message: 'Too many Team sources'});
    for (const [id, value] of entries) {
      if (
        id === 'tileflow' ||
        id.startsWith('tileflow-') ||
        platformTilesets.has(value.tileset) ||
        tilesets.has(value.tileset)
      )
        context.addIssue({code: 'custom', message: 'Invalid logical Team source binding'});
      tilesets.add(value.tileset);
    }
  });
const viewSchema = z
  .object({
    center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
    zoom: z.number().min(0).max(24).optional(),
    bearing: z.number().finite().optional(),
    pitch: z.number().min(0).max(tileflowMaxPitch).optional(),
  })
  .strict();

/** Explicit v2 only. Existing v1 envelopes and decoders are not extended by this schema. */
export const tileflowRendererDeploymentArtifactSchema = z
  .object({
    kind: z.literal('tileflow-map-deployment'),
    schemaVersion: z.literal(2),
    mapId: tileflowPortableIdSchema,
    teamSources: teamSourcesSchema,
    view: viewSchema.optional(),
    renderers: z
      .object({
        web: z.object(familyShape).strict(),
        native: z
          .object({
            ...familyShape,
            buildRecord: tileflowNativeBuildRecordSchema,
            family: tileflowNativeFamilySchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const {web, native} = artifact.renderers;
    if (
      !consistentFamilies(artifact.mapId, [
        {buildManifest: web.buildManifest, themes: Object.keys(web.styles)},
        {buildManifest: native.buildManifest, themes: Object.keys(native.styles)},
      ])
    )
      context.addIssue({
        code: 'custom',
        message: 'Renderer families must share one complete authored Map identity',
      });
  });
export type TileflowRendererDeploymentArtifact = z.infer<
  typeof tileflowRendererDeploymentArtifactSchema
>;

const nativeDocumentShape = {
  sha256: hashSchema,
  bytes: z.number().int().min(2).max(tileflowRendererDeploymentLimits.maximumDocumentBytes),
};

/**
 * The expanded request form of a renderer deployment (schema 5). The web family travels in the request; the
 * native family is declared by its build manifest, build record and an index of its documents: the
 * SHA-256 and size of each theme's native style and of the family document, which then travel in
 * their own requests. `splitTileflowRendererDeployment` derives it from a whole artifact.
 */
const expandedRequestSchema = z
  .object({
    kind: z.literal('tileflow-map-deployment'),
    schemaVersion: z.literal(5),
    mapId: tileflowPortableIdSchema,
    teamSources: teamSourcesSchema,
    view: viewSchema.optional(),
    renderers: z
      .object({
        web: z.object(familyShape).strict(),
        native: z
          .object({
            buildManifest: buildManifestSchema,
            buildRecord: tileflowNativeBuildRecordSchema,
            documents: z
              .object({
                styles: z.record(tileflowThemeNameSchema, z.object(nativeDocumentShape).strict()),
                family: z
                  .object({
                    ...nativeDocumentShape,
                    themes: z
                      .array(tileflowThemeNameSchema)
                      .min(1)
                      .max(tileflowRendererDeploymentLimits.maximumThemes),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const {web, native} = artifact.renderers;
    const {styles, family} = native.documents;
    const names = Object.keys(web.styles).sort();
    const nativeMap = native.buildManifest.maps[artifact.mapId];
    if (
      !consistentFamilies(artifact.mapId, [
        {buildManifest: web.buildManifest, themes: names},
        {buildManifest: native.buildManifest, themes: Object.keys(styles)},
      ]) ||
      new Set(family.themes).size !== family.themes.length ||
      !equal([...family.themes].sort(), names) ||
      !equal(
        native.buildRecord.transformations.map((value) => `${value.map}/${value.theme}`),
        names.map((name) => `${artifact.mapId}/${name}`),
      ) ||
      names.some((name) => styles[name]?.sha256 !== nativeMap?.themes[name]?.styleSha256) ||
      Object.values(styles).reduce((total, document) => total + document.bytes, family.bytes) >
        tileflowRendererDeploymentLimits.maximumNativeFamilyBytes
    )
      context.addIssue({
        code: 'custom',
        message: 'The request must index exactly the native documents of one complete Map',
      });
  });
/** Decode the compact web family before validating its identity against the native index. */
export const tileflowRendererDeploymentRequestArtifactSchema = z
  .unknown()
  .transform((input, ctx) => {
    try {
      return expandTileflowDeploymentArtifact(input);
    } catch {
      ctx.addIssue({code: 'custom', message: 'Invalid compact deployment family'});
      return z.NEVER;
    }
  })
  .pipe(expandedRequestSchema);

export type TileflowRendererDeploymentRequestArtifact = z.infer<
  typeof tileflowRendererDeploymentRequestArtifactSchema
>;

/** A renderer deployment as it travels: its request artifact and the native documents' bytes. */
export type TileflowSplitRendererDeployment = Readonly<{
  artifact: Omit<TileflowRendererDeploymentRequestArtifact, 'renderers'> & {
    renderers: {
      web: ReturnType<typeof compactDeploymentWebFamily>;
      native: TileflowRendererDeploymentRequestArtifact['renderers']['native'];
    };
  };
  /** The exact canonical JSON each native document is uploaded as, by theme, and the family's. */
  documents: Readonly<{styles: Readonly<Record<string, string>>; family: string}>;
}>;

export class TileflowRendererDeploymentError extends Error {
  readonly code = 'RENDERER_DEPLOYMENT_INVALID' as const;
  constructor() {
    super('Expected complete, bounded and consistent web and native deployment artifacts.');
    this.name = 'TileflowRendererDeploymentError';
  }
}

export type TileflowRendererDeploymentParseOptions = Readonly<{
  /**
   * An exact HTTP origin the native styles may reference, for local development of the API on
   * the developer's own machine. Hosted publication never accepts one.
   */
  developmentOrigin?: string;
}>;

/** Hash/profile verification is deliberately separate from shape validation and server authority. */
export async function parseTileflowRendererDeploymentArtifact(
  input: unknown,
  options: TileflowRendererDeploymentParseOptions = {},
): Promise<TileflowRendererDeploymentArtifact> {
  try {
    const inputText = serializeCanonicalJson(input);
    if (
      utf8Bytes(inputText) >
        tileflowRendererDeploymentLimits.maximumWebRequestBytes +
          tileflowRendererDeploymentLimits.maximumNativeFamilyBytes ||
      secretPattern.test(inputText)
    )
      throw new Error();
    const artifact = tileflowRendererDeploymentArtifactSchema.parse(input);
    const {web, native} = artifact.renderers;
    // Every budget applies to the deployment as it travels: the web request and each document.
    const split = await splitArtifact(artifact);
    if (!split) throw new Error();
    if (
      (await sha256Hex(serializeCanonicalJson(native.buildManifest))) !==
      native.buildRecord.buildManifestSha256
    )
      throw new Error();
    const names = Object.keys(web.styles).sort();
    if (
      !equal(
        native.buildRecord.transformations.map((value) => `${value.map}/${value.theme}`),
        names.map((name) => `${artifact.mapId}/${name}`),
      )
    )
      throw new Error();
    for (const name of names) {
      const webStyle = web.styles[name]!;
      const nativeStyle = native.styles[name]!;
      const webTheme = web.buildManifest.maps[artifact.mapId]!.themes[name]!;
      const nativeTheme = native.buildManifest.maps[artifact.mapId]!.themes[name]!;
      const transformation = native.buildRecord.transformations.find(
        (value) => value.theme === name,
      )!;
      const webHash = await sha256Hex(serializeCanonicalJson(webStyle));
      const nativeHash = split.artifact.renderers.native.documents.styles[name]?.sha256;
      if (
        webHash !== webTheme.styleSha256 ||
        nativeHash !== nativeTheme.styleSha256 ||
        transformation.inputStyleSha256 !== webHash ||
        !Array.isArray(webStyle.layers) ||
        !Array.isArray(nativeStyle.layers) ||
        transformation.inputLayers !== webStyle.layers.length ||
        transformation.outputLayers !== nativeStyle.layers.length
      )
        throw new Error();
      if (
        validateTileflowNativePreparedStyle(
          nativeValidationStyle(nativeStyle, artifact.teamSources),
          {
            documentUrl: `https://artifacts.invalid/native/styles/${artifact.mapId}/${name}.json`,
            ...(options.developmentOrigin === undefined
              ? {}
              : {developmentOrigin: options.developmentOrigin}),
          },
        ).length
      )
        throw new Error();
      // Representation lowering cannot introduce a different delivery graph or attribution. It
      // may only leave out a source whose recorded degradation names it.
      for (const field of ['sprite', 'glyphs']) {
        if (!equal(webStyle[field], nativeStyle[field])) throw new Error();
      }
      const webSources = object(webStyle.sources);
      const nativeSources = object(nativeStyle.sources);
      const degradations = readTileflowNativeDegradations(nativeStyle.metadata);
      if (!webSources || !nativeSources) throw new Error();
      for (const [id, source] of Object.entries(nativeSources))
        if (!equal(webSources[id], source)) throw new Error();
      for (const id of Object.keys(webSources))
        if (
          !Object.hasOwn(nativeSources, id) &&
          !degradations.some((record) =>
            nativeSourceDegradations.some((feature) => record.id === `${feature}:${id}`),
          )
        )
          throw new Error();
      if (
        !equal(
          transformation.degradations,
          degradations.map((record) => record.id),
        )
      )
        throw new Error();
      for (const style of [webStyle, nativeStyle]) {
        const metadata = object(style.metadata);
        if (
          !metadata ||
          metadata['tileflow:map'] !== artifact.mapId ||
          metadata['tileflow:theme'] !== name ||
          metadata['tileflow:mapVersion'] !== web.buildManifest.maps[artifact.mapId]!.mapVersion ||
          metadata['tileflow:colorScheme'] !== webTheme.colorScheme ||
          [
            'tileflow:deploymentId',
            'tileflow:deploymentVersion',
            'tileflow:mapId',
            'tileflow:nativeStyleSha256',
          ].some((key) => metadata[key] !== undefined)
        )
          throw new Error();
      }
      if (!equal(semanticIdentity(webStyle), semanticIdentity(nativeStyle))) throw new Error();
    }
    // The family document is exactly the one Core computes from these styles in its theme order.
    const family = native.family;
    if (
      family.map !== artifact.mapId ||
      !equal(family.themes.map((theme) => theme.name).sort(), names) ||
      !equal(
        createTileflowNativeFamily({
          map: artifact.mapId,
          themes: family.themes.map((theme) => theme.name),
          styles: native.styles as never,
        }),
        family,
      )
    )
      throw new Error();
    return artifact;
  } catch {
    throw new TileflowRendererDeploymentError();
  }
}

/**
 * Carry a whole renderer deployment as its request artifact (schema 5) plus the canonical bytes of
 * each native document, which are uploaded on their own. Fails when the web request, a document or
 * the native family exceeds its budget.
 */
export async function splitTileflowRendererDeployment(
  artifact: TileflowRendererDeploymentArtifact,
): Promise<TileflowSplitRendererDeployment> {
  let split: TileflowSplitRendererDeployment | undefined;
  try {
    split = await splitArtifact(artifact);
  } catch {
    split = undefined;
  }
  if (!split) throw new TileflowRendererDeploymentError();
  return split;
}

async function splitArtifact(
  artifact: TileflowRendererDeploymentArtifact,
): Promise<TileflowSplitRendererDeployment | undefined> {
  const {buildManifest, buildRecord, family, styles} = artifact.renderers.native;
  const limits = tileflowRendererDeploymentLimits;
  const names = Object.keys(styles).sort();
  const texts = names.map((name) => serializeCanonicalJson(styles[name]));
  const familyText = serializeCanonicalJson(family);
  const sizes = texts.map(utf8Bytes);
  const familyBytes = utf8Bytes(familyText);
  if (
    [...sizes, familyBytes].some((size) => size > limits.maximumDocumentBytes) ||
    sizes.reduce((total, size) => total + size, familyBytes) > limits.maximumNativeFamilyBytes
  )
    return undefined;
  const index = await Promise.all(
    texts.map(async (text, position) => ({sha256: await sha256Hex(text), bytes: sizes[position]!})),
  );
  const request = {
    kind: 'tileflow-map-deployment' as const,
    schemaVersion: 5 as const,
    mapId: artifact.mapId,
    teamSources: artifact.teamSources,
    ...(artifact.view ? {view: artifact.view} : {}),
    renderers: {
      web: compactDeploymentWebFamily(artifact.renderers.web),
      native: {
        buildManifest,
        buildRecord,
        documents: {
          styles: Object.fromEntries(names.map((name, position) => [name, index[position]!])),
          family: {
            sha256: await sha256Hex(familyText),
            bytes: familyBytes,
            themes: family.themes.map((theme) => theme.name),
          },
        },
      },
    },
  };
  const requestText = serializeCanonicalJson(request);
  if (
    utf8Bytes(requestText) > limits.maximumWebRequestBytes ||
    [requestText, ...texts, familyText].some((text) => secretPattern.test(text))
  )
    return undefined;
  const parsed = tileflowRendererDeploymentRequestArtifactSchema.safeParse(request);
  if (!parsed.success) return undefined;
  return {
    artifact: request,
    documents: {
      styles: Object.fromEntries(names.map((name, position) => [name, texts[position]!])),
      family: familyText,
    },
  };
}

/** Degradations whose subject is a web source the native style leaves out with its layers. */
const nativeSourceDegradations = ['deviceContours', 'pathGround', 'embeddedImages'] as const;
const secretPattern = /tf_(?:public|native|live)_/u;
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function nativeValidationStyle(
  style: Record<string, unknown>,
  bindings: TileflowRendererDeploymentArtifact['teamSources'],
) {
  const copy = JSON.parse(serializeCanonicalJson(style)) as Record<string, unknown>;
  const sources = object(copy.sources);
  for (const [id, binding] of Object.entries(bindings)) {
    const source = object(sources?.[id]);
    if (
      !source ||
      source.type !== binding.type ||
      source.url !== `tileflow://hosted-sources/${id}` ||
      source.tiles !== undefined
    )
      throw new Error();
    // Validate the representation without resolving a tenant or inventing resource authority.
    source.url = `https://artifacts.invalid/tiles/${id}/tiles.json`;
  }
  return copy;
}
type BuildManifest = z.infer<typeof buildManifestSchema>;
/** Both renderer families describe one complete authored Map, each with exactly these themes. */
function consistentFamilies(
  mapId: string,
  families: readonly Readonly<{buildManifest: BuildManifest; themes: readonly string[]}>[],
): boolean {
  for (const family of families) {
    const names = Object.keys(family.buildManifest.maps);
    const map = family.buildManifest.maps[mapId];
    if (names.length !== 1 || names[0] !== mapId || !map) return false;
    const themes = Object.keys(map.themes).sort();
    if (
      !themes.length ||
      themes.length > tileflowRendererDeploymentLimits.maximumThemes ||
      !equal(themes, [...family.themes].sort()) ||
      !themes.includes(map.defaultTheme) ||
      map.lineage[0]?.id !== mapId ||
      map.lineage[0]?.mapVersion !== map.mapVersion ||
      Boolean(map.sourceAssets.iconComposition) !== (map.mapRevisionSchemaVersion === 2)
    )
      return false;
    if (map.timeOfDay && validateTileflowTimeOfDayVariants(map.timeOfDay, map.themes).length)
      return false;
    for (const scheme of ['light', 'dark'] as const) {
      if (map.systemThemes && map.themes[map.systemThemes[scheme]]?.colorScheme !== scheme)
        return false;
    }
  }
  const [first, ...rest] = families;
  return rest.every((family) =>
    equal(authoredIdentity(first!.buildManifest), authoredIdentity(family.buildManifest)),
  );
}
function authoredIdentity(manifest: BuildManifest) {
  return {
    ...manifest,
    maps: Object.fromEntries(
      Object.entries(manifest.maps).map(([name, map]) => [
        name,
        {
          ...map,
          themes: Object.fromEntries(
            Object.entries(map.themes).map(([theme, value]) => {
              // Hashes and data requirements describe each renderer's own styles: a native style
              // may read other fields (building extrusions) or leave a degraded source out.
              const {
                styleSha256: _hash,
                dataRequirements: _data,
                sourceRequirements: _sources,
                ...identity
              } = value;
              return [theme, identity];
            }),
          ),
        },
      ]),
    ),
  };
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function equal(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined
    ? left === right
    : serializeCanonicalJson(left) === serializeCanonicalJson(right);
}
const artifactName = z
  .string()
  .min(1)
  .max(256)
  .refine((value) =>
    [...value].every((char) => {
      const code = char.codePointAt(0)!;
      return code >= 32 && code !== 127;
    }),
  );
const semanticSchema = z
  .object({
    version: z.literal(3),
    domains: z
      .object({
        poi: z
          .object({
            deduplication: z
              .object({
                identity: z.tuple([
                  z.literal('source'),
                  z.literal('source-layer'),
                  z.literal('feature-id'),
                ]),
                representationPriority: z.tuple([
                  z.literal('marker'),
                  z.literal('icon'),
                  z.literal('combined'),
                  z.literal('label'),
                ]),
              })
              .strict(),
            fields: z
              .object({
                category: artifactName,
                filterRank: artifactName,
                icon: artifactName,
                name: artifactName,
                sizeRank: artifactName,
                type: artifactName,
              })
              .strict(),
            hitTesting: z
              .object({
                frequency: z.literal('animation-frame'),
                order: z.literal('rendered-topmost'),
              })
              .strict(),
            identity: z.literal('maplibre-feature-id-if-present'),
            layers: z
              .array(
                z
                  .object({
                    anchor: z.literal('pointer-coordinate'),
                    layerId: artifactName,
                    priority: z.number().int().min(0).max(4095),
                    representation: z.enum(['combined', 'icon', 'label', 'marker']),
                    source: artifactName,
                    sourceLayer: artifactName,
                  })
                  .strict(),
              )
              .max(256),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
function semanticIdentity(style: Record<string, unknown>) {
  const candidate = object(style.metadata)?.['tileflow:interaction-manifest'];
  if (candidate === undefined) return undefined;
  const manifest = semanticSchema.parse(candidate);
  const layers = (style.layers as unknown[]).map((value) => {
    const layer = object(value);
    if (!layer) throw new Error();
    return layer;
  });
  assertTileflowInteractionManifestLayers(manifest as TileflowInteractionManifest, layers);
  const seen = new Set<string>();
  for (const layer of manifest.domains.poi?.layers ?? []) {
    if (seen.has(layer.layerId) || layers[layer.priority]?.id !== layer.layerId) throw new Error();
    seen.add(layer.layerId);
  }
  const poi = manifest.domains.poi;
  return poi
    ? {...poi, layers: poi.layers.map(({priority: _priority, ...identity}) => identity)}
    : manifest;
}

const mapIdSchema = z.string().regex(/^map_[A-Za-z0-9_-]{16}$/u);
const deploymentIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
/** The deployment a pending reply reserved; native documents are uploaded to its routes. */
const reservedDeploymentIdSchema = z.string().regex(/^dep_[A-Za-z0-9_-]{1,128}$/u);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
/** HTTPS, or HTTP on a loopback host for local development of the API. */
const deliveryUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && loopbackHosts.has(url.hostname))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.toString() === value &&
        !secretPattern.test(value)
      );
    } catch {
      return false;
    }
  });
const webResponseTheme = z
  .object({styleId: z.string().min(1).max(128).optional(), styleUrl: deliveryUrlSchema})
  .strict();
const nativeResponseTheme = z.object({styleUrl: deliveryUrlSchema, revision: hashSchema}).strict();
/**
 * The Team 3D models a map places, each at its published current version, and whether that
 * version was prepared from the same glTF binaries as the map's own files.
 */
const teamModelReportSchema = z
  .array(
    z
      .object({
        model: modelNameSchema,
        version: positive,
        sources: z.enum(['match', 'differ', 'unknown']),
      })
      .strict(),
  )
  .max(256);

/**
 * A published renderer deployment (schema 3): both families of one deployment version. Native
 * styles never carry Team 3D models; `teamModels` reports the ones the web family places.
 */
export const tileflowRendererDeploymentResponseSchema = z
  .object({
    kind: z.literal('tileflow-map-deployment-result'),
    schemaVersion: z.literal(3),
    changed: z.boolean(),
    mapId: mapIdSchema,
    deploymentId: deploymentIdSchema,
    version: positive,
    worldConversionId: z.string().min(1).max(128).optional(),
    renderers: z
      .object({
        web: z
          .object({
            themes: z.record(tileflowThemeNameSchema, webResponseTheme),
            familyUrl: deliveryUrlSchema.optional(),
          })
          .strict(),
        native: z
          .object({
            profile: z.literal('native-v1'),
            manifestUrl: deliveryUrlSchema,
            family: z.object({url: deliveryUrlSchema, revision: hashSchema}).strict(),
            themes: z.record(tileflowThemeNameSchema, nativeResponseTheme),
          })
          .strict(),
      })
      .strict(),
    teamModels: teamModelReportSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      const names = Object.keys(value.renderers.web.themes).sort();
      const native = value.renderers.native;
      const url = new URL(native.manifestUrl);
      const base = `${url.origin}/maps/${value.mapId}/native`;
      if (
        !names.length ||
        names.length > tileflowRendererDeploymentLimits.maximumThemes ||
        !equal(names, Object.keys(native.themes).sort()) ||
        native.manifestUrl !== `${base}/manifest.json` ||
        native.family.url !== `${base}/family/v${value.version}.json` ||
        (value.renderers.web.familyUrl !== undefined &&
          value.renderers.web.familyUrl !==
            `${url.origin}/maps/${value.mapId}/family/v${value.version}.json`) ||
        names.some(
          (name) => native.themes[name]!.styleUrl !== `${base}/v${value.version}/${name}.json`,
        )
      )
        throw new Error();
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Renderer response does not bind one complete deployment',
      });
    }
  });
export type TileflowRendererDeploymentResponse = z.infer<
  typeof tileflowRendererDeploymentResponseSchema
>;

const pendingDocumentShape = {
  ...nativeDocumentShape,
  method: z.literal('PUT'),
  url: deliveryUrlSchema,
};
/**
 * A reserved renderer deployment that publishes once the listed native documents arrive (HTTP
 * 202). Each missing theme style is listed, then the family document when it is missing; each is
 * uploaded with `PUT` to its `url`, and the same deployment request then activates it.
 */
export const tileflowRendererDeploymentPendingSchema = z
  .object({
    kind: z.literal('tileflow-map-deployment-pending'),
    schemaVersion: z.literal(1),
    mapId: mapIdSchema,
    deploymentId: reservedDeploymentIdSchema,
    version: positive,
    native: z
      .object({
        documents: z
          .array(
            z.discriminatedUnion('document', [
              z
                .object({
                  document: z.literal('style'),
                  theme: tileflowThemeNameSchema,
                  ...pendingDocumentShape,
                })
                .strict(),
              z.object({document: z.literal('family'), ...pendingDocumentShape}).strict(),
            ]),
          )
          .min(1)
          .max(tileflowRendererDeploymentLimits.maximumThemes + 1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const documents = value.native.documents;
    const themes = new Set<string>();
    let origin: string | undefined;
    for (const [index, document] of documents.entries()) {
      let documentOrigin: string | undefined;
      try {
        documentOrigin = new URL(document.url).origin;
      } catch {
        documentOrigin = undefined;
      }
      origin ??= documentOrigin;
      const path = tileflowNativeDocumentUploadPath(value.deploymentId, document);
      const valid =
        documentOrigin !== undefined &&
        documentOrigin === origin &&
        document.url === `${origin}${path}` &&
        (document.document === 'style'
          ? !themes.has(document.theme)
          : index === documents.length - 1);
      if (document.document === 'style') themes.add(document.theme);
      if (!valid)
        context.addIssue({
          code: 'custom',
          path: ['native', 'documents', index],
          message: 'Each missing native document is listed once, at its upload route, family last',
        });
    }
  });
export type TileflowRendererDeploymentPending = z.infer<
  typeof tileflowRendererDeploymentPendingSchema
>;

/** The API path a native document of a reserved deployment is uploaded to. */
export function tileflowNativeDocumentUploadPath(
  deploymentId: string,
  document: Readonly<{document: 'style'; theme: string}> | Readonly<{document: 'family'}>,
): string {
  const base = `/v1/styles/deployments/${encodeURIComponent(deploymentId)}/native`;
  return document.document === 'family'
    ? `${base}/family.json`
    : `${base}/styles/${encodeURIComponent(document.theme)}.json`;
}

/** The answer to one uploaded native document (HTTP 200). */
export const tileflowNativeDocumentReceiptSchema = z
  .object({
    kind: z.literal('tileflow-native-document-receipt'),
    schemaVersion: z.literal(1),
    deploymentId: reservedDeploymentIdSchema,
    version: positive,
    document: z.enum(['style', 'family']),
    theme: tileflowThemeNameSchema.optional(),
    ...nativeDocumentShape,
  })
  .strict()
  .refine(
    (value) => (value.document === 'style') === (value.theme !== undefined),
    'A style receipt names its theme; a family receipt names none',
  );
export type TileflowNativeDocumentReceipt = z.infer<typeof tileflowNativeDocumentReceiptSchema>;
