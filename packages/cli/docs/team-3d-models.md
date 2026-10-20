# Team 3D models

A Team publishes its own 3D building models, such as a store or a kiosk, once, under their names,
and every map of the Team places them by name. Hosted maps follow each model's current version, so
publishing an improvement changes every map that places the model on its next load, without
deploying the maps again. Locally, maps draw their own `.glb` files and need no account.

```sh
npx tileflow models publish ./models/flagship-store.glb --team @acme --json
npx tileflow models list --team @acme
npx tileflow models status flagship-store --team @acme
npx tileflow models restore flagship-store --team @acme
```

- `publish [paths...]` prepares each building model as `build` does (its levels of detail, its
  footprint and meshoptimizer compression) and publishes it as the model's new current version.
  Paths are `.glb` files or directories; with none, it publishes the building models of every map in
  the config. Publishing the bytes of the current version again changes nothing.
- `list` and `status <name>` read the Team's models, their versions and the maps that place them.
- `restore <name>` makes the previous version current again. A model keeps its current and previous
  versions.
- `purge <name> --confirm <name>` deletes a model and its versions, and is refused while a map
  places it.

Each command needs Team authority: an account session with access to the Team, or a Team API key
with the 3D models permission (`--api-key`). Pass `--team @team` when the account has several Teams.

`tileflow deploy` uploads no model files. It writes each placement of a building model as the
placeholder `tileflow://team-models/<name>`, which Hosted replaces with the model's address in the
map's Team; a model the Team has not published fails the deploy, and the deploy warns when a placed
model's published version was prepared from other files than the map's. Models are served publicly
and may be cached, so they must not hold secrets or restricted personal data. MapLibre Native draws
no models, so a deploy with `--with-native` does not take them.

See [3D buildings](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/buildings-3d.md#building-models)
for how to prepare a model.
