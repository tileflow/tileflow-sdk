# Bounded PMTiles resource inspection

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

Node tooling can inspect one local PMTiles archive without reading it completely:

```ts
import {inspectTileflowPmtiles} from '@tileflow/dev/tilesets';

const inspection = await inspectTileflowPmtiles('./data/stores.pmtiles', {
  includeValues: ['category', 'status'],
});
```

Inspection schema 1 separates the authoritative PMTiles header and TileJSON `vector_layers` metadata
from deterministic bounded MVT observations. Each sampled field reports present/missing feature
counts, observed primitive types, capped distinct-value cardinality, numeric min/max, and explicit
truncation. Values are returned only for requested portable field names, with at most 32 requested
fields, 16 values per field, and 256 characters per string. Sampling reads at most eight tiles,
20,000 features, or 24 MB of tile data; `sample: false` returns only authoritative metadata and does
not accept `includeValues`.
