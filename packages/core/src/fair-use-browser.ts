import {isTileflowWorldReleaseId} from './data/world-release-id-values';

export type TileflowFairUseNoticeState = 'GRACE' | 'CLAIM_REQUIRED';

export type TileflowFairUseNotice = Readonly<{
  action: string;
  helpUrl: string;
  message: string;
  state: TileflowFairUseNoticeState;
}>;

export type TileflowWorldProtocolRequest = Readonly<{
  type?: string;
  url: string;
}>;

export type TileflowWorldProtocolResponse = Readonly<{
  cacheControl?: string;
  data: ArrayBuffer;
  etag?: string;
  expires?: string;
}>;

export type TileflowWorldProtocolHandler = (
  request: TileflowWorldProtocolRequest,
  abortController: AbortController,
) => Promise<TileflowWorldProtocolResponse>;

export type TileflowWorldRequestBridge = Readonly<{
  dispose: () => void;
  rewriteUrl: (url: string) => string;
}>;

export type TileflowFairUseNoticeController = Readonly<{
  dispose: () => void;
  update: (notice: TileflowFairUseNotice | null) => void;
}>;

const protocol = 'tileflow-world';
const defaultHelpUrl = 'https://tileflow.dev/world/claim';
const ownerAction = 'Site owner: manage this map with Tileflow.';
const maximumWorldTileBytes = 16 * 1024 * 1024;
const oversizedWorldTileMessage = 'Tileflow World tile exceeds the maximum response size';
const unreadableWorldTileMessage = 'Tileflow World tile response could not be read';
const registrations = new Map<
  string,
  {
    currentNoticeState: TileflowFairUseNoticeState | null;
    fetch: typeof fetch;
    lastNoticeSequence: number;
    nextRequestSequence: number;
    onNotice: (notice: TileflowFairUseNotice | null) => void;
  }
>();
let installed = false;
let channelSequence = 0;

export function registerTileflowWorldRequestBridge(input: {
  addProtocol: (name: string, handler: TileflowWorldProtocolHandler) => void;
  fetch?: typeof fetch;
  onNotice: (notice: TileflowFairUseNotice | null) => void;
}): TileflowWorldRequestBridge {
  if (!installed) {
    input.addProtocol(protocol, loadTileflowWorldRequest);
    installed = true;
  }
  const channel = createChannel();
  registrations.set(channel, {
    currentNoticeState: null,
    fetch: input.fetch ?? globalThis.fetch,
    lastNoticeSequence: 0,
    nextRequestSequence: 0,
    onNotice: input.onNotice,
  });
  let disposed = false;

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      registrations.delete(channel);
    },
    rewriteUrl(url: string) {
      if (disposed || !isCanonicalWorldTileUrl(url)) return url;
      return `${protocol}://request/${channel}?url=${encodeURIComponent(url)}`;
    },
  });
}

export function tileflowFairUseNoticeMessage(state: TileflowFairUseNoticeState): string {
  return state === 'CLAIM_REQUIRED'
    ? 'Map usage is temporarily limited.'
    : 'Map usage is approaching its temporary limit.';
}

export function attachTileflowFairUseNotice(
  container: HTMLElement,
): TileflowFairUseNoticeController {
  let element: HTMLDivElement | null = null;
  let current: TileflowFairUseNotice | null = null;
  let disposed = false;

  const remove = () => {
    element?.remove();
    element = null;
    current = null;
  };

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      remove();
    },
    update(notice) {
      if (disposed) return;
      if (!notice) {
        remove();
        return;
      }
      if (current?.state === 'CLAIM_REQUIRED' && notice.state === 'GRACE') return;
      if (element && current?.state !== notice.state) {
        element.remove();
        element = null;
      }
      current = notice;
      if (!element) {
        element = container.ownerDocument.createElement('div');
        element.dataset.tileflowFairUseNotice = '';
        element.setAttribute('aria-atomic', 'true');
        element.setAttribute('aria-live', 'polite');
        element.setAttribute('role', 'status');
        Object.assign(element.style, noticeContainerStyles(notice.state));
        container.append(element);
      }
      element.dataset.tileflowFairUseNotice = notice.state.toLowerCase().replace('_', '-');
      element.replaceChildren();
      const indicator = container.ownerDocument.createElement('span');
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = notice.state === 'CLAIM_REQUIRED' ? '!' : '';
      Object.assign(indicator.style, noticeIndicatorStyles(notice.state));
      element.append(indicator);
      const copy = container.ownerDocument.createElement('span');
      copy.textContent = `${notice.message} `;
      const link = container.ownerDocument.createElement('a');
      link.href = notice.helpUrl;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.textContent = notice.action;
      Object.assign(link.style, {
        color: 'inherit',
        fontWeight: '700',
        textDecoration: 'underline',
        textDecorationThickness: '1px',
        textUnderlineOffset: '2px',
      });
      copy.append(link);
      element.append(copy);
    },
  });
}

async function loadTileflowWorldRequest(
  request: TileflowWorldProtocolRequest,
  abortController: AbortController,
): Promise<TileflowWorldProtocolResponse> {
  const wrapped = new URL(request.url);
  const channel = wrapped.pathname.slice(1);
  const registration = wrapped.hostname === 'request' ? registrations.get(channel) : undefined;
  const original = wrapped.searchParams.get('url') ?? '';
  if (!registration || !isCanonicalWorldTileUrl(original)) {
    throw new Error('Invalid Tileflow World request bridge');
  }
  registration.nextRequestSequence += 1;
  const requestSequence = registration.nextRequestSequence;

  const response = await registration.fetch(original, {
    credentials: 'omit',
    method: 'GET',
    signal: abortController.signal,
  });
  const registrationStillActive = registrations.get(channel) === registration;
  const fairUse = parseFairUseState(response.headers.get('Tileflow-Fair-Use'));
  const ownerNotice = response.headers.get('Tileflow-Fair-Use-Notice') === 'owner';
  if (
    registrationStillActive &&
    fairUse !== null &&
    requestSequence >= registration.lastNoticeSequence
  ) {
    if (fairUse === 'OPEN') {
      if (response.ok) {
        registration.lastNoticeSequence = requestSequence;
        registration.currentNoticeState = null;
        registration.onNotice(null);
      }
    } else if (
      fairUse === 'CLAIM_REQUIRED' ||
      (fairUse === 'GRACE' && (ownerNotice || response.status === 429))
    ) {
      registration.lastNoticeSequence = requestSequence;
      if (!(registration.currentNoticeState === 'CLAIM_REQUIRED' && fairUse === 'GRACE')) {
        registration.currentNoticeState = fairUse;
        registration.onNotice(
          Object.freeze({
            action: ownerAction,
            helpUrl: parseHelpUrl(response.headers.get('Link')),
            message: tileflowFairUseNoticeMessage(fairUse),
            state: fairUse,
          }),
        );
      }
    } else if (fairUse === 'GRACE' && response.ok) {
      registration.lastNoticeSequence = requestSequence;
      if (registration.currentNoticeState !== 'CLAIM_REQUIRED') {
        registration.currentNoticeState = null;
        registration.onNotice(null);
      }
    }
  }

  if (
    response.status === 404 ||
    (response.status === 429 && (fairUse === 'GRACE' || fairUse === 'CLAIM_REQUIRED'))
  ) {
    await cancelResponseBody(response.body);
    return Object.freeze({
      cacheControl: 'private, no-store',
      data: new ArrayBuffer(0),
    });
  }
  if (!response.ok) {
    await cancelResponseBody(response.body);
    throw new Error(`Tileflow World request failed: ${response.status}`);
  }
  return Object.freeze({
    ...(response.headers.get('Cache-Control')
      ? {cacheControl: response.headers.get('Cache-Control')!}
      : {}),
    data: await readWorldTileBody(response, abortController.signal),
    ...(response.headers.get('ETag') ? {etag: response.headers.get('ETag')!} : {}),
    ...(response.headers.get('Expires') ? {expires: response.headers.get('Expires')!} : {}),
  });
}

async function readWorldTileBody(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (signal.aborted) {
    await cancelResponseBody(response.body);
    throw abortReason(signal);
  }
  const declaredLength = parseContentLength(response.headers.get('Content-Length'));
  if (declaredLength !== null && declaredLength > maximumWorldTileBytes) {
    await cancelResponseBody(response.body);
    throw new Error(oversizedWorldTileMessage);
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let abortCancellation: Promise<void> | null = null;
  const cancelForAbort = () => {
    abortCancellation ??= cancelReader(reader, signal.reason);
  };
  signal.addEventListener('abort', cancelForAbort, {once: true});

  try {
    while (true) {
      const {done, value} = await reader.read();
      throwIfWorldRequestAborted(signal);
      if (done) break;
      if (value.byteLength > maximumWorldTileBytes - byteLength) {
        await cancelReader(reader);
        throw new Error(oversizedWorldTileMessage);
      }
      byteLength += value.byteLength;
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (signal.aborted) {
      await (abortCancellation ?? cancelReader(reader, signal.reason));
      throw abortReason(signal);
    }
    await cancelReader(reader);
    if (error instanceof Error && error.message === oversizedWorldTileMessage) throw error;
    throw new Error(unreadableWorldTileMessage);
  } finally {
    signal.removeEventListener('abort', cancelForAbort);
    reader.releaseLock();
  }

  const data = new ArrayBuffer(byteLength);
  const output = new Uint8Array(data);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function parseContentLength(value: string | null): number | null {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/u.test(normalized)) return null;
  const length = Number(normalized);
  return Number.isSafeInteger(length) ? length : maximumWorldTileBytes + 1;
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // The response outcome must not be replaced by a secondary cancellation failure.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The bounded-read or abort outcome takes precedence over stream cleanup failures.
  }
}

function throwIfWorldRequestAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  return new DOMException('The Tileflow World request was aborted', 'AbortError');
}

function parseFairUseState(value: string | null): TileflowFairUseNoticeState | 'OPEN' | null {
  if (value === 'open') return 'OPEN';
  if (value === 'grace') return 'GRACE';
  if (value === 'claim-required') return 'CLAIM_REQUIRED';
  return null;
}

function noticeContainerStyles(state: TileflowFairUseNoticeState): Record<string, string> {
  const shared = {
    display: 'flex',
    left: '50%',
    position: 'absolute',
    transform: 'translateX(-50%)',
    zIndex: '3',
  };
  if (state === 'GRACE') {
    return {
      ...shared,
      alignItems: 'center',
      background: 'rgba(252, 250, 244, 0.96)',
      border: '1px solid rgba(189, 138, 43, 0.28)',
      borderRadius: '999px',
      bottom: '24px',
      boxSizing: 'border-box',
      boxShadow: '0 1px 5px rgba(17, 24, 39, 0.15)',
      color: '#38433d',
      font: '560 12px/1.35 system-ui, sans-serif',
      gap: '7px',
      maxWidth: 'calc(100% - 24px)',
      padding: '7px 11px 7px 9px',
      textAlign: 'center',
      width: 'max-content',
    };
  }
  return {
    ...shared,
    alignItems: 'flex-start',
    background: 'rgba(25, 34, 29, 0.96)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
    color: '#fff',
    font: '500 13px/1.45 system-ui, sans-serif',
    gap: '10px',
    maxWidth: 'min(39rem, calc(100% - 32px))',
    padding: '12px 14px',
    textAlign: 'left',
    top: '14px',
  };
}

function noticeIndicatorStyles(state: TileflowFairUseNoticeState): Record<string, string> {
  if (state === 'GRACE') {
    return {
      background: '#c58c28',
      borderRadius: '999px',
      flex: '0 0 auto',
      height: '7px',
      width: '7px',
    };
  }
  return {
    alignItems: 'center',
    background: '#d69e39',
    borderRadius: '999px',
    color: '#17201b',
    display: 'inline-flex',
    flex: '0 0 auto',
    font: '800 12px/1 system-ui, sans-serif',
    height: '18px',
    justifyContent: 'center',
    marginTop: '1px',
    width: '18px',
  };
}

function parseHelpUrl(value: string | null): string {
  const match = value?.match(/<([^>]+)>\s*;\s*rel=(?:"help"|help)(?:\s*;|\s*$)/iu);
  if (!match?.[1]) return defaultHelpUrl;
  try {
    const url = new URL(match[1]);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.hostname !== 'tileflow.dev' && !url.hostname.endsWith('.tileflow.dev'))
    ) {
      return defaultHelpUrl;
    }
    return url.toString();
  } catch {
    return defaultHelpUrl;
  }
}

function isCanonicalWorldTileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const exactPath = url.pathname.match(
      /^\/tiles\/world\/([^/]+)\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\.pbf$/u,
    );
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'tileflow.dev' && !url.hostname.endsWith('.tileflow.dev')) ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !exactPath ||
      !isTileflowWorldReleaseId(exactPath[1])
    ) {
      return false;
    }

    const allowedQueryKeys = new Set([
      'grant',
      'map',
      'renderExpires',
      'renderSignature',
      'session',
      'styleId',
      'worldDescriptorSha256',
    ]);
    if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) return false;
    const descriptorDigests = url.searchParams.getAll('worldDescriptorSha256');
    return descriptorDigests.length === 1 && /^[0-9a-f]{64}$/u.test(descriptorDigests[0] ?? '');
  } catch {
    return false;
  }
}

function createChannel(): string {
  channelSequence += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `bridge_${crypto.randomUUID().replaceAll('-', '_')}`;
  }
  return `bridge_${Date.now().toString(36)}_${channelSequence.toString(36)}`;
}
