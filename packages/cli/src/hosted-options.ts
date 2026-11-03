import {Option} from 'commander';

// Commander resolves explicit arguments before environment values. Using env(), rather than a
// default value, also keeps credentials out of help output.
export function hostedApiKeyOption(description = 'Tileflow API key') {
  return new Option('--api-key <key>', description).env('TILEFLOW_API_KEY');
}

export function hostedApiUrlOption() {
  return new Option('--api-url <url>', 'Tileflow API URL').env('TILEFLOW_API_URL');
}

export function isHostedApiKey(value: string) {
  return /^tf_live_[0-9a-f]{48}$/u.test(value);
}

export function allowsStoredAccountSession(env: NodeJS.ProcessEnv = process.env) {
  return !env.CI && env.GITHUB_ACTIONS !== 'true' && env.GITLAB_CI !== 'true';
}
