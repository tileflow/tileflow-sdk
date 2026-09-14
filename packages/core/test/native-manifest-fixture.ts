import type {TileflowNativeManifestAcquire, TileflowNativeManifestResponse} from '../src/native';

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

export const manifestUrl = 'https://maps.example.test/native/manifest.json';
export const source = {kind: 'tileflow' as const, map: 'streets', manifestUrl};

export function manifest() {
  return {
    version: 1,
    maps: {
      streets: {
        defaultTheme: 'light',
        systemThemes: {dark: 'dark', light: 'light'},
        view: {center: [-3.7, 40.4], pitch: 40, bearing: 12, zoom: 10},
        themes: {
          dark: {colorScheme: 'dark', styleUrl: './styles/streets/dark.json', revision: 'dark-v1'},
          light: {
            colorScheme: 'light',
            styleUrl: './styles/streets/light.json',
            revision: 'light-v1',
          },
        },
      },
    },
  };
}

export function bytes(value: unknown = manifest()): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function transport(input = bytes(), url = manifestUrl, status = 200) {
  let offset = 0;
  let operationCancels = 0;
  let readerCancels = 0;
  let calls = 0;
  const reads: number[] = [];
  const requests: Array<{url: string; maximumBytes: number}> = [];
  const response: TileflowNativeManifestResponse = {
    url,
    status,
    reader: {
      async read(maximumBytes) {
        reads.push(maximumBytes);
        if (offset === input.byteLength) return {done: true};
        const chunk = input.slice(offset, offset + maximumBytes);
        offset += chunk.byteLength;
        return {done: false, value: chunk};
      },
      cancel() {
        readerCancels++;
      },
    },
  };
  const acquire: TileflowNativeManifestAcquire = (url, options) => {
    calls++;
    requests.push({url, maximumBytes: options.maximumBytes});
    return {
      response: Promise.resolve(response),
      cancel() {
        operationCancels++;
      },
    };
  };
  return {
    acquire,
    response,
    reads,
    requests,
    get calls() {
      return calls;
    },
    get operationCancels() {
      return operationCancels;
    },
    get readerCancels() {
      return readerCancels;
    },
  };
}
