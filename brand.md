# EDK brand guide

EDK makes EDK-1, a spatial model that gives humans and machines a compass for the world: position, condition, motion, navigation, stream and vision. The logo is the wordmark **edk**.

## Primitives

Everything EDK-1 does is one of six primitives. Describe the model in these terms, in this order; each builds on the ones before it.

| Primitive | What it is | Line |
|---|---|---|
| Position | Grounding anything on Earth | A name, a sentence, a photograph or a coordinate resolves to one exact place, with everything known about it attached. Position is how a model stops guessing where and starts knowing. |
| Condition | Reading the state of a place | Terrain, risk, access and activity, fused into a single picture of what holds at a place. Condition turns ground truth into something a machine can decide from. |
| Motion | Understanding how the world moves | Flows, rhythms and change over time: what a place is doing now, and where it is heading. Motion gives a model a sense of before and after. |
| Navigation | Directing movement through the physical world | Paths for people and machines, shaped by position, condition and motion together. Navigation is where understanding becomes action: the right way through, not only the shortest. |
| Stream | Watching for change, everywhere | A standing watch over a place: the moment something new appears, it is noticed, described and sent on. Stream turns a model that answers into one that keeps an eye out. |
| Vision | Seeing what is in front of you | A single image, read the way the model reads the world: every object it knows is found, named and outlined. Vision lets a machine look at the ground in front of it and know what is there. |

- Tagline: **Compass for Machines**. The six primitives are what the compass reads.
- Capitalize a primitive when naming it (Position), lowercase in running text ("position, condition, motion, navigation, stream and vision").
- Discover, Inspect, Route, Monitor and Detect are the API calls; the primitives are what the model does. Don't present the calls as primitives.
- Each primitive has its own ASCII scene: houses (Position), a mountain under changing weather (Condition), birds (Motion), cars (Navigation), a river (Stream), an aurora (Vision). They are shown at https://edk.earth/model.
- The copy lives in `app/lib/primitives.ts`. Change it there and here together.

## Wordmark

- Drawn on a 136 x 64 box with 9-unit strokes: `e` (bar and open bowl), `d` (bowl and stem), `k` (stem, arm, leg). Use the artwork in `public/brand/`; never set "edk" in a typeface.
- One ink: Soil on light, Paper on dark, Soil on Ochre.
- Clear space: the height of the "e" on every side. Smallest size: 14px tall.
- Don't stretch, outline, rotate or add effects.

## Color

| Name | HEX | Role |
|---|---|---|
| Soil | `#13110E` | Canvas (dark is the default), ink on light |
| Paper | `#F1EBDF` | Light canvas, ink on dark |
| Ochre | `#E0A458` | Primary actions, one accent per screen |
| Moss | `#9CB46A` | Live, verified, free |
| Clay | `#C8643F` | Warnings, sparingly |
| Sky | `#8FB3C0` | Water, numbers in code |

## Type

Geist for headings and text (600 for headings, tight negative tracking), Geist Mono for code, labels, navigation and numbers.

## Shape

- Corners are nearly square: 2px on controls, chips and markers, 4px on inputs and cards, 6px on panels and the Atlas dock. Nothing is a pill.
- Only true circles stay round: status dots, avatars, the globe.
- Elevation comes from 1px borders; resting elements carry no shadow.

## Texture and motion

- ASCII scenes from the eearth engine: an Earth in the hero, quieter scenes beside section headings. Never behind text.
- A graticule behind the hero, centred on the Earth: hairline range rings, bearings every 15° and one Ochre ring, concentric with the globe. No dot grids, gradients-as-decoration or glows.
- No rule between the header and the page.
- No all-caps kickers or labels. Headings stand on their own; small labels are sentence case.
- Transitions are 130ms on color and border. Everything respects `prefers-reduced-motion`.

## Assets

`public/brand/`: wordmark (soil, paper, ochre; SVG and PNG), app icon (SVG, 512 and 192 PNG), social card (SVG and PNG). `public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `og.png` are derived from them. Shown at https://edk.earth/brand.
