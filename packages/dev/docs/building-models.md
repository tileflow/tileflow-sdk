# Prepare recolorable building models

Custom buildings and landmarks use the same preparation path. Export uncompressed glTF 2.0
binaries in metres, Y up, with the origin on the ground. The default scene's triangles and node
transforms are read. Building preparation retains physical materials and embedded PNG/JPEG
textures. Animations, skins and morph targets are not evaluated; export their static geometry.

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

This door can take the map's `accent` colour while receiving its `door` lighting profile. Accepted
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

## Physical materials

The importer retains these glTF 2.0 channels independently of palette and role:

| Channel            | Inputs                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| Base colour        | Linear `baseColorFactor`, linear `COLOR_0` RGB/RGBA, sRGB base-colour texture     |
| Reflection         | `metallicFactor`, `roughnessFactor`, texture blue/green channels                  |
| Surface normal     | Tangent-space normal texture and `scale`; tangent basis from geometry and UVs     |
| Ambient visibility | Occlusion texture red channel and `strength`, multiplied by geometric visibility  |
| Emission           | Linear `emissiveFactor`, sRGB emissive texture, `KHR_materials_emissive_strength` |
| Coverage           | `OPAQUE`, `MASK` with `alphaCutoff`, or `BLEND`; `doubleSided`                    |
| Unlit              | `KHR_materials_unlit`                                                             |

`TEXCOORD_0`, `TEXCOORD_1`, glTF sampler wrapping/filtering and `KHR_texture_transform` are retained.
Every referenced channel must have its declared UV set. UV and colour seams survive welding.
Images must be embedded in buffer views or PNG/JPEG data URIs; preparation never fetches external
images. Other image formats and physical-material extensions are not supported.

Each level accepts at most 256 distinct materials, 32 textures, 4096 pixels per image dimension
and 16,777,216 decoded image pixels in total. The complete prepared file remains limited to 16 MiB.
Invalid references, missing UVs and image headers that disagree with their dimensions fail preparation.

Without overrides, a physical model retains its authored material. `modelLighting` can tint and
override roughness/metallicity by role. Explicit `modelColors` take precedence over role tints;
textures and vertex colours still modulate the chosen colour. Keep vertex colours neutral when
they should not affect recolouring.

Colour and normal textures, metallic reflection and alpha coverage use the browser's physical
model path. Ambient visibility never attenuates solar light or emission. Masked pixels also leave
holes in dynamic solar shadows; blended surfaces cast an alpha-tested shadow at 0.5. Transparent
material ranges draw back to front after opaque surfaces; intersecting transparent triangles are
not sorted individually.

## Explicit area emitters

A `door` role lights the surface. To project its spill, declare a rectangle in
`node.extras.tileflow.emitters`. This glTF fragment uses node-local metres and Y up:

```json
{
  "extras": {
    "tileflow": {
      "emitters": [
        {
          "start": [-1, 0, 0],
          "end": [1, 0, 0],
          "height": 3,
          "depth": 0.2,
          "role": "door",
          "part": "accent"
        }
      ]
    }
  }
}
```

`start` and `end` form the horizontal lower edge. The spill faces the right of that edge when
viewed from above. `height` sets the rectangle's height; optional `depth` narrows the spill around
recessed jambs. Node transforms apply to the emitter. Its role supplies emission and its part
supplies the fallback palette colour. No emitter is inferred from material colour or geometry.

Each level accepts 128 emitters. Each projects a four-triangle, depth-tested spill with reach
`clamp(1.3 * height, 4, 10)` metres. This authored effect does not cast a new light or shadow onto
other meshes. It follows the model's visibility and theme; zero emission removes it.

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

Physical data is optional `extras.tileflow.surface` metadata on each level, with `version: 1`.
Two VEC4 accessors address a separate 32-byte stream: UV0/UV1 followed by linear vertex RGBA.
The metadata also holds material draw ranges, channel references, embedded images and emitters.
Ranges preserve each source mesh's vertical emission bounds independently of its material.
The original primitive layout remains unchanged. Older readers draw its legacy geometry and
palette; they ignore the optional physical data. New readers preserve the legacy shading path
when physical data is absent. Reprepare source GLBs to obtain the new channels.

The auxiliary stream costs 32 bytes per retained vertex on the GPU. Each resident texture uses
four bytes per pixel, plus about one third for mipmaps when enabled. Decoded images stay available
for context restoration until the model is evicted. Physical materials add one draw per material
range per colour/shadow pass; explicit emitters add one four-triangle draw each. No environment
cube map or screen-space effect is required.
