import {setWorkerUrl} from 'maplibre-gl';
import {createMobileMapRuntime} from './map-runtime';
import {createDispatcher, negotiateVersion, type Output, protocol} from './protocol';
import type {ResourcePlatform} from './resources';

declare const TILEFLOW_RUNTIME_HASH: string;
declare const TILEFLOW_MAPLIBRE_WORKER: string;
declare global {
  interface Window {
    tileflowHost: {
      instanceId: string;
      generation: number;
      platform: ResourcePlatform;
      /** The protocol versions the host supports. */
      protocol?: {minimum: number; maximum: number};
    };
    tileflow?: {receive(message: string): void};
    tileflowNative?: {postMessage(message: string): void};
    webkit?: {messageHandlers: {tileflow: {postMessage(message: string): void}}};
  }
}

const host = window.tileflowHost;
// GL JS 6 ships its worker as a separate module. Bundle that module explicitly; an IIFE
// cannot preserve its import.meta.url-relative address inside an embedded document.
const workerURL = URL.createObjectURL(
  new Blob([TILEFLOW_MAPLIBRE_WORKER], {type: 'text/javascript'}),
);
setWorkerUrl(workerURL);
const send = (output: Output) => {
  const message = JSON.stringify(output);
  if (new TextEncoder().encode(message).byteLength > protocol.limits.maximumMessageBytes) {
    throw new Error('Mobile protocol output exceeded its byte limit.');
  }
  if (host.platform === 'ios') window.webkit?.messageHandlers.tileflow.postMessage(message);
  else window.tileflowNative?.postMessage(message);
};
// The host checks the hello itself; an unsupported version is reported to it, never ignored.
const version = negotiateVersion(host.protocol);
const envelope = {
  protocolVersion: version ?? protocol.version,
  instanceId: host.instanceId,
  generation: host.generation,
};
const container = document.getElementById('map');
if (!container) throw new Error('The embedded map container is missing.');
const runtime = createMobileMapRuntime({
  container,
  platform: host.platform,
  send: (event, result) => send({...envelope, event, result}),
});
const dispatcher = createDispatcher({
  ...host,
  version,
  execute: runtime.execute,
  readPayload: runtime.readPayload,
  send,
});
window.tileflow = {
  receive: (message) => {
    void dispatcher.receive(message);
  },
};
window.addEventListener(
  'pagehide',
  () => {
    dispatcher.retire();
    runtime.dispose();
    URL.revokeObjectURL(workerURL);
  },
  {once: true},
);
send({
  ...envelope,
  event: 'hello',
  result: {
    runtimeHash: TILEFLOW_RUNTIME_HASH,
    protocol: {
      minimum: protocol.minimumVersion,
      maximum: protocol.version,
      selected: version ?? null,
    },
  },
});
