# Blockyard

A calm, goal-less building toy for the browser, in the spirit of Oskar Stålberg's
*Townscaper*. Click to place colored blocks on an organic irregular grid; a
procedural architecture system turns them into little buildings with walls,
windows, doors, and merged hip roofs. There is nothing to win. That's the point.

**[Specs live in `docs/`](docs/01-product-spec.md)** — product spec, technical
architecture, project plan, and the original contractor brief.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

`npm test` runs the suite (grid invariants, determinism goldens, save-codec
round-trips, picking properties, and a 4,000-edit totality fuzz gate).
`npm run typecheck` for strict TS. `npm run build` emits a fully static site —
no server, works offline once loaded.

## How to play

| Input | Action |
|-------|--------|
| Left click / drag | place blocks (paints along the drag) |
| Right click | remove a block |
| Right drag | orbit · scroll: zoom · middle-drag: pan |
| Alt+click | eyedrop a block's color |
| 1–9, 0, `,` `.` | pick / cycle palette colors |
| B / N / M / L / W | build · line · area · raise land · dig water tools |
| Alt+drag (line/area) | bulk **remove** |
| Ctrl/Cmd+Z · Shift+Z | undo · redo |
| G | toggle the full grid overlay |

The slider (bottom left) moves the sun: midday → golden hour → night, when the
windows light up. Towns autosave locally; ⛓ copies a share URL that encodes the
whole town (terrain, blocks, colors, time of day) — no backend involved.

### Special builds

Color is architecture, not paint (spec CD1–CD4):

- **Lighthouse** — an isolated tower, 4+ tall, whose top blocks alternate
  between two colors, grows a glazed lantern room and gallery.
- **Garden courtyard** — enclose open ground with buildings of *differing*
  colors and it blooms into a garden with hedges, trees, and a bench.
- **Flag buntings** — two buildings one cell apart get pennant strings; the
  endpoint colors decide the flags (same → uniform, different → mixed).
- Cool/dark color families build flat-roofed modern blocks; warm/light
  families build pitched-roof cottages; window styles vary per family.

## Architecture (for the next engineer)

One-directional pipeline (tech doc §4): `input → town(+history) →
architecture(regions → recipes → mesher) → render`.

- **`src/core`** — seeded PRNG (`rng.ts` is the *only* legal randomness in
  generation paths; determinism is what makes share codes work) and world
  constants.
- **`src/grid`** — System A: triangular lattice in a hex → seed-shuffled
  merge into quads → quadrangulating subdivision (guarantees all-quads) →
  best-fit-square relaxation with pinned boundary → baked adjacency +
  spatial index. Trig-free, so cross-engine bit-identical. Exact
  ray-vs-prism picking lives here too.
- **`src/town`** — the entire editable state: terrain bits, level bitmasks,
  per-voxel colors, timeOfDay. Undo/redo replays precise edit inversions.
  `serialize.ts` is the versioned binary share codec (deflate + base64url).
- **`src/arch`** — System B: walls with real cut openings and color-family
  window variants; roof *regions* (connected top-exposed cells per level ×
  roof kind) get a hip heightfield via multi-source Dijkstra from the region
  boundary, so ridges and valleys emerge from the footprint; a data-driven
  recipe layer (lighthouse/gardens/buntings) substitutes special builds;
  chunked incremental remeshing keeps edits ~3 ms.
- **`src/render`** — scene shell, damped camera, daylight rig (`evalDay(t)`
  keyframes drive sun, shadows, sky, fog, water colors, and the global
  window-emissive ramp), stylized water and sky-dome shaders.
- **`src/ui` / `src/app`** — chrome, time slider, input controller
  (tools, bulk gestures), IndexedDB autosave, URL share codes.

**Totality invariant:** any block/terrain/color configuration renders
something reasonable — unsupported blocks grow stilts, over-water blocks grow
pilings, failed patterns just render plain. The fuzz gate in `test/fuzz.test.ts`
enforces this and the determinism goldens on every run.

## License notes

Third-party: three.js, Vite, Vitest, TypeScript (MIT/Apache-2.0). All art is
procedurally generated in code; the palette is original. No Townscaper assets
are used or imitated beyond the (unprotectable, lovingly studied) mechanics.
