export type ResourcePlatform = 'ios' | 'android';

/** Addressing only. Native code separately decides whether the remote resource is authorized. */
export function resourceAddress(url: string, platform: ResourcePlatform): string {
  const target = new URL(url);
  if (
    !['https:', 'http:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.hash ||
    url.length > 6144
  ) {
    throw new TypeError('Invalid mobile resource URL.');
  }
  const token = btoa(String.fromCharCode(...new TextEncoder().encode(target.href)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return platform === 'ios'
    ? `tileflow://resource/${token}`
    : `https://tileflow.invalid/resource/${token}`;
}

/** Keep XYZ substitutions outside the opaque address for loaders that expand their own template. */
export function resourceTemplateAddress(url: string, platform: ResourcePlatform): string {
  const normalized = new URL(url).href;
  if (!['z', 'x', 'y'].every((axis) => normalized.includes(`%7B${axis}%7D`))) {
    throw new TypeError('The resource is not an XYZ template.');
  }
  return `${resourceAddress(normalized, platform)}/{z}/{x}/{y}`;
}

export function createResourceFetch(
  platform: ResourcePlatform,
  lifetime: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const signals = [lifetime, request.signal];
    for (const signal of signals) {
      if (signal.aborted) abort.abort();
      else signal.addEventListener('abort', cancel, {once: true});
    }
    try {
      const response = await fetch(resourceAddress(request.url, platform), {
        method: request.method,
        headers: request.headers,
        signal: abort.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      // Do not expose the transport address as the document's base URL. Core resolves relative
      // manifest resources against the original input when Response.url is empty.
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      for (const signal of signals) signal.removeEventListener('abort', cancel);
    }
  };
}
