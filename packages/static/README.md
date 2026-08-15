# @tileflow/static

Static map schemas, overlay helpers, and request utilities for Tileflow static map rendering.

```ts
import {
  createStaticMapIdempotencyKey,
  marker,
  precacheStaticMap,
  validateStaticScene,
} from '@tileflow/static';

const scene = validateStaticScene({
  map: 'madrid',
  camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
  size: {width: 1200, height: 800},
  overlays: [marker({coordinate: [-3.7038, 40.4168]})],
});

await precacheStaticMap(scene.scene, {
  apiKey: process.env.TILEFLOW_API_KEY,
  idempotencyKey: createStaticMapIdempotencyKey(),
});
```

Create one idempotency key per intentional create/precache action and retain it across network
retries. Reusing the key with the same normalized scene returns the stored result; reusing it with a
different scene returns 409. A successful paid operation reports `unitCost: 15`, shared
`remainingUnits`, its durable `operationId`, cache reuse, hash, and immutable image URL. A live
equal-hash render may return `202`; the helper polls with the same body/key within its bounded wait.
`maxWaitMs` is the total client completion budget, including network, response parsing, and polling
delays; `signal` cancels the same complete operation. The helper aborts in-flight work when either
boundary is reached. It rejects malformed responses, non-HTTP(S) image URLs, and any change of
durable operation ID while polling.

Free cannot initiate Static Maps work. Starter consumes 15 shared API units for each successful
logical operation, including a distinct-key cache reuse. Downloading the immutable PNG consumes
zero units.

Docs: https://tileflow.dev/docs
