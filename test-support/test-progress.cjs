const {channel} = require('node:diagnostics_channel');
const {freemem} = require('node:os');
const {basename} = require('node:path');

if (process.env.TILEFLOW_TEST_PROGRESS === '1' || process.env.TILEFLOW_CLI_TEST_PROGRESS === '1') {
  let remaining = 128;
  let snapshots = 64;
  const active = new Map();
  let heartbeat;

  const report = (record) => {
    if (record.phase === 'waiting' || record.phase === 'resources') {
      if (snapshots-- <= 0) return;
    } else if (remaining-- <= 0) return;
    process.stderr.write(`[sdk-test] ${JSON.stringify(record)}\n`);
  };

  const testFiles = (args) =>
    args
      .map((argument) => basename(argument.replaceAll('\\', '/')))
      .filter((argument) => /^[a-z][a-z0-9-]{0,79}\.test\.(?:ts|mjs)$/u.test(argument));

  if (process.env.NODE_TEST_CONTEXT) {
    const files = testFiles(process.argv.slice(1, 2));

    if (files.length === 1) {
      let previousCpu = process.cpuUsage();

      setInterval(() => {
        const cpu = process.cpuUsage(previousCpu);
        previousCpu = process.cpuUsage();

        report({
          phase: 'resources',
          file: files[0],
          pid: process.pid,
          cpuMs: Math.round((cpu.user + cpu.system) / 1000),
          rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
          freeMiB: Math.round(freemem() / 1024 ** 2),
          resources: process.getActiveResourcesInfo().reduce((counts, type) => {
            counts[type] = (counts[type] ?? 0) + 1;
            return counts;
          }, {}),
        });
      }, 30_000).unref();
    }
  } else {
    channel('child_process').subscribe(({process: child}) => {
      child.once('spawn', () => {
        if (child.spawnargs.includes('--test')) return;

        const files = testFiles(child.spawnargs);
        if (files.length !== 1) return;

        const record = {file: files[0], pid: child.pid};
        const now = Date.now();
        const state = {...record, started: now, output: now};
        active.set(child, state);
        const onOutput = () => (state.output = Date.now());
        child.stdout?.on('data', onOutput);
        child.stderr?.on('data', onOutput);
        report({phase: 'start', ...record});

        heartbeat ??= setInterval(() => {
          if (!active.size) return;

          report({
            phase: 'waiting',
            active: [...active.values()].map(({file, pid, started, output}) => ({
              file,
              pid,
              elapsedMs: Date.now() - started,
              silentMs: Date.now() - output,
            })),
          });
        }, 30_000).unref();

        child.once('close', (code) => {
          active.delete(child);
          child.stdout?.removeListener('data', onOutput);
          child.stderr?.removeListener('data', onOutput);
          report({phase: 'close', ...record, code});
        });
      });
    });
  }
}
