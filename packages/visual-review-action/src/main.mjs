const mode = process.argv[2];
const stages = {
  approve: async () => (await import('./approve.mjs')).runApprove(),
  capture: async () => (await import('./capture.mjs')).runCapture(),
  promote: async () => (await import('./promote.mjs')).runPromote(),
  report: async () => (await import('./report.mjs')).runReport(),
};

if (!Object.hasOwn(stages, mode)) {
  console.error('mode must be capture, report, approve or promote.');
  process.exit(1);
}
await stages[mode]();
