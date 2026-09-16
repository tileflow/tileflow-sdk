# Super Tile World packaged fonts

These are static upstream fonts packaged locally for deterministic rendering. Pixelify Sans and
Noto Sans are unmodified; the Press Start 2P derivative changes only naming metadata as documented
below.
The map has its own copies and does not reference another map's asset directory. Fontkit verified
the exact OpenType full names, weights, and all Spanish accented letters in every primary face.

| File                          | Exact OpenType full name    | Weight | Purpose                                                           |
| ----------------------------- | --------------------------- | ------ | ----------------------------------------------------------------- |
| `PixelifySans-Regular.ttf`    | `Pixelify Sans Regular`     | 400    | Compact pixel lettering for roads and supporting places.          |
| `PixelifySans-SemiBold.ttf`   | `Pixelify Sans SemiBold`    | 600    | Destination and neighborhood emphasis.                            |
| `TileWorldArcade-Regular.ttf` | `Tile World Arcade Regular` | 400    | Sparse world and city headings.                                   |
| `NotoSans-Regular.ttf`        | `Noto Sans Regular`         | 400    | Explicit local fallback for characters outside the display fonts. |

Pixelify Sans is by Stefie Justprince / The Pixelify Sans Project Authors. Its two static TTFs and
license come from the official project at revision `39df74aba80df8157546034b878e8be1eb565ced`:

- [Regular](https://github.com/eifetx/Pixelify-Sans/blob/39df74aba80df8157546034b878e8be1eb565ced/fonts/ttf/PixelifySans-Regular.ttf).
- [SemiBold](https://github.com/eifetx/Pixelify-Sans/blob/39df74aba80df8157546034b878e8be1eb565ced/fonts/ttf/PixelifySans-SemiBold.ttf).
- [SIL Open Font License](https://github.com/eifetx/Pixelify-Sans/blob/39df74aba80df8157546034b878e8be1eb565ced/OFL.txt),
  preserved as `LICENSE-PixelifySans.txt`.

Tile World Arcade is a name-table-only derivative of Press Start 2P by CodeMan38 / The Press
Start 2P Project Authors. The upstream TTF and complete license come from the official Google Fonts
repository at revision `e06fe11c39051bddaef73ec338a9d1c8175723f1`:

- [Regular](https://github.com/google/fonts/blob/e06fe11c39051bddaef73ec338a9d1c8175723f1/ofl/pressstart2p/PressStart2P-Regular.ttf).
- [SIL Open Font License](https://github.com/google/fonts/blob/e06fe11c39051bddaef73ec338a9d1c8175723f1/ofl/pressstart2p/OFL.txt),
  preserved as `LICENSE-PressStart2P.txt`, including its reserved font name notice.

The new family name is `Tile World Arcade`, the full name is `Tile World Arcade Regular`, and
the PostScript name is `TileWorldArcade-Regular`. The upstream reserved font name is not used
for this derivative. The compatibility rename avoids a digit-leading word in the generated
CSS family name used by MapLibre's local glyph renderer. Only SFNT `name` records and the
resulting `head.checkSumAdjustment` were changed using FontTools. Every other SFNT table is
byte-identical to the pinned original, including outlines, metrics, hinting, character maps,
and original copyright/license metadata. This is a local rendering adaptation, not a new
typeface design. The packaged file replaces the upstream-named TTF; it is not an extra face.

Noto Sans is the static hinted upstream regular face from the official Noto font repository at
revision `c971829a87e7920f960e7277c3dafd9bedd3c601`:

- [Regular](https://github.com/notofonts/noto-fonts/blob/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans/NotoSans-Regular.ttf).
- [SIL Open Font License](https://github.com/notofonts/noto-fonts/blob/c971829a87e7920f960e7277c3dafd9bedd3c601/LICENSE),
  preserved as `LICENSE-NotoSans.txt`.

All three families use SIL Open Font License 1.1. `LICENSE.txt` combines the complete upstream
notices and licenses, with component headings, for Tileflow's generic font preparation contract.
