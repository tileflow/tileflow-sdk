import {readFileSync} from 'node:fs';

export function isRootCliVersionRequest(arguments_: readonly string[]): boolean {
  return arguments_.length === 1 && (arguments_[0] === '--version' || arguments_[0] === '-V');
}

export function getCliVersion(): string {
  const document = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {version: string};
  return document.version;
}
