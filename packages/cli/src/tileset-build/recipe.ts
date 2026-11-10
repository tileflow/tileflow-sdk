import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {serializeCanonicalJson} from '@tileflow/core';
import {isInlineCrs, portableCrs} from './crs';
import {TilesetBuildError} from './errors';

export type TilesetBuildFormat =
  'csv' | 'geojson' | 'geojsonseq' | 'geopackage' | 'gpx' | 'kml' | 'shapefile';

export const tilesetRecipeSchemaUrl = 'https://tileflow.dev/schemas/tileset-recipe/v1.json';
export const maximumZoom = 16;
export const layerNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const maximumRecipeBytes = 1024 * 1024;

const nonEmpty = z.string().min(1);
const zoom = z.number().int().min(0).max(maximumZoom);
const entryName = z.string().regex(layerNamePattern);

const sourceSchema = z.strictObject({
  crs: z
    .strictObject({
      from: nonEmpty
        .refine(isInlineCrs, {
          message: 'must be EPSG:<code>, a proj string or WKT; a recipe cannot name a file',
        })
        .optional(),
      reproject: z.boolean().optional(),
    })
    .optional(),
  csv: z.strictObject({lat: nonEmpty.optional(), lon: nonEmpty.optional()}).optional(),
  format: z
    .enum(['csv', 'geojson', 'geojsonseq', 'geopackage', 'gpx', 'kml', 'shapefile'])
    .optional(),
  layer: nonEmpty.optional(),
  zipEntry: nonEmpty.optional(),
});

const layerSchema = z.strictObject({
  featureId: z.strictObject({field: nonEmpty, hash: z.boolean().optional()}).optional(),
  fields: z
    .strictObject({exclude: z.array(nonEmpty).optional(), include: z.array(nonEmpty).optional()})
    .refine((fields) => !(fields.exclude && fields.include), {
      message: 'include and exclude cannot be combined',
    })
    .optional(),
  maxzoom: z.union([z.literal('auto'), zoom]).optional(),
  minzoom: zoom.optional(),
  rank: z
    .strictObject({by: nonEmpty, order: z.enum(['ascending', 'descending']).optional()})
    .optional(),
  source: nonEmpty,
});

const recipeObject = z.strictObject({
  $schema: z.string().optional(),
  layers: z.record(entryName, layerSchema),
  metadata: z
    .strictObject({
      attribution: nonEmpty.optional(),
      description: nonEmpty.optional(),
      name: nonEmpty.optional(),
    })
    .optional(),
  sources: z.record(entryName, sourceSchema),
  version: z.literal(1),
});

const recipeSchema = recipeObject.superRefine((recipe, context) => {
  // Maps from the start, so that several sources and layers only lift this check later.
  for (const key of ['sources', 'layers'] as const) {
    if (Object.keys(recipe[key]).length !== 1) {
      context.addIssue({code: 'custom', message: 'needs exactly one entry', path: [key]});
    }
  }
  for (const [name, layer] of Object.entries(recipe.layers)) {
    if (!Object.hasOwn(recipe.sources, layer.source)) {
      context.addIssue({
        code: 'custom',
        message: `names no source in "sources"`,
        path: ['layers', name, 'source'],
      });
    }
    if (typeof layer.maxzoom === 'number' && layer.maxzoom < (layer.minzoom ?? 0)) {
      context.addIssue({
        code: 'custom',
        message: 'is below minzoom',
        path: ['layers', name, 'maxzoom'],
      });
    }
  }
});

export type TilesetRecipe = z.infer<typeof recipeObject>;

/** The build settings a recipe carries. Command-line flags are a shorthand for the same values. */
export type RecipeSettings = Readonly<{
  attribution?: string;
  description?: string;
  exclude?: readonly string[];
  featureId?: Readonly<{field: string; hash?: boolean}>;
  format?: TilesetBuildFormat;
  include?: readonly string[];
  inputLayer?: string;
  latColumn?: string;
  layer?: string;
  lonColumn?: string;
  maxzoom?: number;
  minzoom?: number;
  name?: string;
  rankAscending?: boolean;
  rankBy?: string;
  reproject?: boolean;
  sourceCrs?: string;
  zipEntry?: string;
}>;

const present = <Value>(key: string, value: Value | undefined) =>
  value === undefined ? {} : {[key]: value};

/** Write settings as a recipe. A `.prj` path becomes its contents, so the recipe can travel. */
export function recipeFromSettings(settings: RecipeSettings, layer: string): TilesetRecipe {
  const csv = {...present('lat', settings.latColumn), ...present('lon', settings.lonColumn)};
  const crs = {
    ...(settings.sourceCrs === undefined ? {} : {from: portableCrs(settings.sourceCrs)}),
    ...(settings.reproject ? {reproject: true} : {}),
  };
  const fields = {...present('exclude', settings.exclude), ...present('include', settings.include)};
  const metadata = {
    ...present('attribution', settings.attribution),
    ...present('description', settings.description),
    ...present('name', settings.name),
  };
  return {
    $schema: tilesetRecipeSchemaUrl,
    layers: {
      [layer]: {
        ...present('featureId', settings.featureId),
        ...(Object.keys(fields).length > 0 ? {fields} : {}),
        maxzoom: settings.maxzoom ?? 'auto',
        minzoom: settings.minzoom ?? 0,
        ...(settings.rankBy === undefined
          ? {}
          : {
              rank: {
                by: settings.rankBy,
                order: settings.rankAscending ? 'ascending' : 'descending',
              },
            }),
        source: layer,
      },
    },
    ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
    sources: {
      [layer]: {
        ...(Object.keys(crs).length > 0 ? {crs} : {}),
        ...(Object.keys(csv).length > 0 ? {csv} : {}),
        ...present('format', settings.format),
        ...present('layer', settings.inputLayer),
        ...present('zipEntry', settings.zipEntry),
      },
    },
    version: 1,
  } as TilesetRecipe;
}

export function settingsFromRecipe(recipe: TilesetRecipe): RecipeSettings {
  const [layerName, layer] = Object.entries(recipe.layers)[0];
  const source = recipe.sources[layer.source];
  return {
    ...present('attribution', recipe.metadata?.attribution),
    ...present('description', recipe.metadata?.description),
    ...present('exclude', layer.fields?.exclude),
    ...present('featureId', layer.featureId),
    ...present('format', source.format),
    ...present('include', layer.fields?.include),
    ...present('inputLayer', source.layer),
    ...present('latColumn', source.csv?.lat),
    layer: layerName,
    ...present('lonColumn', source.csv?.lon),
    ...(typeof layer.maxzoom === 'number' ? {maxzoom: layer.maxzoom} : {}),
    ...present('minzoom', layer.minzoom),
    ...present('name', recipe.metadata?.name),
    ...(layer.rank?.order === 'ascending' ? {rankAscending: true} : {}),
    ...present('rankBy', layer.rank?.by),
    ...(source.crs?.reproject ? {reproject: true} : {}),
    ...present('sourceCrs', source.crs?.from),
    ...present('zipEntry', source.zipEntry),
  };
}

export function parseTilesetRecipe(text: string): TilesetRecipe {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_RECIPE_INVALID',
      'recipe',
      'The recipe is not valid JSON.',
    );
  }
  const parsed = recipeSchema.safeParse(document);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const location = issue.path.join('.');
  throw new TilesetBuildError(
    'TF_TILESET_BUILD_RECIPE_INVALID',
    location ? `recipe.${location}` : 'recipe',
    `Invalid recipe${location ? ` at ${location}` : ''}: ${issue.message}.`,
  );
}

export function readTilesetRecipe(path: string): TilesetRecipe {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_RECIPE_UNREADABLE',
      'recipe',
      `Could not read the recipe ${path}.`,
    );
  }
  if (bytes.length > maximumRecipeBytes) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_RECIPE_INVALID',
      'recipe',
      `The recipe is larger than ${maximumRecipeBytes} bytes.`,
    );
  }
  return parseTilesetRecipe(bytes.toString('utf8'));
}

export function tilesetRecipeJsonSchema(): Record<string, unknown> {
  return {
    $id: tilesetRecipeSchemaUrl,
    ...z.toJSONSchema(recipeObject, {target: 'draft-2020-12'}),
  };
}

export function recipeHash(recipe: TilesetRecipe): string {
  return `sha256:${createHash('sha256').update(serializeCanonicalJson(recipe)).digest('hex')}`;
}
