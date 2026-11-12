import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';

/**
 * Text from data files and child processes reaches the runner through these helpers only. Escaping
 * keeps a crafted attribute name or error message from issuing its own workflow command.
 */
export function escapeCommandData(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function annotate(level, message, log = console.log) {
  log(`::${level}::${escapeCommandData(message)}`);
}

export function maskSecret(secret, log = console.log) {
  for (const line of secret.split(/\r?\n/u)) {
    if (line) log(`::add-mask::${escapeCommandData(line)}`);
  }
}

export function redact(text, secret) {
  return secret ? text.split(secret).join('***') : text;
}

export async function setOutputs(env, values) {
  if (!env.GITHUB_OUTPUT) return;
  const entries = Object.entries(values).map(([name, value]) => {
    const delimiter = `tileflow_${randomUUID()}`;
    return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  });
  await appendFile(env.GITHUB_OUTPUT, entries.join(''));
}

export async function appendSummary(env, text) {
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

export function parseBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false, but it is "${value}".`);
}
