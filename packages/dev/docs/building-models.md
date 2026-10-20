# Prepare recolorable building models

Custom buildings and landmarks use the same preparation path. Export uncompressed glTF 2.0
binaries in metres, Y up, with the origin on the ground. The default scene's triangles and node
transforms are read. Textures, animations, skins and physical material parameters are not retained
by this compact building-model format.

## Separate colour from architectural role

Material names select a palette slot: `surface`, `secondary`, `glass`, `accent` or `roof`.
The optional `material.extras.tileflow.lightingRole` selects lighting independently:

```json
{
  "name": "accent",
  "extras": {
    "tileflow": {
      "lightingRole": "door"
    }
  },
  "pbrMetallicRoughness": {
    "baseColorFactor": [0.8, 0.8, 0.8, 1]
  }
}
```

This door keeps the map's `accent` colour while receiving its `door` lighting profile. Accepted
roles are `unclassified`, `wall`, `door`, `roof`, `window`, `lamp` and `logo`. A role describes
geometry; it does not turn on light by itself. The map supplies emission through
`buildings.threeDimensional.modelLighting`.

Legacy models without an explicit role use these defaults:

| Palette slot                     | Lighting role |
| -------------------------------- | ------------- |
| `surface`, `secondary`, `accent` | `wall`        |
| `glass`                          | `window`      |
| `roof`                           | `roof`        |

Doors, lamps and logos require an explicit role. Use `unclassified` for a part that must not inherit
a role. Invalid role names fail preparation. An exporter's numeric material suffix, such as
`surface.001`, is ignored.

Keep a stone relief in a wall role when it should receive the wall's lighting. A separate colour
slot can distinguish its stone without creating a separate light source. Mark roof geometry as
roof even when it shares a colour with a facade.

## Ambient visibility

Preparation estimates each vertex's local ambient visibility using 48 deterministic,
cosine-weighted hemisphere samples, a two-metre reach and a two-millimetre origin bias. A spatial
hierarchy limits intersection work; repeated positions and normals share samples. Nearby
occluders contribute more than distant ones. Each level is prepared independently, including
occlusion between its distinct primitives. Footprint meshes do not occlude.

The result travels independently of colour. Do not bake ambient occlusion into `COLOR_0`: colour
also affects direct sunlight and emission. The runtime applies prepared visibility only to the
ambient contribution; solar visibility still comes from the dynamic shadow map.

`threeDimensional.modelOcclusion` controls strength from zero to one and defaults to `0.75`.
`threeDimensional.occlusion: false` also disables model ambient occlusion. Changing these
runtime controls does not prepare the geometry again.

Preparation cost grows with unique vertices, samples and nearby geometry. It is paid when a raw
model is prepared, never per frame. Runtime occlusion adds no draw pass or texture and uses the
existing visibility byte. It describes opaque geometry at rest; it does not follow moving parts,
other models, the ground or surrounding buildings.

## Files and compatibility

Use `<id>.glb`, optionally `<id>.mid.glb` and `<id>.far.glb`. A mesh whose material is `footprint`
defines the area replaced by the model and is not drawn. Otherwise preparation derives a footprint.
See the [Core building guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/buildings-3d.md)
for placement and limits.

Prepared files retain a 16-byte vertex:

| Bytes | Content                          |
| ----- | -------------------------------- |
| 0–5   | Quantized position               |
| 6–7   | Padding                          |
| 8–10  | Normal                           |
| 11    | Padding                          |
| 12    | Palette slot                     |
| 13    | Shade within that slot           |
| 14    | Ambient visibility, 0–255        |
| 15    | Architectural lighting role, 0–6 |

The model root's `extras.tileflow.lightingRoles: 1` declares the last byte. Older files without
that marker use the legacy palette mapping. Existing fully exposed visibility values stay fully
exposed; reprepare the original GLBs to obtain geometric occlusion. Geometry, normals and palette
slots are not modified by the visibility calculation.

Roles and visibility survive meshoptimizer compression. The existing `_PAINT` accessor and vertex
stride are retained; the role occupies previously unused padding. Prepared files are an SDK
transport format, while material extras are the authoring interface.
