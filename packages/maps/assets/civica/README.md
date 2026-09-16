# Cívica artwork

The SVG patterns and point-of-interest pictograms in `icons/` are original artwork drawn from
scratch for the Cívica Tileflow map. They use a civic print-atlas vocabulary: warm paper,
vermilion destinations, blue transport ink, loose olive tree rings, broken horizontal water
strokes, and fine diagonal industrial overprinting. The design takes broad visual inspiration
from the user's reference, _Inside the Belt Way — Washington DC_, without copying its map,
geography, lettering, composition, symbols, or artwork.

No downloaded imagery, existing map style, or external icon set is included.
Every icon and pattern is a self-contained SVG with an explicit intrinsic size for Tileflow's sprite
pipeline. Patterns have transparent backgrounds so the map owns the underlying land or water
color. Ink marks remain intentionally small and sparse to avoid competing with road and label
hierarchies at different zoom levels.

The POI pictograms use a 28 × 28 canvas and remain useful at icon sizes of 0.65–0.85. Fine ivory
clearances keep the original glyphs legible over colored map areas. Vermilion identifies civic,
cultural, and medical destinations; quiet gray-green identifies everyday businesses; gardens use
green ink. Transit and airports use compact paper squares with fine blue keylines.
`civica-poi-dot` is a quiet secondary point occupying less of the same canvas.

Pattern runtime IDs remove the `.pattern.svg` filename suffix:

- `civica-paper-grain` — sparse warm ink flecks; 128 × 128.
- `civica-park-groves` — loose clusters of small tree rings; 64 × 64.
- `civica-orchard` — staggered small orchard crowns; 64 × 32.
- `civica-water-lines` — broken horizontal blue strokes; 64 × 32.
- `civica-industrial-hatch` — seamless diagonal working-landscape hatch; 16 × 16.

POI runtime IDs are `civica-poi-civic-star`, `civica-poi-museum`, `civica-poi-monument`,
`civica-poi-garden`, `civica-poi-transit`, `civica-poi-food`, `civica-poi-lodging`,
`civica-poi-hospital`, `civica-poi-shopping`, `civica-poi-airport`, and `civica-poi-dot`.

The separately licensed fonts packaged under `fonts/` have their own upstream provenance in
`fonts/README.md` and their complete license beside the font files.
