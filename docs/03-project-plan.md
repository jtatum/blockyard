# 03 — Project Plan, Work Breakdown & Estimates

**Project:** Blockyard (working title) — Townscaper-style building toy
**Read after:** 02-technical-architecture.md

> **Scope stance:** this plan is for the **full, high-fidelity clone** (art bar T3 target / T2 minimum). There is no reduced-scope delivery; every **Required** feature in the product spec ships. Milestones are used for **payment gating and risk control**, not as places to drop scope. The only optional work is the clearly-labeled **Stretch** items (blueprint/stamp, infinite streaming grid, glTF export, swappable palettes, sound, auto day-cycle), which are bid separately.

> **How to read the estimates.** Effort is in **engineering-days (ed)** and **calendar weeks**, assuming the recommended team of **one senior gameplay/graphics engineer (ENG) + one technical 3D/environment artist (ART)** working in parallel. Ranges reflect real uncertainty; the low end assumes a specialist who has shipped procedural-generation *and* real-time-lighting work, the high end a strong generalist meeting these systems for the first time. Estimates assume a **T3 art target** (product §7) and include the added scope: terrain, time-of-day lighting, bulk build, color-driven art, and the special-build recipe library. **Anchors for comparing bids, not a mandate** — the point of P0 is to replace guesses with measurements.

---

## 1. Delivery strategy

- **Milestone-based, gated delivery.** Each phase ends with a demo build, a deliverables checklist, and explicit **acceptance criteria.** The client approves each gate before the next begins. This bounds risk without reducing scope.
- **P0 is a standalone paid engagement** and a genuine **go/no-go**: it proves the hard systems (grid, solver, recipe engine, terrain-in-solver, determinism, dynamic lighting) are feasible for the budget *before* the full build is committed. P0's only "off-ramp" is *don't proceed / re-plan* — not "ship something smaller."
- **Vertical slices, always runnable.** By end of P2 the client can build with colored blocks, bulk tools, and terrain under a live time-of-day sun; every later phase enriches an already-playable toy.
- **Weekly demo build** (live URL) throughout.

---

## 2. Milestones at a glance

| Phase | Name | Reference effort | Calendar (team) | Gate deliverable |
|-------|------|------------------|-----------------|------------------|
| P0 | Discovery & de-risking spikes | 12–18 ed | 3–4 wks | Grid + solver + recipe-engine + terrain + lighting spikes proven; refined estimate; go/no-go |
| P1 | Grid, terrain, engine & lighting foundation | 20–32 ed | 4–6 wks | Organic grid + land/water on water, time-of-day sun with dynamic shadows, camera, grid display |
| P2 | Core building & bulk & terrain interaction | 20–28 ed | 4–5 wks | Place/stack/remove + line/area bulk tools + dig/raise terrain + colors + undo |
| P3 | Procedural architecture (base) | 28–45 ed | 6–9 wks | Blocks→buildings (minimal tileset), color-as-input + recipe-engine scaffold, terrain edges, solver total |
| P4 | Full tileset, color-driven art & special builds | 60–110 ed | 12–22 wks | T3 art: windows, roofs, arches, bridges, gardens, props, color-conditioned variants, lighthouse/garden/flags/hooks/stairs recipes, shore/cliff/beach edges, night interiors |
| P5 | Save/share/export & UX polish | 18–26 ed | 4–5 wks | Persistence, shareable codes (incl. terrain+lighting), gallery, screenshots, time-of-day UI, full chrome |
| P6 | Performance, platforms & hardening | 22–34 ed | 5–7 wks | Mobile/tablet, cross-browser, shadow perf tuning, perf targets, a11y, launch-ready |
| | **Total** | **~180–290 ed** | **~7–12 months** | Shipped v1 |

**Solo generalist** (one person coding + modeling, no parallelism, now also doing lighting + terrain + recipe art): expect **~12–18 months** and elevated art/lighting risk — scrutinize solo bids for *all* of engineering, 3D art, and real-time lighting.

---

## 3. Work breakdown structure (per phase)

Owner (ENG/ART), rough size, rolling up to the phase estimate.

### P0 — Discovery & de-risking spikes  *(12–18 ed)*
Prove the hard systems before committing the full budget.

| Task | Owner | Size |
|------|-------|------|
| P0.1 Grid spike: hex→merge→subdivide→relax; all-quads, no degenerates, deterministic, chunk-seam continuity | ENG | 4–6 ed |
| P0.2 Solver spike: corner-decomposition + local WFC on a tiny placeholder tileset; prove **totality** + incremental re-solve | ENG | 4–6 ed |
| P0.3 **Terrain-in-solver spike:** land/water base sockets, dig/raise a cell, auto shoreline regen | ENG | 1–2 ed |
| P0.4 **Recipe-engine spike:** implement one color-predicate recipe end-to-end (lighthouse: narrow tower, alternating-color top) to prove the pattern + determinism | ENG | 1–2 ed |
| P0.5 **Lighting spike:** time-of-day sun + dynamic shadows + night emissive on a placeholder scene; confirm perf headroom | ENG | 1–2 ed |
| P0.6 Socket-taxonomy draft (incl. terrain profiles) + tile-authoring pipeline test (author 1 corner set Blender→glTF→engine) | ENG+ART | 1–2 ed |
| P0.7 Findings + **re-estimate** of P3/P4 with real data; go/no-go | ENG | 1 ed |

**Gate/acceptance:** throwaway demos show (a) deterministic organic grid; (b) place/remove re-solving a placeholder tileset with zero crashes under a fuzz test; (c) digging/raising a cell regenerating a shoreline; (d) a working lighthouse from an alternating-color tower; (e) a scrubable sun with moving shadows and window glow at night. A findings doc updates P3/P4 estimates. *If any pillar proves infeasible for the budget, stop/re-plan here — for ~3–4 weeks, not the whole project.*

### P1 — Grid, terrain, engine & lighting foundation  *(20–32 ed)*
| Task | Owner | Size |
|------|-------|------|
| P1.1 Productionize grid generator: chunks, world bounds, dome projection, baked adjacency | ENG | 5–8 ed |
| P1.2 **Terrain foundation:** per-cell land/water base data model, base-render, world-expansion plumbing | ENG | 3–5 ed |
| P1.3 Camera rig with damped orbit/zoom/pan, pitch clamps (feel pass) | ENG | 3–5 ed |
| P1.4 Stylized water + terrain-reactive shoreline + sky/backdrop | ENG/ART | 3–5 ed |
| P1.5 **Time-of-day lighting foundation:** sun rig, dynamic (cascaded) shadows, sky/ambient grading, night emissive uniform | ENG | 4–7 ed |
| P1.6 Ray-picking: pointer → (cell, level, face); grid-display overlay + hover highlight | ENG | 2–4 ed |
| P1.7 App shell, dirty-driven render loop, seeded-RNG utility + lint rule | ENG | 2–4 ed |

**Gate/acceptance:** an organic island of land and water floats on animated water; a time-of-day slider moves the sun with correct shadow direction/length and a golden-hour→night color shift with window glow; camera orbits smoothly; grid overlay toggles; the grid is byte-identical across reloads/machines for a given seed.

### P2 — Core building, bulk & terrain interaction  *(20–28 ed)*
| Task | Owner | Size |
|------|-------|------|
| P2.1 Town voxel state + place/stack/remove commands | ENG | 3–4 ed |
| P2.2 **Bulk tools:** line (BB1) and area (BB2) place/remove, batched solve, one undo step each | ENG | 4–6 ed |
| P2.3 **Terrain edit tools:** dig land→water, raise water→land; base-type brush; undoable | ENG | 3–5 ed |
| P2.4 Render blocks as simple instanced cubes (pre-architecture), per-voxel color | ENG | 2–4 ed |
| P2.5 Undo/redo command stack across block/bulk/terrain/color; drag coalescing | ENG | 3–4 ed |
| P2.6 Color palette UI + selection (click, hotkeys, eyedropper, cycle) | ENG/ART | 3–4 ed |
| P2.7 Autosave scaffold (IndexedDB), new/clear town, first-run hint | ENG/ART | 2–3 ed |

**Gate/acceptance:** the client can place, stack, drag-paint, line-fill, area-fill, and remove colored blocks; dig canals and raise land; undo/redo is exact across all action types; colors persist through edits; reload restores the town (incl. terrain). First genuinely *playable* build.

### P3 — Procedural architecture, base  *(28–45 ed — re-estimated after P0)*
| Task | Owner | Size |
|------|-------|------|
| P3.1 Lock socket taxonomy (incl. terrain profiles); formalize tile + recipe manifest schema | ENG | 3–5 ed |
| P3.2 Corner-decomposition + marching lookup (occupancy → candidate tiles) | ENG | 4–7 ed |
| P3.3 Local WFC solver: propagation, weighted collapse, seeded tie-break | ENG | 6–10 ed |
| P3.4 **Totality:** fallback-tile design covering every occupancy + terrain pattern; fuzz harness | ENG | 3–5 ed |
| P3.5 **Color-as-input + recipe-engine scaffold:** color-family variant weighting hook; priority pattern-match/substitute pipeline with ≥2 recipes (lighthouse, garden) | ENG | 4–7 ed |
| P3.6 Incremental dirty-region re-solve + worker offload (incl. terrain edits) | ENG | 4–7 ed |
| P3.7 Mesher: tile assignment → instanced batches, per-instance color, emissive channel | ENG | 3–5 ed |
| P3.8 Minimal coherent tileset (walls, floors, flat/pitched roof, ground, basic shore/water edge) end-to-end | ART | 3–5 ed |

**Gate/acceptance:** placing blocks produces continuous walls and simple roofs (no seams); land/water edges render correct shorelines; a working lighthouse and garden-courtyard prove the recipe engine; removing blocks and editing terrain re-solve safely; a **10k-random-edit fuzz test (blocks + terrain + colors) produces zero exceptions/hangs**; edits on a ~500-block town update within the responsiveness budget.

### P4 — Full tileset, color-driven art & special builds  *(60–110 ed — the cost driver)*
| Task | Owner | Size |
|------|-------|------|
| P4.1 Full wall set + **color-conditioned variants**: windows/doors/corners/half-levels per color family (stencil/decal windows) | ART+ENG | 14–24 ed |
| P4.2 Full roof set + color-conditioned variants: pitched, stepped, hipped, ridges/valleys, trims | ART+ENG | 10–18 ed |
| P4.3 Arches & bridges spanning gaps/water | ART+ENG | 6–11 ed |
| P4.4 Ground/plaza/path/grass + **terrain edges** (shore, cliff, beach, quay, over-water pilings) | ART+ENG | 8–14 ed |
| P4.5 **Garden recipe** (enclosed + *differing-color* detection → grass/hedges/fences/benches/trees) | ENG+ART | 5–9 ed |
| P4.6 **Special-build recipes:** lighthouse (alternating-color), flag buntings (color-hybrid), hooks, stairs, bridges | ENG+ART | 8–15 ed |
| P4.7 Adaptive props (chimneys, dormers, railings, bushes, lanterns) scatter system | ENG+ART | 4–8 ed |
| P4.8 **Night interiors art:** emissive windows/lanterns tuned across the time-of-day range | ART+ENG | 3–6 ed |
| P4.9 Landmark/monument recipes | ART+ENG | 3–7 ed |
| P4.10 Material/texture pass (brick/stone), outline pass, weight tuning for pleasing frequency of specials | ART+ENG | 5–10 ed |

**Gate/acceptance:** matches the T3 target — a medium town of land, water, and mixed-color buildings is charming and hard to distinguish from the source at a glance; **color changes the art, not just the tint** (red vs green houses differ); lighthouses, gardens, flags, arches, hooks, stairs, and bridges appear correctly from their color/spatial triggers; shorelines/cliffs/beaches read well; windows glow at night; no cracks/z-fighting/flipped normals/shadow acne at normal zoom across the full sun range. (Cut order if over budget, by client agreement: landmarks → extra prop variants → extra roof variants — **not** the color-conditioning or the core specials.)

### P5 — Save/share/export & UX polish  *(18–26 ed)*
| Task | Owner | Size |
|------|-------|------|
| P5.1 Compact versioned save codec (voxels + **terrain** + colors + **timeOfDay**) + base64url share codes; import/export; golden-file determinism tests | ENG | 6–9 ed |
| P5.2 Town gallery (save/load multiple), thumbnails | ENG | 3–4 ed |
| P5.3 High-res screenshot/PNG export (respects current time-of-day); optional glTF export *(Stretch)* | ENG | 2–4 ed |
| P5.4 Time-of-day UI polish; settings (quality, palette, reduce-motion, reset); full chrome polish | ENG/ART | 4–6 ed |
| P5.5 Optional sound design (ambient + place/remove) with mute *(Stretch)* | ART | 2–3 ed |

**Gate/acceptance:** a town round-trips losslessly through a shareable code on a different machine/browser — same geometry, terrain, colors, **and** time-of-day; screenshots export at high res at the chosen lighting; settings work; determinism golden tests pass.

### P6 — Performance, platforms & hardening  *(22–34 ed)*
| Task | Owner | Size |
|------|-------|------|
| P6.1 Touch controls + responsive UI (bulk/terrain/time-of-day usable on touch) | ENG | 5–7 ed |
| P6.2 Cross-browser matrix (Chrome/Edge/Firefox/Safari ×2) + WebGL2 fallback message | ENG | 3–5 ed |
| P6.3 Perf pass to hit §5.1: instancing/chunking/LOD/worker + **shadow tuning & mobile shadow fallback**; profile at midday & night | ENG | 7–10 ed |
| P6.4 Accessibility pass (keyboard, reduce-motion incl. day-cycle/water, colorblind palette, focus) | ENG/ART | 3–5 ed |
| P6.5 Full QA sweep, bug-fix buffer, anonymous opt-out error telemetry | ENG | 4–6 ed |
| P6.6 Docs, handoff, deploy pipeline, launch | ENG | 2–3 ed |

**Gate/acceptance:** all product §5.1 targets met on reference devices at both midday and night; works across the browser matrix; mobile playable with graceful shadow fallback; accessibility checklist passed; handoff docs complete; deploys from CI.

---

## 4. Cross-cutting workstreams (through all phases)
- **CI/CD** from P1: lint, typecheck, unit tests, visual snapshots (at midday **and** night), perf smoke test, preview deploy per PR.
- **Determinism guarding** from P1: golden-file tests (incl. terrain + lighting + special builds) grow each phase; any diff fails CI.
- **Weekly demo build** to a live URL regardless of phase.
- **Docs as you go:** ADRs, socket + **recipe** authoring guide, save-format spec.

---

## 5. Dependencies & critical path

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6
             │            ▲
             └─ ART builds authoring pipeline + terrain/lighting-conformant test tiles from P3, ramps hard in P4
```

- **Critical path runs through the solver+recipe engine (P3) and art volume (P4).** Color-conditioning and terrain edges *multiply* P4 art, which is why P4's range is the widest and dominates the schedule.
- ART begins the authoring pipeline and socket/terrain-conformant tiles during P0/P3, then runs near-full-time in P4 in parallel with ENG's recipe/decoration code — the source of the team-vs-solo gap.
- P5/P6 are largely ENG and can overlap the tail of P4.

---

## 6. Testing & QA plan

| Layer | Tooling | What it covers |
|-------|---------|----------------|
| **Unit** | Vitest | Grid invariants (all-quads, no degenerates, determinism); terrain dig/raise; solver purity; recipe predicates; save codec round-trip (incl. terrain+lighting); RNG determinism |
| **Property/fuzz** | Vitest + custom | **Totality gate:** tens of thousands of random block/bulk/terrain/color sequences never throw/hang and always render |
| **Golden-file / determinism** | Vitest + hashing | Fixed town codes render to identical geometry hashes across runs/machines/releases — including special builds and terrain |
| **Visual regression** | Playwright screenshots | Reference towns at **midday and night**, pixel-diff gate |
| **E2E interaction** | Playwright | place/stack/remove/undo/redo, line/area bulk, dig/raise terrain, color select, time-of-day scrub, save→share→import round-trip |
| **Performance** | Automated perf harness | Frame time + edit-latency budgets on the perf town each milestone, profiled at midday and night; regressions fail CI |
| **Cross-browser/device** | Manual matrix + cloud device lab | P6 sign-off across support matrix + reference mobile |
| **Accessibility** | axe + manual | Keyboard nav, reduce-motion, colorblind palette, focus states |

**Definition of Done (every task):** meets acceptance criteria; unit/visual/perf tests green; determinism golden tests unaffected or intentionally updated; documented; demoed in the weekly build.

---

## 7. Risk register

| Ref | Risk | Likelihood | Impact | Mitigation | Trigger/contingency |
|-----|------|-----------|--------|------------|---------------------|
| **R1** | Grid relaxation unstable / degenerate quads | Med | High | P0.1 spike; pin boundaries; cap step size; degeneracy repair | If unfixable, milder deformation of a regular grid — decide at P0 |
| **R2** | Solver not total — some input throws/hangs | Med | **Very High** | Fallback tiles for every occupancy+terrain pattern; big fuzz harness gates P3 | Totality is a hard gate, not polish |
| **R3** | Re-solve too slow on large towns | Med | High | Dirty-region locality + worker + instanced chunked meshing; perf town in CI from P3 | Cap town size / decoration LOD on low-end |
| **R4** | **Tileset art volume balloons** — T3 + color-conditioning + terrain edges multiply variants | **High** | **High** | Data-driven tiles + recipes; color-*family* buckets (not per-hue); defined cut order (landmarks→prop variants→roof variants, never color-conditioning/core specials) | Client agrees cuts at the P4 mid-review; result still ≥T2 |
| **R5** | Socket taxonomy (incl. terrain) wrong → rework | Med | High | Lock + stress-test taxonomy in P0.6/P3.1 before authoring the full set | Post-P4 taxonomy change = formal change order |
| **R6** | Mobile/low-end performance shortfall | Med | Med | Perf gates each milestone; quality settings; LOD; reduce-motion | Degrade gracefully; mobile is Required but may run reduced shadows |
| **R7** | Scope creep beyond the Required set | High | Med | Product spec R/ST/W list is the contract; Stretch is separately priced; change-order process | Discipline at gates |
| **R8** | Legal/IP — accidental similarity to protected assets/branding | Low | High | Original name + original art from day one; brief §6; asset-provenance log | Run name/branding past counsel before launch |
| **R9** | Contractor gap in engineering *or* art *or* lighting | Med | High | Prefer a team; scrutinize solo portfolios for all three; consider splitting ENG/ART contracts | Split contracts if needed |
| **R10** | Determinism drift breaks old share codes | Low | Med | Versioned save + golden-file tests from P5 | Keep legacy decoders; never silently change generation for a shipped version |
| **R11** | **Dynamic shadows / time-of-day too costly**, esp. mobile | Med | Med | Tiered shadow quality; re-render shadow map only on change; night = global emissive uniform | Reduced shadow mode on low-end; look preserved |
| **R12** | **Color-driven art & special recipes explode combinatorially** | Med | Med | Color-family buckets; recipes as bounded data-driven predicates; tune frequency; catalog is fixed (product §8) | Cap variant count per color family |

---

## 8. Suggested schedule shape (team of 2, T3 target)

| Month | Focus |
|-------|-------|
| 1 | P0 spikes + gate |
| 2 | P1 grid/terrain/lighting foundation |
| 3 | P1 finish + P2 building/bulk/terrain interaction |
| 4 | P3 solver + recipe-engine core |
| 5 | P3 finish (totality gate); ART ramps into P4 |
| 6–8 | P4 tileset, color-driven art, special builds, terrain edges, night interiors (art-heavy) |
| 9–10 | P4 finish + P5 save/share/polish |
| 11–12 | P6 performance/platforms/hardening → launch |

Compresses toward ~7–8 months with a strong specialist pair; stretches toward 12+ with a single generalist or heavy T3 ornament.

---

*Continue to `04-contractor-brief.md`.*
