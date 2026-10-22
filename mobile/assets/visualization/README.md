# Offline visualization preview

`lucide.min.js` is Lucide 0.468.0, downloaded from
https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js.
Its ISC license is preserved in `LICENSE-lucide` and in the script header.

`base.css` provides Relayune's offline defaults for visualization fragments.
The preview does not implement Codex host APIs or allow external resources.

`noto-cjk.woff2` is an offline CJK fallback derived from Noto Sans SC Regular:
https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf.
The source SHA-256 is `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`.
Its SIL Open Font License is preserved in `LICENSE-noto`.
The modified font is named **Relayune Preview CJK**, subset with fontTools to
U+2000–9FFF, U+F900–FAFF, U+FF00–FFEF, and U+20000–2FA1F, with hinting and
layout features removed and WOFF2 compression. Latin and code text retain the
fragment's fonts. This avoids missing Chinese glyphs in iOS Simulator WebKit
without downloading fonts or permitting network access from the preview.
