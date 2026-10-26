import {setWorkerUrl} from 'maplibre-gl';
import {createMobileMapRuntime} from './map-runtime';
import {createDispatcher, type Output, protocol} from './protocol';
import type {ResourcePlatform} from './resources';

declare const TILEFLOW_RUNTIME_HASH: string;
declare const TILEFLOW_MAPLIBRE_WORKER: string;
declare global {
  interface Window {
    tileflowHost: {instanceId: string; generation: number; platform: ResourcePlatform};
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
  if (new TextEncoder().encode(message).byteLength > protocol.maximumMessageBytes) {
    throw new Error('Mobile protocol output exceeded its byte limit.');
  }
  if (host.platform === 'ios') window.webkit?.messageHandlers.tileflow.postMessage(message);
  else window.tileflowNative?.postMessage(message);
};
const envelope = {
  protocolVersion: protocol.version,
  instanceId: host.instanceId,
  generation: host.generation,
};
const container = document.getElementById('map');
if (!container) throw new Error('The embedded map container is missing.');
const runtime = createMobileMapRuntime({
  container,
  platform: host.platform,
  emit: (event, result) => send({...envelope, event, result}),
});
const dispatcher = createDispatcher({...host, execute: runtime.execute, send});
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
send({...envelope, event: 'hello', result: {runtimeHash: TILEFLOW_RUNTIME_HASH}});
