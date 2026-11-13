# EDK brand guide

EDK is the compass for machines: one API for questions about the physical world. The identity is **the compass**: a heavy Earth ring crossed by a needle whose ochre north point breaks out of the ring.

## Mark and wordmark

- Drawn on a 64-unit grid. Ring: circle r 22.5, stroke 7. Needle: north `M32 1.5 41.5 32H22.5Z` (Ochre), south `M32 62.5 22.5 32H41.5Z`. East–west bar: `M11 32 32 27.2V36.8Z M53 32 32 36.8V27.2Z`. Pivot: r 3.6 hole with a 2.4 stroke.
- The wordmark "edk" is custom drawn with 9-unit strokes on a 136 × 64 box. Use the artwork; never set "edk" in a typeface.
- Lockup: mark, 22-unit gap, wordmark (viewBox 222 × 64).
- The north point is always Ochre. Everything else is one ink: Soil on light, Paper on dark. On an Ochre background, use the one-color mark in Soil.
- Clear space: a quarter of the mark's width. Minimum size: 16px for the mark, 96px wide for the lockup.
- Don't rotate, stretch, outline, recolor the north point, or add shadows or glows.

## Color

| Name | HEX | Role |
|---|---|---|
| Soil | `#13110E` | Dark canvas (default theme), ink on light |
| Paper | `#F1EBDF` | Light canvas, mark on dark |
| Ochre | `#E0A458` | North needle, primary action, active state |
| Moss | `#9CB46A` | Live, verified, free |
| Clay | `#C8643F` | Highlights and warnings, sparingly |
| Sky | `#8FB3C0` | Water, numbers in code |

Light theme surfaces: background `#F4EFE6`, raised `#FBF8F2`, rule `#DED5C5`. Dark theme surfaces: background `#13110E`, raised `#1B1814`, rule `#2E2922`.

## Type

Fraunces for display headings (500, soft optical size), Geist for UI and body, Geist Mono for code, labels, navigation and numbers.

## Motion and texture

- ASCII scenes from the eearth engine (a spinning Earth in the hero; birds, houses, butterflies, a tree and aurora elsewhere) are etched in a page-aligned glyph grid and kept away from text.
- Faint topographic contour lines sit behind heroes.
- Interface transitions are 130ms on color and border only. Everything respects `prefers-reduced-motion`.

## Assets

`public/brand/`: mark, mark on dark, one-color mark, wordmark (both inks), lockups (both inks), app icon (SVG, 512 and 192 PNG) and the 1200 × 630 social card. `public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `og.png` are derived from them. The site shows them at https://edk.earth/brand.
