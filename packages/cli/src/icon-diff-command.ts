import type {Command} from 'commander';
import {dirname, resolve} from 'node:path';
import {z} from 'zod';
import {
  diffTileflowIconPackageManifests,
  hashTileflowIconPackageManifest,
  tileflowIconPackageContentHashSchema,
  tileflowIconPackageLabelSchema,
  tileflowIconPackageLimits,
  tileflowIconPackageManifestSchema,
  tileflowMapIdSchema,
} from '@tileflow/core';
import {
  assertValidTileflowConfig,
  getTileflowMapNames,
  loadTileflowConfigWithInputs,
} from '@tileflow/dev/config';
import {type CompiledTileflowIconPackage, compileTileflowIconPackages} from '@tileflow/dev/icons';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {requestHostedJson} from './hosted-client';
import {writeIconDiffReport} from './icon-diff-report';

const environmentSchema = tileflowMapIdSchema;
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
  .strict();

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
    generatedBytes: z
      .object({
        before: z.number().int().nonnegative(),
        after: z.number().int().nonnegative(),
        delta: z.number().int(),
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
  force?: boolean;
  json?: boolean;
  mapId: string;
  open?: boolean;
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
      mapId: string;
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
    .requiredOption('--map-id <id>', 'managed Map destination')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--report <path>', 'write a self-contained HTML visual report')
    .option('--open', 'open an explicitly requested report')
    .option('--force', 'replace a different explicitly requested report')
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
      mapId: string;
    }) => Promise<{apiKey: string; apiUrl: string} | null>;
  },
): Promise<void> {
  if (options.open && !options.report) {
    throw new Error('--open requires --report <path>');
  }

  if (options.force && !options.report) {
    throw new Error('--force requires --report <path>');
  }

  const environment = environmentSchema.parse(options.against);
  const loaded = await withTileflowConfigSecretsHidden(() =>
    loadTileflowConfigWithInputs(options.config),
  );
  const project = loaded.project;
  assertValidTileflowConfig(project);

  const mapNames = getTileflowMapNames(project);

  if (!Object.hasOwn(project.maps, environment)) {
    throw new Error(
      `Unknown map environment "${environment}". Available maps: ${mapNames.join(', ') || '(none)'}`,
    );
  }

  const api = await dependencies.resolveApi(options);

  if (!api) {
    throw new Error('Missing Tileflow API key. Run tileflow login or set TILEFLOW_API_KEY.');
  }

  const selectedProject = {...project, maps: {[environment]: project.maps[environment]}};
  const compiled = await compileTileflowIconPackages(selectedProject, {
    baseDirectory: dirname(loaded.configFile),
    cwd: process.cwd(),
    target: 'hosted',
  });
  const binding = compiled.bindings.find((candidate) => candidate.mapName === environment);
  const proposedPackage = binding
    ? (compiled.packages.find((candidate) => candidate.contentHash === binding.packageHash) ?? null)
    : null;
  const baseline = await readBaseline(api, environment);
  const beforeManifest = baseline.baseline?.package?.manifest ?? null;
  const iconDiff = diffTileflowIconPackageManifests(
    beforeManifest,
    proposedPackage?.manifest ?? null,
  );
  const packageChanged =
    (baseline.baseline?.package?.contentHash ?? null) !== (proposedPackage?.contentHash ?? null);
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
    generatedBytes: {
      before: iconDiff.beforeBytes,
      after: iconDiff.afterBytes,
      delta: iconDiff.afterBytes - iconDiff.beforeBytes,
    },
    artifacts: {report: reportPath},
    hasChanges: packageChanged,
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
  process.exitCode = 0;
}

async function readBaseline(
  api: {apiKey: string; apiUrl: string},
  environment: string,
): Promise<IconPackageBaselineResponse> {
  const response = await requestHostedJson(
    api.apiUrl,
    `/v1/icon-packages/baseline/${encodeURIComponent(environment)}`,
    {headers: {Authorization: `Bearer ${api.apiKey}`}},
  );

  if (!response.ok) {
    throw new Error(`Icon diff baseline failed: ${response.status}.`);
  }
  if (!response.json) {
    throw new Error('Icon diff baseline returned invalid JSON');
  }

  const parsed = iconPackageBaselineResponseSchema.safeParse(response.body);

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

  console.log(
    `\nGenerated size: ${formatBytes(document.generatedBytes.before)} -> ${formatBytes(document.generatedBytes.after)} (${formatSignedBytes(document.generatedBytes.delta)})`,
  );
  if (!document.hasChanges) {
    console.log('\nNo icon-package differences.');
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
