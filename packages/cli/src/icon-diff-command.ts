import type {Command} from 'commander';
import {resolve} from 'node:path';
import {z} from 'zod';
import {
  diffTileflowIconMappings,
  diffTileflowIconPackageManifests,
  hashTileflowIconPackageManifest,
  inspectTileflowIconReferences,
  resolveTileflowIconMapping,
  tileflowHostedIconIdSchema,
  tileflowIconPackageContentHashSchema,
  tileflowIconPackageLabelSchema,
  tileflowIconPackageLimits,
  tileflowIconPackageManifestSchema,
  validateConfig,
} from '@tileflow/core';
import {
  type CompiledTileflowIconPackage,
  compileTileflowIconPackages,
  getTileflowMapNames,
  loadTileflowConfig,
} from '@tileflow/dev';
import {writeIconDiffReport} from './icon-diff-report';

const environmentSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/);
const mappingSchema = z
  .record(z.string().min(1).max(256), tileflowHostedIconIdSchema)
  .refine((mapping) => Object.keys(mapping).length <= tileflowIconPackageLimits.maxIconCount);
const publicHttpUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    );
  });

export const iconPackageBaselineResponseSchema = z
  .object({
    baseline: z
      .object({
        deployedAt: z.iso.datetime({offset: true}),
        deploymentId: z.string().min(1).max(128),
        mapping: mappingSchema.nullable(),
        mappingAvailable: z.boolean(),
        package: z
          .object({
            contentHash: tileflowIconPackageContentHashSchema,
            label: tileflowIconPackageLabelSchema,
            manifest: tileflowIconPackageManifestSchema,
            spriteUrl: publicHttpUrlSchema,
            totalBytes: z
              .number()
              .int()
              .positive()
              .max(tileflowIconPackageLimits.maxGeneratedPackageBytes),
          })
          .strict()
          .nullable(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    environment: environmentSchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.baseline &&
      response.baseline.mappingAvailable !== (response.baseline.mapping !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'mapping state is inconsistent',
        path: ['baseline', 'mapping'],
      });
    }
  });

const packageSummarySchema = z
  .object({
    contentHash: tileflowIconPackageContentHashSchema,
    iconCount: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxIconCount),
    label: tileflowIconPackageLabelSchema,
    totalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(tileflowIconPackageLimits.maxGeneratedPackageBytes),
  })
  .strict();
const mappingChangeSchema = z
  .object({
    after: z.string().optional(),
    before: z.string().optional(),
    key: z.string(),
  })
  .strict();

export const tileflowIconDiffDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    environment: environmentSchema,
    baseline: z
      .object({
        deploymentId: z.string(),
        package: packageSummarySchema.nullable(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    proposed: z
      .object({
        package: packageSummarySchema.nullable(),
      })
      .strict(),
    icons: z
      .object({
        added: z.array(z.string()),
        removed: z.array(z.string()),
        modified: z.array(z.string()),
        unchangedCount: z.number().int().nonnegative(),
      })
      .strict(),
    mapping: z
      .object({
        comparisonAvailable: z.boolean(),
        added: z.array(mappingChangeSchema),
        removed: z.array(mappingChangeSchema),
        changed: z.array(mappingChangeSchema),
      })
      .strict(),
    generatedBytes: z
      .object({
        before: z.number().int().nonnegative(),
        after: z.number().int().nonnegative(),
        delta: z.number().int(),
      })
      .strict(),
    references: z
      .object({
        analysisComplete: z.boolean(),
        dangling: z.array(
          z
            .object({
              iconName: z.string(),
              kind: z.enum(['mapping', 'style-override-literal']),
              path: z.string(),
            })
            .strict(),
        ),
        unanalyzable: z.array(
          z
            .object({
              kind: z.literal('style-override-expression'),
              path: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    artifacts: z.object({report: z.string().nullable()}).strict(),
    hasChanges: z.boolean(),
  })
  .strict();

export type TileflowIconDiffDocument = z.infer<typeof tileflowIconDiffDocumentSchema>;
export type IconPackageBaselineResponse = z.infer<typeof iconPackageBaselineResponseSchema>;

type IconDiffOptions = {
  against: string;
  apiKey?: string;
  apiUrl?: string;
  config: string;
  failOn?: string;
  force?: boolean;
  json?: boolean;
  open?: boolean;
  project?: string;
  report?: string;
};

export function registerIconDiffCommand(
  icons: Command,
  dependencies: {
    defaultApiUrl: string;
    defaultConfigPath: string;
    openReport: (path: string) => void;
    resolveApi: (options: {
      against: string;
      apiKey?: string;
      apiUrl?: string;
      config?: string;
      project?: string;
    }) => Promise<{apiKey: string; apiUrl: string} | null>;
  },
): void {
  icons
    .command('diff')
    .description('Preview a local icon package against an active hosted revision')
    .requiredOption('--against <environment>', 'named map environment to compare')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
    .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
    .option('--project <target>', 'target @organization/project')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--report <path>', 'write a self-contained HTML visual report')
    .option('--open', 'open an explicitly requested report')
    .option('--force', 'replace a different explicitly requested report')
    .option('--fail-on <policy>', 'policy failure: dangling')
    .action(async (options: IconDiffOptions) => {
      try {
        await runIconDiff(options, dependencies);
      } catch (error) {
        if (!options.json) {
          throw error;
        }

        console.error(error instanceof Error ? error.message : 'Icon diff failed');
        process.exitCode = 1;
      }
    });
}

async function runIconDiff(
  options: IconDiffOptions,
  dependencies: {
    openReport: (path: string) => void;
    resolveApi: (options: {
      against: string;
      apiKey?: string;
      apiUrl?: string;
      config?: string;
      project?: string;
    }) => Promise<{apiKey: string; apiUrl: string} | null>;
  },
): Promise<void> {
  if (options.open && !options.report) {
    throw new Error('--open requires --report <path>');
  }

  if (options.force && !options.report) {
    throw new Error('--force requires --report <path>');
  }

  if (options.failOn && options.failOn !== 'dangling') {
    throw new Error('--fail-on accepts only "dangling"');
  }

  const environment = environmentSchema.parse(options.against);
  const api = await dependencies.resolveApi(options);

  if (!api) {
    throw new Error('Missing Tileflow API key. Run tileflow login or set TILEFLOW_API_KEY.');
  }

  delete process.env.TILEFLOW_API_KEY;
  const project = await loadTileflowConfig(options.config);
  const validation = validateConfig(project);

  if (!validation.valid) {
    throw new Error(
      `Tileflow config is invalid: ${validation.messages.map((message) => `${message.path}: ${message.message}`).join('; ')}`,
    );
  }

  const mapNames = getTileflowMapNames(project);

  if (!Object.hasOwn(project.maps, environment)) {
    throw new Error(
      `Unknown map environment "${environment}". Available maps: ${mapNames.join(', ') || '(none)'}`,
    );
  }

  const selectedProject = {...project, maps: {[environment]: project.maps[environment]}};
  const compiled = await compileTileflowIconPackages(selectedProject, {
    cwd: process.cwd(),
    target: 'hosted',
  });
  const binding = compiled.bindings.find((candidate) => candidate.mapName === environment);
  const proposedPackage = binding
    ? (compiled.packages.find((candidate) => candidate.contentHash === binding.packageHash) ?? null)
    : null;
  const proposedMapping = resolveTileflowIconMapping(selectedProject, environment);
  const references = inspectTileflowIconReferences(
    selectedProject,
    environment,
    proposedPackage?.manifest.iconNames ?? [],
  );
  const baseline = await readBaseline(api, environment);
  const beforeManifest = baseline.baseline?.package?.manifest ?? null;
  const iconDiff = diffTileflowIconPackageManifests(
    beforeManifest,
    proposedPackage?.manifest ?? null,
  );
  const mappingAvailable = baseline.baseline === null || baseline.baseline.mappingAvailable;
  const beforeMapping = baseline.baseline === null ? {} : baseline.baseline.mapping;
  const mappingDiff = mappingAvailable
    ? diffTileflowIconMappings(beforeMapping ?? {}, proposedMapping)
    : {added: [], changed: [], removed: []};
  const packageChanged =
    (baseline.baseline?.package?.contentHash ?? null) !== (proposedPackage?.contentHash ?? null);
  const mappingChanged =
    mappingAvailable &&
    (mappingDiff.added.length > 0 ||
      mappingDiff.changed.length > 0 ||
      mappingDiff.removed.length > 0);
  const reportPath = options.report ? resolve(process.cwd(), options.report) : null;
  const document = tileflowIconDiffDocumentSchema.parse({
    schemaVersion: 1,
    environment,
    baseline: baseline.baseline
      ? {
          deploymentId: baseline.baseline.deploymentId,
          package: baseline.baseline.package
            ? packageSummary(baseline.baseline.package, baseline.baseline.package.label)
            : null,
          version: baseline.baseline.version,
        }
      : null,
    proposed: {
      package: proposedPackage ? packageSummary(proposedPackage, binding?.label ?? 'Icons') : null,
    },
    icons: {
      added: iconDiff.added,
      removed: iconDiff.removed,
      modified: iconDiff.modified,
      unchangedCount: iconDiff.unchangedCount,
    },
    mapping: {
      comparisonAvailable: mappingAvailable,
      added: mappingDiff.added,
      removed: mappingDiff.removed,
      changed: mappingDiff.changed,
    },
    generatedBytes: {
      before: iconDiff.beforeBytes,
      after: iconDiff.afterBytes,
      delta: iconDiff.afterBytes - iconDiff.beforeBytes,
    },
    references,
    artifacts: {report: reportPath},
    hasChanges: packageChanged || mappingChanged,
  });

  if (reportPath) {
    await writeIconDiffReport({
      baseline: baseline.baseline,
      document,
      force: options.force === true,
      mapName: environment,
      outputPath: reportPath,
      proposedPackage,
    });

    if (options.open) {
      dependencies.openReport(reportPath);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  } else {
    printHumanDiff(document);
  }

  process.exitCode =
    options.failOn === 'dangling' && document.references.dangling.length > 0 ? 2 : 0;
}

async function readBaseline(
  api: {apiKey: string; apiUrl: string},
  environment: string,
): Promise<IconPackageBaselineResponse> {
  const response = await fetch(
    `${api.apiUrl}/v1/icon-packages/baseline/${encodeURIComponent(environment)}`,
    {headers: {Authorization: `Bearer ${api.apiKey}`}},
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000);
    throw new Error(`Icon diff baseline failed: ${response.status} ${body}`);
  }

  let value: unknown;

  try {
    value = await response.json();
  } catch {
    throw new Error('Icon diff baseline returned invalid JSON');
  }

  const parsed = iconPackageBaselineResponseSchema.safeParse(value);

  if (!parsed.success || parsed.data.environment !== environment) {
    throw new Error('Icon diff baseline response does not match the required schema');
  }

  const remotePackage = parsed.data.baseline?.package;

  if (remotePackage) {
    const totalBytes = remotePackage.manifest.files.reduce(
      (total, file) => total + file.byteLength,
      0,
    );

    if (
      totalBytes !== remotePackage.totalBytes ||
      (await hashTileflowIconPackageManifest(remotePackage.manifest)) !== remotePackage.contentHash
    ) {
      throw new Error('Icon diff baseline package metadata is inconsistent');
    }
  }

  return parsed.data;
}

function packageSummary(
  iconPackage:
    | CompiledTileflowIconPackage
    | NonNullable<NonNullable<IconPackageBaselineResponse['baseline']>['package']>,
  label: string,
) {
  const manifest = iconPackage.manifest;
  return {
    contentHash: iconPackage.contentHash,
    iconCount: manifest.iconNames.length,
    label,
    totalBytes: manifest.files.reduce((total, file) => total + file.byteLength, 0),
  };
}

function printHumanDiff(document: TileflowIconDiffDocument): void {
  const proposedLabel = document.proposed.package?.label ?? 'No managed package';
  console.log(`Icon package: ${proposedLabel}`);
  console.log(
    `Against: ${document.environment}${document.baseline ? ` v${document.baseline.version}` : ' (Initial)'}`,
  );
  console.log(
    `Package: ${shortHash(document.baseline?.package?.contentHash)} -> ${shortHash(document.proposed.package?.contentHash)}`,
  );
  console.log('\nIcons');
  printNames('+', document.icons.added);
  printNames('~', document.icons.modified);
  printNames('-', document.icons.removed);

  if (
    document.icons.added.length === 0 &&
    document.icons.modified.length === 0 &&
    document.icons.removed.length === 0
  ) {
    console.log('  No visual icon changes');
  }

  console.log('\nMapping');
  if (!document.mapping.comparisonAvailable) {
    console.log('  Comparison unavailable');
  } else {
    for (const change of document.mapping.added) {
      console.log(`+ ${change.key}: ${change.after}`);
    }
    for (const change of document.mapping.changed) {
      console.log(`~ ${change.key}: ${change.before} -> ${change.after}`);
    }
    for (const change of document.mapping.removed) {
      console.log(`- ${change.key}: ${change.before}`);
    }
    if (
      document.mapping.added.length === 0 &&
      document.mapping.changed.length === 0 &&
      document.mapping.removed.length === 0
    ) {
      console.log('  No mapping changes');
    }
  }

  console.log(
    `\nGenerated size: ${formatBytes(document.generatedBytes.before)} -> ${formatBytes(document.generatedBytes.after)} (${formatSignedBytes(document.generatedBytes.delta)})`,
  );
  for (const warning of document.references.dangling) {
    console.log(`Warning: "${warning.iconName}" is still referenced by ${warning.path}`);
  }
  for (const warning of document.references.unanalyzable) {
    console.log(`Warning: dynamic icon expression could not be analyzed at ${warning.path}`);
  }
  if (!document.hasChanges) {
    console.log('\nNo managed icon-package or mapping differences.');
  }
  if (document.artifacts.report) {
    console.log(`\nReport: ${document.artifacts.report}`);
  }
}

function printNames(marker: string, names: readonly string[]): void {
  for (const name of names) {
    console.log(`${marker} ${name}`);
  }
}

function shortHash(value: string | undefined): string {
  return value ? value.slice(0, 12) : 'none';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatSignedBytes(bytes: number): string {
  const sign = bytes > 0 ? '+' : bytes < 0 ? '-' : '';
  return `${sign}${formatBytes(Math.abs(bytes))}`;
}
