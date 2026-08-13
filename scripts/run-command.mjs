import {spawn} from 'node:child_process';

export function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', rejectRun);
    // `close` runs after the stdio pipes close; `exit` can precede the final stdout chunks.
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun({stdout, stderr});
        return;
      }
      rejectRun(
        new Error(
          `${options.label ?? command} failed${signal ? ` after ${signal}` : ` with exit ${code}`}\n${stderr || stdout}`,
        ),
      );
    });
  });
}
