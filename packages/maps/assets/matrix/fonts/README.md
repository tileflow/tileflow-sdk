# Matrix Oxanium fonts

The Matrix map bundles the unmodified Medium and SemiBold TTFs from the Oxanium family. Its
`fonts` array imports this directory through the package-owned `matrixFonts` descriptor. The
generic Node build validates the OpenType metadata and `LICENSE.txt`, emits the selected faces as
content-addressed assets, and records them in style metadata for preview and runtime loading.

Matrix names the exact OpenType face `Oxanium Medium` for roads, water, and POIs and
`Oxanium SemiBold` for place labels. Its stacks contain only those package-owned faces: the local
font pipeline selects the first face in each stack, so Matrix does not declare unfixed system or
remote fallbacks. Tileflow does not synthesize a face by combining a family with a weight. The
style omits a remote glyph endpoint so MapLibre GL JS 5.24 rasterizes the packaged faces locally.

- Upstream: <https://github.com/sevmeyer/oxanium>
- Google Fonts specimen: <https://fonts.google.com/specimen/Oxanium>
- Pinned upstream commit: `a8f39e0c71186190027a093e9001459410192d1e`
- `Oxanium-Medium.ttf` SHA-256:
  `d0676de4894cd22591b4bb538dae5b8e06c44e0fb943300a7cff3945fe643689`
- `Oxanium-SemiBold.ttf` SHA-256:
  `e2d77ec4ee67b0152166adf5d6393360550a012c2066e0d4589053e14a733cdc`

The files are distributed under the SIL Open Font License 1.1 in `LICENSE.txt`.
