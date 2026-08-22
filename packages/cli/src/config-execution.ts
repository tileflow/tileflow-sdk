export type TileflowConfigSecretScope = {
  restore: () => void;
};

/**
 * Executable Tileflow config is trusted project code, but it must never inherit
 * a hosted bearer credential from the CLI process. Keep the scope open for
 * watched commands because their config can be imported again after startup.
 */
export function hideTileflowConfigSecrets(): TileflowConfigSecretScope {
  const hadApiKey = Object.hasOwn(process.env, 'TILEFLOW_API_KEY');
  const apiKey = process.env.TILEFLOW_API_KEY;
  const argv = [...process.argv];
  let restored = false;

  delete process.env.TILEFLOW_API_KEY;
  replaceProcessArgv(stripApiKeyArguments(argv));

  return {
    restore() {
      if (restored) return;
      restored = true;

      if (hadApiKey) {
        process.env.TILEFLOW_API_KEY = apiKey;
      } else {
        delete process.env.TILEFLOW_API_KEY;
      }
      replaceProcessArgv(argv);
    },
  };
}

export async function withTileflowConfigSecretsHidden<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  const scope = hideTileflowConfigSecrets();

  try {
    return await operation();
  } finally {
    scope.restore();
  }
}

function stripApiKeyArguments(argv: readonly string[]): string[] {
  const sanitized: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === '--api-key') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--api-key=')) continue;
    sanitized.push(argument);
  }

  return sanitized;
}

function replaceProcessArgv(argv: readonly string[]): void {
  process.argv.splice(0, process.argv.length, ...argv);
}
