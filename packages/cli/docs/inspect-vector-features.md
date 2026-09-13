# Inspect vector features

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

See which bounded source features the exported map sees near a camera before tuning taxonomy,
density, or labels:

```sh
npx tileflow inspect features \
  --center=-3.6927512,40.4086555 --zoom=16 \
  --layers=poi --properties=name,category,type,icon,filter_rank,size_rank --json
```

The command supports HTTP(S) TileJSON/vector sources and returns only requested properties plus
geometry summaries in stable order. Viewport, tiles, bytes, scanned/returned features, names, and
timeouts are bounded. Safe provenance includes origins, a query-free TileJSON path, and configured
source revision or `null`; credentials, URL queries, hidden properties, response bodies, and
absolute paths are omitted. It is read-only apart from executable config's own possible side
effects and removes `TILEFLOW_API_KEY` before loading config.
