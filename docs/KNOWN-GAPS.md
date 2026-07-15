# Known gaps vs. the Required spec (post-review register)

State as of 2026-07-14 (updated after the round-4 pass: archways with
wall/pier supports and arcade-bridge under-structure, beach stairways,
placed-block small/large staircases with Townscaper triggers). What remains
is feature work, ordered by product impact. Spec references are to
`01-product-spec.md`.

## Remaining Required-feature gaps

| Spec | Gap | Notes |
|------|-----|-------|
| §8 / A6 | **Hook/crane recipe** missing (lighthouse, gardens, buntings, stairs, archways, beach stairways shipped) | Townscaper rule: a floating block above a one-wide gap between two protruding foundations grows a hook. The recipe engine (`src/arch/recipes.ts`, with `src/arch/arches.ts`/`stairs.ts` as templates) is built for it. Bridges got their arcade under-structure via arches; deck railings, lamps, and the "scaffolding on 2+-wide archways" dressing remain. |
| P2 | **Multiple saved towns / gallery with thumbnails** | Only the single autosave slot exists. Needs an IDB store keyed by id + a gallery panel + thumbnail capture (the screenshot path can render thumbs). |
| U3/U4, §9 | **Settings panel** (quality, reduce-motion, reset) and **reduced-motion mode**; `prefers-reduced-motion` unrespected; build actions not keyboard-reachable | Water/inertia/day-cycle damping hooks all exist as parameters; needs the panel + a keyboard cursor for placement. |
| A7 | **Dormers** still missing (chimneys, street lamps, fences, flower beds landed in round 2) | Dormers need roof-surface-aware placement — a small follow-up to the heightfield. |
| T4 | **Cliff/quay/beach differentiation** at shorelines | Interim two-tone skirt shipped; per-edge seeded variants (beach slope, quay wall, cliff face) are the T3-look upgrade. |
| W2 | **Gently domed world** | Flat plane shipped. Cleanest path: a shared vertex-shader world-bend chunk injected into the few materials (solid, glass, water, terrain). |
| §2 | **Touch hardening** (P6 phase) | Tap-to-build/erase + orbit-safe drags + non-overlapping mobile UI landed; still needs device-lab testing, pinch tuning, and a mobile shadow tier. |
| §5.1 | **Perf at 2k+ blocks / mobile tier** | Desktop budgets comfortably met (edit ≈ 3–13 ms; idle shadow re-render eliminated). Worker offload + roof-region-scoped chunk rebuilds are the next levers if needed. |
| U5/§3.12 | Sound (client-open decision), PWA install | Explicitly optional/stretch; untouched. |

## Guide-derived wishlist (Rosy's "Definitive Guide to Townscaper", Steam id 2186511914)

Reviewed 2026-07-14 against the shipped toy. Tricks the reference game
generates that Blockyard doesn't yet, roughly ordered by charm-per-effort:

| Trick | Townscaper trigger | Status here |
|-------|--------------------|-------------|
| **Spire** | An uninterrupted 1-wide, 2-tall tower at the top of a building gets a spire | Missing — nice small recipe (cone roof exists as the template) |
| **X-house** | An X-shaped footprint grows a spire at the intersection | Missing |
| **Overhanging balcony** | A block over open water above a building edge becomes a balcony | Missing — floating blocks get caps/posts (or arches now) |
| **Stone walls** | An empty gap between two buildings on grass grows a low stone wall, sometimes with gates/small arches | Missing — ground-prop fences are random charm, not this rule |
| **Fancy doorway** | A 1-cell dent in a wall becomes a framed doorway; a 2-cell dent adds a roof lamp | Missing |
| **Door tunnel interior** | A tunnel through a building (≥1 taller than the opening) gets an interior door + lamp | Partially — tunnels now arch, but no interior dressing |
| **Door to garden** | A 2-tall, 3-wide wall with the bottom middle missing keeps the garden alive with a doorway | Missing — any hole still dissolves our gardens |
| **Stone paths (+X monument)** | Parallel garden doors create straight paths; crossing paths grow a monument | Missing |
| **Grassy island** | Ringing an entire island with one building turns the interior grassy | Missing — our garden rule needs ≥2 wall colors and ≤14 cells |
| **Bird perching** | Birds land on roofs/scaffolding and fly off when displaced | Gulls only orbit; no landing behavior |
| **Butterflies** | Spawn over grassy areas, despawn with them | Missing |
| **Door-step props** | Boots, chairs, mailboxes, bins, beehives, wall lights keyed to doors/benches | Missing — our ground props aren't door-aware |
| **Binoculars** | Appear on balcony edges that have a door | Blocked on balconies |
| **Clothes lines** | 1-wide gap between walls → hanging laundry, colors from the buildings | Shipped as flag buntings (endpoint-colored) — close cousin |
| **Wide-archway scaffolding** | Archways ≥2 cells wide get scaffolding on top | Missing (arches ship per-cell) |
| GSS 3/5/6 cells | Tri/penta/hexagonal grid cells from irregular vertices | Out of scope — our grid is quad-only by design (tech doc §2.3) |

## Accepted deviations (deliberate, argued in-session)

- **W3 "soft reflections/refraction"** — the water is stylized (fresnel
  deep/shallow blend + sun glint + wave normals), no render-target
  reflections. Calm look holds on mobile; real reflections are a quality
  dial to revisit in a perf pass.
- **T3 art bar** — all art is procedural/code-generated targeting T2
  "Charming". The data-driven structure means hand-authored glTF tiles can
  replace generated geometry without re-engineering (the spec's own scaling
  story).
- **Palette CVD-safety (U4)** — 15 distinct hues can't be fully
  colorblind-safe pairwise; palette names appear on hover/tap. A
  deuteranopia-tuned alternate palette is the right fix (C7 made Required-adjacent).

## Test debt

- `src/app/input.ts` (gestures, bulk tools) has no targeted unit tests —
  verified interactively; mutation-tested blind spot per the review.
- Recipes lack direct unit tests (they're exercised via goldens only).
