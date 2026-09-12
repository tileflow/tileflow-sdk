# Capture scenes

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

Commit named `scenes` on the singular exported map. A scene implicitly targets that map, so it does
not repeat a `map` selector. Scene metadata does not inherit and is removed before cartographic
compilation; it affects visual evidence, not style or manifest identity.

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  scenes: {
    'madrid-desktop': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
  },
});
```

Use `tileflow preview --scene madrid-desktop` (`tileflow dev` remains an alias) for live review and
`tileflow capture madrid-desktop` for exact pixels and a schema-version-4 receipt containing the
concrete theme plus Streets, data, style, renderer, and image identities. World capture resolves the selected TileJSON
once and records the exact `world-v1` release plus descriptor/archive/data-contract hashes;
external fixtures may identify their explicit revision.

Every exact World V1 release ID is already canonical at the producer boundary: 12–128 characters
matching `^world-v1-[a-z0-9][a-z0-9._-]*[a-z0-9]$`. Core validates the literal value and never trims,
lowercases, or upgrades it to another World generation.
