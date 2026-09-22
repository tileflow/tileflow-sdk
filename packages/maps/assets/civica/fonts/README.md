# Cívica packaged fonts

`DMSerifText-Regular.ttf` and `DMSerifText-Italic.ttf` are unmodified upstream DM Serif Text font
files from the official Google Fonts repository, pinned to revision
`2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9`.

The OpenType full names, verified with both Fontconfig and Tileflow's Fontkit parser, are
`DM Serif Text Regular` and `DM Serif Text Italic`. Both have OS/2 weight 400; the latter has
the italic selection flag. Map styles use these exact full names.

`BarlowSemiCondensed-Regular.ttf` and `BarlowSemiCondensed-SemiBold.ttf` are unmodified upstream
Barlow Semi Condensed font files from the official Google Fonts repository, pinned to revision
`3218ae2acc5bce7ccd97c477965b5b4094241fb0`. Their verified OpenType full names are
`Barlow Semi Condensed Regular` and `Barlow Semi Condensed SemiBold`, with normal style and
weights 400 and 600 respectively. Their compact proportions distinguish street and destination
labels while leaving space for the serif place lettering.

`NotoSans-Regular.ttf` is an unmodified static hinted upstream Noto Sans font file from the
official Noto font repository, pinned to revision `c971829a87e7920f960e7277c3dafd9bedd3c601`.
Its verified OpenType full name is `Noto Sans Regular`, with normal style and weight 400. It
provides the explicit local fallback for the primary DM Serif Text and Barlow lettering.

All three families are licensed under the SIL Open Font License 1.1. The complete upstream DM
Serif Text license is preserved as `OFL.txt`; the complete upstream Barlow Semi Condensed and
Noto Sans licenses are preserved as `LICENSE-BarlowSemiCondensed.txt` and `LICENSE-NotoSans.txt`.
`LICENSE.txt` combines all three complete notices and licenses with component filenames and
source revisions for Tileflow's generic font preparation contract. These are Cívica's own
package copies; no other map's font directory is referenced.

Pinned upstream sources:

- [DM Serif Text directory](https://github.com/google/fonts/tree/2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9/ofl/dmseriftext).
- [Regular font](https://github.com/google/fonts/blob/2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9/ofl/dmseriftext/DMSerifText-Regular.ttf).
- [Italic font](https://github.com/google/fonts/blob/2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9/ofl/dmseriftext/DMSerifText-Italic.ttf).
- [SIL Open Font License](https://github.com/google/fonts/blob/2536d8f1f906c7bb1f4b1d09ac073109dc6a7cd9/ofl/dmseriftext/OFL.txt).
- [Barlow Semi Condensed directory](https://github.com/google/fonts/tree/3218ae2acc5bce7ccd97c477965b5b4094241fb0/ofl/barlowsemicondensed).
- [Barlow Semi Condensed Regular](https://github.com/google/fonts/blob/3218ae2acc5bce7ccd97c477965b5b4094241fb0/ofl/barlowsemicondensed/BarlowSemiCondensed-Regular.ttf).
- [Barlow Semi Condensed SemiBold](https://github.com/google/fonts/blob/3218ae2acc5bce7ccd97c477965b5b4094241fb0/ofl/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf).
- [Barlow SIL Open Font License](https://github.com/google/fonts/blob/3218ae2acc5bce7ccd97c477965b5b4094241fb0/ofl/barlowsemicondensed/OFL.txt).
- [Noto Sans directory](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans).
- [Noto Sans Regular](https://github.com/notofonts/noto-fonts/blob/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans/NotoSans-Regular.ttf).
- [Noto Sans SIL Open Font License](https://github.com/notofonts/noto-fonts/blob/c971829a87e7920f960e7277c3dafd9bedd3c601/LICENSE).
