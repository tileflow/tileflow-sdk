#!/usr/bin/env node
// Summarizes a results directory from scripts/run-matrix.sh: a compact JSON without the raw
// answers (--json) or Markdown tables (default).
//   node bench/summarize.mjs <results dir> [--json]
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const dir = process.argv[2];
const asJson = process.argv.includes('--json');
const runs = readdirSync(dir)
  .filter((f) => /^(ios|android)-.+\.json$/u.test(f))
  .map((f) => {
    const [, platform, rest] = f.match(/^(ios|android)-(.+)\.json$/u);
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return {
      file: f,
      platform,
      plan: rest,
      loadLibraryMs: r.loadLibraryMs ?? null,
      createMs: r.createMs,
      memoryAtStart: r.memoryAtStart,
      memoryAfterCreate: r.memoryAfterCreate,
      memoryAfterDestroy: r.memoryAfterDestroy,
      cases: r.cases.map(({raw, answer, ...c}) => c),
    };
  });

if (asJson) {
  process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
} else {
  const round = (v) => (v < 0 ? '–' : Math.round(v));
  for (const run of runs) {
    const peak = Math.max(...run.cases.map((c) => c.memoryAfter.peakMb));
    const current = Math.max(...run.cases.map((c) => c.memoryAfter.currentMb));
    console.log(
      `\n${run.platform} ${run.plan}: create ${round(run.createMs)} ms` +
        (run.loadLibraryMs ? `, loadLibrary ${round(run.loadLibraryMs)} ms` : '') +
        `, memory start ${round(run.memoryAtStart.currentMb)} MB, max ${round(current)} MB, peak ${round(peak)} MB`,
    );
    console.log('| case | km | first ms | warm ms | warm CPU ms | memory MB |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const c of run.cases)
      console.log(
        `| ${c.id} | ${c.lengthKm} | ${round(c.firstMs)} | ${round(c.warmMedianMs)} | ${round(c.warmMedianCpuMs)} | ${round(c.memoryAfter.currentMb)} |`,
      );
  }
}
