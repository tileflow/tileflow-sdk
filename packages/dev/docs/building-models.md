# Prepare recolorable building models

Custom buildings and landmarks use the same preparation path. Export uncompressed glTF 2.0
binaries in metres, Y up, with the origin on the ground. The default scene's triangles and node
transforms are read. Building preparation retains physical materials and embedded PNG/JPEG
textures. Animations, skins and morph targets are not evaluated; export their static geometry.

## Separate colour from architectural role

A material's name is the part it belongs to: an architectural part, `surface`, `secondary`,
`glass`, `accent` or `roof`, or a part of the model's own, such as `water`, `vegetation`, `wood` or
`stone`. Names are lower-case words joined by hyphens or underscores, at most 32 characters, and a
level names at most 16 parts; materials of the same part share its name. The map colours a part
through `buildings.threeDimensional.modelColors` under its name; a part it does not colour keeps
its material's colour. Name pools `water`, planting `vegetation` and timber `wood` where they fit:
Streets colours these from its water and tree colours in every theme. A GLB whose materials name
only `bark`, `leaves`, `fronds` or `stem` is a tree model, not a building model.

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

A material without an explicit role takes its part's default:

| Part                             | Lighting role  |
| -------------------------------- | -------------- |
| `surface`, `secondary`, `accent` | `wall`         |
| `glass`                          | `window`       |
| `roof`                           | `roof`         |
| Any other part                   | `unclassified` |

A part names a colour, not a material: physical properties and emission remain controlled by the
authored material and its independent lighting role.

Doors, lamps and logos require an explicit role. Use `unclassified` for a part that must not inherit
a role. Invalid role names fail preparation. An exporter's numeric material suffix, such as
`surface.001`, is ignored.

Keep a stone relief in a wall role when it should receive the wall's lighting. A part of its own,
such as `stone`, can distinguish its colour without creating a separate light source. Mark roof geometry as
roof even when it shares a colour with a facade.

## Physical materials

The importer retains these glTF 2.0 channels independently of part and role:

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
Colour textures and lit output use the scene's gamma-2.2 transfer approximation.
Role emission mixes the complete material radiance toward its target, including authored emission.
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
recessed jambs. Node transforms apply to the emitter. Its role supplies emission and its part, by name,
supplies the fallback colour. No emitter is inferred from material colour or geometry.

Each level accepts 128 emitters. Each projects a four-triangle, depth-tested spill with reach
`clamp(1.3 * height, 4, 10)` metres. This authored effect does not cast a new light or shadow onto
other meshes. It follows the model's visibility and theme; zero emission removes it.

## Ambient visibility

Preparation estimates local ambient visibility with deterministic, cosine-weighted hemisphere
samples, a two-metre reach and a two-millimetre origin bias. A spatial hierarchy limits
intersection work. Nearby occluders contribute more than distant ones. Each level is prepared
independently, including occlusion between its distinct primitives. Footprint meshes do not
occlude.

The near and mid levels carry visibility in an occlusion texture. Preparation lays the level's
triangles flat in one atlas: connected triangles facing within 20 degrees of each other share a
chart, curved strips are cut where they would waste their rectangle, and charts under two texels
share a palette of uniform grey texels. Shade detail grows with the square root of the level's
surface: about 89·A^0.54 texels of visible shade for A square metres, so a large building takes
coarser shade per metre than a small one. The near level's atlas budget allows for packing and
has two floors: 65,536 texels, so small detailed buildings keep their mouldings distinct, and
1.3 texels a metre, so towers keep each storey's mullions and slabs apart. It takes at most
524,288 texels; the mid level takes a quarter of it. The density is the highest at which
the atlas fits its budget. Each texel averages four points inside it, 12 rays each with turned
patterns; points hidden just behind other surfaces are skipped. The atlas is a greyscale JPEG of
quality 35, about a tenth of a byte a texel, on the second UV set, stored with sixteen bits, and
becomes every material's occlusion texture. Vertices are split where charts meet; triangles keep
their order.

Contact shade therefore follows the surface instead of spreading between distant vertices. A
level whose materials already use an occlusion texture or the second UV set, or whose charts
cannot fit the budget, and the far level keep 48-sample visibility on their vertices.

The result travels independently of colour. Do not bake ambient occlusion into `COLOR_0`: colour
also affects direct sunlight and emission. The runtime applies prepared visibility only to the
ambient contribution; solar visibility still comes from the dynamic shadow map.

`threeDimensional.modelOcclusion` controls strength from zero to one and defaults to `0.75`.
`threeDimensional.occlusion: false` also disables model ambient occlusion. Changing these
runtime controls does not prepare the geometry again.

Preparation cost grows with texels, rays and nearby geometry; a large landmark's near level takes
seconds to tens of seconds. It is paid when a raw model is prepared, never per frame. A texture
used only for occlusion is uploaded with one channel, at most 0.7 MB with mipmaps for a near level.
Visibility describes opaque geometry at rest; it does not follow moving parts, other models, the
ground or surrounding buildings.

## Files and compatibility

Use `<id>.glb`, optionally `<id>.mid.glb` and `<id>.far.glb`. A mesh whose material is `footprint`
defines the area replaced by the model and is not drawn. Otherwise preparation derives a footprint.
See the [Core building guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/buildings-3d.md)
for placement and limits.

Prepared files retain a 16-byte vertex:

| Bytes | Content                               |
| ----- | ------------------------------------- |
| 0–5   | Quantized position                    |
| 6–7   | Padding                               |
| 8–10  | Normal                                |
| 11    | Padding                               |
| 12    | Part, an index into the level's parts |
| 13    | Shade within that part                |
| 14    | Ambient visibility, 0–255             |
| 15    | Architectural lighting role, 0–6      |

Each level node's `extras.tileflow.parts` lists the names its part indices count through. Older
files without that list count through `surface`, `secondary`, `glass`, `accent` and `roof`. The
model root's `extras.tileflow.lightingRoles: 1` declares the last byte; older files without that
marker take each part's default role. Existing fully exposed visibility values stay fully exposed;
reprepare the original GLBs to obtain geometric occlusion. The occlusion texture splits vertices
along its charts without moving them or changing their normals or parts.

Roles and visibility survive meshoptimizer compression. The existing `_PAINT` accessor and vertex
stride are retained; the role occupies previously unused padding. Prepared files are an SDK
transport format, while material extras are the authoring interface.

Physical data is optional `extras.tileflow.surface` metadata on each level. With `version: 1`,
two VEC4 accessors address a separate 32-byte stream: UV0/UV1 followed by linear vertex RGBA. A
level whose occlusion texture reads the second UV set, inside the unit square, uses `version: 2`:
one 24-byte float stream for UV0 and RGBA, and a second stream holding UV1 as normalised
sixteen-bit values. Readers that only know version 1 reject such a level, so a runtime that reads
version 2 must be in place before files prepared with occlusion textures are served.
The metadata also holds material draw ranges, channel references, embedded images and emitters.
Ranges preserve each source mesh's vertical emission bounds independently of its material.
The original primitive layout remains unchanged. Older readers draw its geometry and part
colours; they ignore the optional physical data. New readers preserve the legacy shading path
when physical data is absent. Reprepare source GLBs to obtain the new channels.

The auxiliary stream costs 32 bytes per retained vertex on the GPU. Each resident texture uses
four bytes per pixel, or one when only occlusion reads it, plus about one third for mipmaps when
enabled. Decoded images stay available
for context restoration until the model is evicted. Physical materials add one draw per material
range per colour/shadow pass; explicit emitters add one four-triangle draw each. No environment
cube map or screen-space effect is required.
