# Streets lettering

Streets packages unmodified DINish Medium (500) and Bold (700) for road names, POI names and
route shields. DINish is an open DIN-inspired design; it is not DIN Pro. The exact OpenType
full names are `DINish Medium` and `DINish Bold`.

The files come from [DINish revision a5f3b2a3b932336225815bf9005e3b72cc3de71c](https://github.com/playbeing/dinish/tree/a5f3b2a3b932336225815bf9005e3b72cc3de71c/fonts/ttf/DINish).
`LICENSE-DINish.txt` preserves the complete upstream SIL Open Font License 1.1 notice.

Noto Sans Regular, Bold and Italic preserve the other label roles and provide a fallback for
navigation labels. These static hinted files come from [Noto revision c971829a87e7920f960e7277c3dafd9bedd3c601](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601/hinted/ttf/NotoSans).
Their exact full names are `Noto Sans Regular`, `Noto Sans Bold` and `Noto Sans Italic`.
`LICENSE-NotoSans.txt` preserves their complete upstream SIL Open Font License 1.1 notice.

`LICENSE.txt` combines both complete notices for the font preparation pipeline. No font file
has been subsetted or modified. URL glyph providers must declare each exact comma-joined `text-font` request key, including
`DINish Medium,Noto Sans Regular` and `DINish Bold,Noto Sans Regular`. Hosted deployment currently
requires such a public provider; the bundled TTF faces work in browser and native self-hosted output.
