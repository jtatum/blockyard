# Known gaps vs. the Required spec (post-review register)

State as of 2026-07-14 (updated after the round-2 pass: curved outlines,
sun azimuth + readable nights, click-once tools, gulls/boats, ground props,
chimneys, per-color window kinds). What remains is feature work, ordered by
product impact. Spec references are to `01-product-spec.md`.

## Remaining Required-feature gaps

| Spec | Gap | Notes |
|------|-----|-------|
| §8 / A6 | **Archways, bridges, stairs, hook/crane recipes** missing (lighthouse, gardens, buntings shipped) | The recipe engine (`src/arch/recipes.ts`) is built for these — each is a predicate + sub-assembly, no engine work needed. Biggest remaining item. |
| P2 | **Multiple saved towns / gallery with thumbnails** | Only the single autosave slot exists. Needs an IDB store keyed by id + a gallery panel + thumbnail capture (the screenshot path can render thumbs). |
| U3/U4, §9 | **Settings panel** (quality, reduce-motion, reset) and **reduced-motion mode**; `prefers-reduced-motion` unrespected; build actions not keyboard-reachable | Water/inertia/day-cycle damping hooks all exist as parameters; needs the panel + a keyboard cursor for placement. |
| A7 | **Dormers** still missing (chimneys, street lamps, fences, flower beds landed in round 2) | Dormers need roof-surface-aware placement — a small follow-up to the heightfield. |
| T4 | **Cliff/quay/beach differentiation** at shorelines | Interim two-tone skirt shipped; per-edge seeded variants (beach slope, quay wall, cliff face) are the T3-look upgrade. |
| W2 | **Gently domed world** | Flat plane shipped. Cleanest path: a shared vertex-shader world-bend chunk injected into the few materials (solid, glass, water, terrain). |
| §2 | **Touch hardening** (P6 phase) | Tap-to-build/erase + orbit-safe drags + non-overlapping mobile UI landed; still needs device-lab testing, pinch tuning, and a mobile shadow tier. |
| §5.1 | **Perf at 2k+ blocks / mobile tier** | Desktop budgets comfortably met (edit ≈ 3–13 ms; idle shadow re-render eliminated). Worker offload + roof-region-scoped chunk rebuilds are the next levers if needed. |
| U5/§3.12 | Sound (client-open decision), PWA install | Explicitly optional/stretch; untouched. |

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
