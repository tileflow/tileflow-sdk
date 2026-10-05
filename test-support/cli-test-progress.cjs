const {channel} = require('node:diagnostics_channel');
const {basename} = require('node:path');

if (process.env.TILEFLOW_CLI_TEST_PROGRESS === '1' && !process.env.NODE_TEST_CONTEXT) {
  let remaining = 128;

  const report = (phase, file, pid, code) => {
    if (remaining-- <= 0) return;
    process.stderr.write(
      `[cli-test] ${JSON.stringify({phase, file, pid, ...(code === undefined ? {} : {code})})}\n`,
    );
  };

  channel('child_process').subscribe(({process: child}) => {
    child.once('spawn', () => {
      if (child.spawnargs.includes('--test')) return;

      const files = child.spawnargs
        .map((argument) => basename(argument.replaceAll('\\', '/')))
        .filter((argument) => /^[a-z][a-z0-9-]{0,79}\.test\.(?:ts|mjs)$/u.test(argument));
      if (files.length !== 1) return;

      report('start', files[0], child.pid);
      child.once('close', (code) => report('close', files[0], child.pid, code));
    });
  });
}
