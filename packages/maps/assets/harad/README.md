# Härad map assets

Härad owns nine original Tileflow intrinsic-size SVG patterns:

- `harad-arable` — parallel cultivated-field strokes;
- `harad-conifer` — compact coniferous woodland marks;
- `harad-deciduous` — rounded deciduous woodland marks;
- `harad-orchard` — regular orchard planting points;
- `harad-paper-grain` — a restrained historical-paper texture;
- `harad-sand` — sparse sand stippling;
- `harad-settlement` — settlement parcel grid without invented building footprints;
- `harad-water-lines` — fine horizontal water engraving;
- `harad-wetland` — repeated marsh and reed marks.

The patterns and Härad style are inspired by the visual grammar of Lantmäteriet's
[Häradsekonomiska kartan product](https://geotorget.lantmateriet.se/link/haradsekonomiska-kartan)
and
[official colored legend](https://www.lantmateriet.se/sv/kartor/vara-karttjanster/Historiska-kartor/Arkiven-som-ingar/Rikets-allmanna-kartverks-arkiv---RAK/contentassets/teckenforklaring.pdf).
The series was produced from 1859–1934 and its manner varied over that long period, so Härad is a
coherent contemporary synthesis rather than a claim to reproduce one standardized 1859 palette.
Lantmäteriet makes the product available under CC0 and is the source of the
historical visual reference, not of any packaged asset bytes. Tileflow authored every SVG in this
directory from scratch for use with the SDK's semantic contemporary map data.

This package does not include or redistribute any Lantmäteriet source scan, raster pixel, legend
artwork, font, geospatial data, or map data. Härad is not a digitization or facsimile of a historical
sheet.

The map refers to this directory through the exported `haradIcons` package descriptor and declares
only `[haradIcons]`. Härad uses Core's semantic `compiler: 'streets'` ABI, but it does not import or
extend the Streets map and does not reuse Streets assets.
