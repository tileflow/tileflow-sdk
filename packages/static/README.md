# @tileflow/static

Static map schemas, overlay helpers, and request utilities for Tileflow static map rendering.

```ts
import {marker, precacheStaticMap, validateStaticScene} from '@tileflow/static';

const scene = validateStaticScene({
  map: 'madrid',
  camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
  size: {width: 1200, height: 800},
  overlays: [marker({coordinate: [-3.7038, 40.4168]})],
});

await precacheStaticMap(scene.scene, {
  apiKey: process.env.TILEFLOW_API_KEY,
});
```

Docs: https://tileflow.dev/docs
