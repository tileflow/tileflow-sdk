// Gives the listed processes `percent` of the wall clock by stopping and resuming them.
// Runs apart from the harness so that its sampling cannot stretch the cycle. Usage:
//   node duty-cycle.mjs <percent> <pid>...
const [percentText, ...pidTexts] = process.argv.slice(2);
const pids = pidTexts.map(Number);
const periodMs = 100;
const stoppedMs = periodMs * (1 - Number(percentText) / 100);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function signal(name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      // The process has exited.
    }
  }
}

let totalStopped = 0;
const started = performance.now();
process.on('SIGTERM', () => {
  signal('SIGCONT');
  const elapsed = performance.now() - started;
  console.log(
    JSON.stringify({achievedRunningPercent: 100 * (1 - totalStopped / elapsed), elapsed}),
  );
  process.exit(0);
});

for (;;) {
  const stoppedAt = performance.now();
  signal('SIGSTOP');
  await sleep(stoppedMs);
  signal('SIGCONT');
  const resumedAt = performance.now();
  totalStopped += resumedAt - stoppedAt;
  const cycleLeft = periodMs - (performance.now() - stoppedAt);
  await sleep(Math.max(1, cycleLeft));
}
