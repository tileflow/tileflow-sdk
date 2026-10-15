import type {Command} from 'commander';
import {resolve} from 'node:path';
import {
  compareTileflowCapturesForReview,
  createTileflowVisualReviewDocument,
} from '@tileflow/capture';
import {serializeTileflowCommandDocument} from '@tileflow/dev/validation';
import {printCaptureError} from './capture-command';
import {writeAtomicFile} from './capture-output';
import {captureRecordDirectory, readCaptureRecord} from './capture-record';
import {parseTileflowVisualRegion} from './visual-compare-command';

export function registerCaptureRecordComparison(compare: Command): void {
  compare
    .description('Compare saved captures, configs, styles, references or approved baselines')
    .enablePositionalOptions()
    .option('--before <id>', 'saved capture ID before the edit')
    .option('--after <id>', 'saved capture ID after the edit')
    .option('--capture-dir <path>', 'saved capture record directory', captureRecordDirectory)
    .option('--region <x,y,width,height>', 'physical-pixel region for appearance metrics')
    .option('--diff <path>', 'write a contextual PNG diff when captures are comparable')
    .option('--json', 'print deterministic JSON; never loads a config or browser')
    .action(
      async (options: {
        before?: string;
        after?: string;
        captureDir: string;
        region?: string;
        diff?: string;
        json?: boolean;
      }) => {
        try {
          if (!options.before || !options.after)
            throw new Error('Use --before and --after capture IDs, or a compare subcommand.');
          const directory = resolve(options.captureDir);
          const [before, after] = await Promise.all([
            readCaptureRecord(options.before, directory),
            readCaptureRecord(options.after, directory),
          ]);
          const comparison = await compareTileflowCapturesForReview(before, after, {
            includeDiff: Boolean(options.diff),
            ...(options.region ? {region: parseTileflowVisualRegion(options.region)} : {}),
          });
          if (comparison.diffPng && options.diff)
            await writeAtomicFile({
              boundaryPath: process.cwd(),
              path: resolve(options.diff),
              source: comparison.diffPng,
              managed: false,
              force: false,
              label: 'Capture comparison diff',
            });
          const document = {
            schemaVersion: 1,
            command: 'compare',
            before: options.before,
            after: options.after,
            reused: true,
            review: createTileflowVisualReviewDocument(comparison),
            diffPath: comparison.diffPng && options.diff ? options.diff : null,
          };
          if (options.json) process.stdout.write(serializeTileflowCommandDocument(document));
          else
            console.log(
              `Saved captures: ${comparison.status}. Changed pixels: ${comparison.exact?.changedPixels ?? 'unavailable'}.`,
            );
          if (comparison.status !== 'comparable') process.exitCode = 1;
        } catch (error) {
          printCaptureError(error, {command: 'compare', json: options.json});
          process.exitCode = 1;
        }
      },
    );
}
