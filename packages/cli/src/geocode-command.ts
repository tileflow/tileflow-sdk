import type {Command} from 'commander';
import {createInterface} from 'node:readline/promises';
import type {GeocodeCsvOptions} from './geocode-batch';
import {hostedApiKeyOption, hostedApiUrlOption} from './hosted-options';

export function registerGeocodeCommand(program: Command) {
  program
    .command('geocode <file.csv>')
    .description('Geocode a CSV into a local GeoJSON layer with persistent Search')
    .option('-o, --output <path>', 'output GeoJSON file (default: the input name with .geojson)')
    .option('--address-columns <names...>', 'ordered CSV address columns', ['address'])
    .option('--concurrency <count>', 'maximum concurrent requests (1–8)', '2')
    .option(
      '--retry-unconfirmed',
      'resubmit requests with uncertain usage, which may incur a second charge',
    )
    .option('--yes', 'accept the estimated usage without prompting')
    .addOption(hostedApiKeyOption('Team credential with geocoding:read'))
    .addOption(hostedApiUrlOption())
    .action(async (input: string, options: GeocodeCsvOptions) => {
      const {geocodeCsv} = await import('./geocode-batch');
      const output = await geocodeCsv(input, options, {
        log: (message) => process.stderr.write(message + '\n'),
        confirm: async () => {
          if (!process.stdin.isTTY || !process.stderr.isTTY)
            throw new Error('Pass --yes to accept the estimate in a non-interactive run.');
          const prompt = createInterface({input: process.stdin, output: process.stderr});
          try {
            return /^y(?:es)?$/iu.test((await prompt.question('Continue? [y/N] ')).trim());
          } finally {
            prompt.close();
          }
        },
      });
      process.stdout.write(output + '\n');
    });
}
