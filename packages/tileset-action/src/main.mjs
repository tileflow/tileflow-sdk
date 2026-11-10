import {annotate} from './workflow.mjs';

const stages = {
  build: async () => (await import('./build.mjs')).runBuild(),
  publish: async () => (await import('./publish.mjs')).runPublish(),
};

const stage = process.argv[2];
if (!Object.hasOwn(stages, stage)) {
  annotate('error', 'The stage must be build or publish.');
  process.exit(1);
}

try {
  await stages[stage]();
} catch (error) {
  annotate('error', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
