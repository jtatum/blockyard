# 04 — Contractor Brief & Bid Package (RFP)

**Project:** Blockyard (working title) — a Townscaper-style web building toy
**Client:** James
**Engagement type:** Fixed-scope, milestone-gated (T&M acceptable — see §3)
**Read after:** 03-project-plan.md · **Read with:** all four preceding documents

> This is the document you send to bidders along with the other four files. It tells a contractor exactly how to bid, what they're accountable for, and how they'll be chosen.

---

## 1. Summary for bidders

We are commissioning a **standalone, browser-based 3D building toy** in the spirit of Oskar Stålberg's *Townscaper*: an organic irregular grid over water and land, where clicking places colored blocks that a real-time procedural system turns into believable architecture. It is a calm, goal-less "toy," not a game.

**This is a full, high-fidelity clone — bids for a reduced/"massing" version will not be considered.** The art bar is **T3 "Indistinguishable" as the target, T2 "Charming" as the non-negotiable minimum** (product spec §7). Beyond the core toy, v1 **must** include:

- **Terrain** — land *and* water bases, with the ability to dig land down to water and raise water up to land (auto shorelines/cliffs/beaches).
- **Time-of-day lighting** — a sun-position slider driving dynamic shadows, sky/color grading from midday through golden hour to night, with **interior/window lighting** at dusk.
- **Bulk build** — line (1D) and area (2D) fill/remove tools. (A blueprint/stamp system is an explicit **stretch** goal, not required.)
- **Color-driven architecture** — block color changes the *generated art*, not just tint, and specific color patterns trigger special builds (lighthouses from alternating-color towers, garden courtyards from differently-colored surrounds, color-hybrid flag buntings, arches, hooks, stairs, bridges). Full catalog in product spec §8.

**This is not a trivial clone.** The project lives in three deep systems — the organic quad-grid generator, the marching-cubes + wave-function-collapse architecture solver (with a data-driven special-build recipe engine and color-conditioned art), and the real-time time-of-day lighting. Most effort is there and in the handcrafted 3D tile library. **Read the technical and product specs before bidding.** Bids that ignore the depth of §2–§3 of the technical architecture will not be considered.

---

## 2. What we are looking for in a contractor

### 2.1 Required skills / evidence (must demonstrate)
- **Three.js / WebGL2** production experience — shipped, performant 3D in the browser.
- **Procedural generation** — wave function collapse, constraint solving, marching cubes/squares, mesh generation, or comparable. **The single most important qualification.**
- **Real-time lighting & shaders** — dynamic shadows (cascaded shadow maps), day/night color grading, emissive materials. Required because of the time-of-day system.
- **TypeScript** at a professional level.
- **Real-time performance engineering** — instancing, workers, shadow budgeting, draw-call/GPU budgeting.
- **3D art capability** for a stylized, cohesive, **color-conditioned** tileset and terrain edges — *either* in-house (the team includes a technical environment artist) *or* a concrete, priced sourcing plan. A programmer-only bid must state explicitly how the T3 art bar (product §7 + §8) will be met.

### 2.2 Strongly preferred
- Prior work with grid/topology libraries (e.g. Sylves) or published WFC implementations.
- Stylized water / outline / lighting shader work.
- Shipped a web toy/game with a "feel"-critical camera or interaction.

### 2.3 Team shape
The plan assumes **one senior engineer + one technical 3D artist** in parallel. Solo bids are welcome but must prove **engineering, 3D art, and real-time lighting** capability; single-skill solo bids are scored down on risk (plan §7 R9). Small studios welcome.

---

## 3. Engagement & commercial model

- **Preferred:** fixed price **per milestone** (P0–P6 in the project plan), each with its own acceptance gate and payment.
- **Acceptable:** time-and-materials with a **not-to-exceed cap per milestone** and weekly burn reporting.
- **P0 is a separate, standalone contract** and a genuine go/no-go. We commission P0 first; full-build commitment follows only after the P0 gate and re-estimate. Price P0 firmly and provide a *provisional* P1–P6 estimate that P0 will refine.
- **Milestones gate payment, not scope.** Every Required feature ships; milestones exist for risk control and staged payment, not as places to drop functionality.
- **Stretch items** (blueprint/stamp, infinite streaming grid, glTF export, swappable palettes, sound, auto day-cycle) are quoted **separately** as optional line items.
- **Payment schedule:** tied to milestone acceptance (§5). No payment for a milestone until its acceptance criteria (plan §3) are demonstrated on a live build.
- **Change control:** the Required set and the T3/T2 art bar are the scope contract. Additions are written change orders with their own estimate.

---

## 4. What bidders must submit

Submit **all** of the following; a bid missing any item is incomplete.

1. **Per-milestone price and time** for P0–P6 (P0 firm; P1–P6 provisional-pending-P0), using the plan's phase structure, **plus** separate optional quotes for each Stretch item.
2. **Team composition & CVs/portfolios**, identifying who does engineering, 3D art, and lighting/shaders, with **links to relevant shipped work** (procedural generation, Three.js, and real-time lighting especially).
3. **A short technical response (2–4 pages)** to these questions:
   - How will you guarantee the **solver is total** (never crashes/hangs on any block/terrain/color input)?
   - How will you keep **edit-to-architecture latency within budget** on large towns?
   - How will you implement **color-driven art + the special-build recipe engine** (e.g. the lighthouse and garden-courtyard rules) while preserving **determinism**?
   - How will you deliver **time-of-day dynamic shadows** within the performance budget, including a mobile fallback?
   (We are evaluating whether you actually understand §2–§5 of the technical doc.)
4. **Art plan** — confirm you target T3 (min T2), your tileset-size assumptions **including color-conditioned variants and terrain edges**, and (if art is subcontracted) how it's sourced/priced.
5. **Assumptions, exclusions, and dependencies** you rely on.
6. **Proposed toolchain** and any deviations from the recommended stack (with justification).
7. **Availability & timeline**, start date, weekly capacity.
8. **References** (2+) from comparable work.

Optional but valued: a tiny **prototype or prior demo** touching any hard system (a WFC/grid-relaxation sketch, a color-triggered recipe, or a time-of-day shadow scene) — weighted heavily.

---

## 5. Deliverables & handoff standards (contractual definition of "done")

For each milestone and at final delivery, the contractor provides:

- **Source code** in a Git repository we own, clean history, meaningful commits.
- **Runnable build** on a preview URL for each weekly demo and each gate.
- **Documentation:** README/setup, ADRs, the **socket taxonomy + tile-authoring guide**, the **recipe-authoring guide** (how special builds/color rules are defined), and the **save-format spec** (incl. terrain + lighting).
- **Tests** per the QA plan (unit, fuzz/totality, golden-file determinism, visual at midday **and** night, E2E, perf) green in CI.
- **All source assets** — 3D models (editable source + exported glTF), textures, palette data, terrain-edge and emissive/night art, sounds if any — with confirmed original/commercial-safe provenance and an **asset-provenance log**.
- **`THIRD_PARTY.md` / SBOM** listing every dependency and license.
- **CI/CD pipeline** config and a documented one-command deploy.
- **No proprietary lock-in:** the client can build, run, and deploy independently after handoff.

**Final acceptance** = all Required features complete at the T3 target (never below T2); product §5 non-functional targets met on reference devices at midday and night; full QA suite green; docs and assets delivered; deploys from CI.

---

## 6. Intellectual property, legal & ethics

> Guidance to align expectations, **not legal advice.** Confirm specifics with your own counsel before launch.

- **IP ownership:** all code, assets, and docs are **works made for hire / assigned to the client** on payment (contractor keeps a portfolio-display license).
- **Clone boundaries:** game *mechanics and ideas* are generally not protected by copyright, but **names, logos, specific artwork, and overall trade dress are.** The contractor must deliver an **original name/branding and 100% original (or properly commercially-licensed) art, textures, sounds, and palette.** Copying Townscaper's assets or imitating its exact branding is prohibited and is grounds for rejection.
- **Third-party licenses:** only permissive/commercial-safe deps (MIT/BSD/Apache and similar). Any copyleft/ambiguous license must be flagged and approved in writing. Concepts may be learned from open-source references (e.g. MIT-licensed WFC/grid code) but prefer clean-room implementation; preserve required notices.
- **Data & privacy:** v1 collects no personal data. Optional telemetry must be anonymous, opt-out, disclosed, documented.
- **Content safety:** family-friendly; no public user-generated text surfaces in v1.

---

## 7. Bid evaluation & scoring

Scored out of 100. **Relevant capability outweighs price** — this project punishes under-qualified low bids severely.

| Criterion | Weight | What earns marks |
|-----------|--------|------------------|
| **Relevant portfolio** (procedural gen + Three.js + real-time lighting + 3D art) | **30** | Shipped, demonstrable work on the actual hard problems; a prototype touching one |
| **Technical response quality** (§4.3) | **20** | Real understanding of totality, performance, color-recipes, and shadows; not hand-waving |
| **Realism of estimate & plan** | **15** | Sensible per-milestone numbers; respects that P4 art (T3 + color-conditioning + terrain) dominates; no "few weeks flat" fantasies |
| **Team fit** (engineering + art + lighting covered; availability) | **15** | All three skills credibly covered; realistic capacity |
| **Price / value** | **15** | Value for money *given* qualification — not lowest absolute |
| **Communication & references** | **5** | Clear writing, responsive, solid references |

**Automatic red flags** (score heavily or disqualify): claims of a full clone in a handful of weeks; no procedural-generation evidence; no plan for dynamic shadows/time-of-day; no plan for color-driven art/special builds; no plan for the T3 3D art; proposing to reuse Townscaper's assets.

---

## 8. Process & timeline for the bid itself
1. Send this package (all five files) to shortlisted bidders.
2. **Q&A window** (~1 week); answers shared with all bidders.
3. Bids due; evaluate against §7.
4. Shortlist 1–2 for a call to walk through their technical response.
5. **Commission P0 only** with the leading bidder; reassess at the P0 gate before committing to P1–P6.

---

## 9. Assumptions, exclusions & open decisions

**Assumptions baked into this package:**
- Target is **web (Three.js/WebGL2)**, desktop-first, mobile Required (may run reduced shadows).
- Art bar **T3 target / T2 minimum** — fixed, not a per-bid choice.
- Full scope includes terrain, time-of-day lighting, bulk build, and color-driven architecture.
- No backend required for v1 (share-by-code, includes terrain + lighting). Optional short-link/gallery backend is separately priced.
- Recommended team is engineer + technical artist (with lighting/shader skill covered).

**Explicit exclusions (Won't, v1):** multiplayer, accounts/cloud sync, monetization, native app-store builds, in-app tileset/mod editor, additional art themes, seasons/weather. (Time-of-day **is** in; weather is out.) Full list in product spec §3.13.

**Stretch (optional, separately priced):** blueprint/stamp system, truly infinite streaming grid, glTF export, swappable palettes, sound design, auto day-cycle animation, PWA install.

**Open decisions for the client before/at bidding:**
1. **Final name & branding** (replaces "Blockyard") — needed for repo, URLs, save codes.
2. **World model** — large-but-bounded expandable world (assumed) vs. truly infinite streaming grid (Stretch).
3. **Optional backend** — share-by-code only (default) vs. add short-links + gallery.
4. **Sound design** — in or out for v1 (Stretch).
5. Which **Stretch** items (if any) to fund alongside the core.

---

## 10. Glossary (shared vocabulary for bids)

- **Cell / quad** — one four-sided tile of the irregular grid; the unit footprint of a block.
- **Base type (land/water)** — each ground cell is land or water; both buildable; convertible by dig/raise.
- **Voxel** — a filled `(cell, level)` slot; the raw thing a click creates.
- **Corner tile** — a quarter-cell mesh piece chosen per grid-vertex neighborhood; the actual rendered geometry (not cubes).
- **Socket** — a profile descriptor on a tile face (incl. terrain profiles: shore, cliff, beach, quay, piling); two tiles may abut iff facing sockets match. The WFC constraint alphabet.
- **Marching cubes (variant)** — selecting a mesh per corner from surrounding voxel occupancy.
- **Wave function collapse (WFC)** — constraint propagation assigning one compatible tile per corner so sockets agree, biased by weights (and by color, per CD1).
- **Recipe** — a data-driven special build defined by a spatial+color predicate + a curated sub-assembly (lighthouse, garden courtyard, flag buntings, arch, hook, stairs, bridge).
- **Color-conditioning (CD1)** — block color selects art *variants* (roof/window/trim), not just tint.
- **Totality** — the guarantee the solver produces a valid render for *any* input (blocks/terrain/color), never crashing/hanging.
- **Relaxation** — iterative smoothing making each quad near-square: the organic-but-well-conditioned grid.
- **Time-of-day** — a single parameter driving sun direction, dynamic shadows, sky/color grade, and night interior lighting.
- **Determinism** — same town data (grid seed + terrain + voxels + colors + timeOfDay) ⇒ byte-identical render everywhere; basis for shareable codes.
- **Art tier (T2/T3)** — Charming / Indistinguishable fidelity (product §7); T3 target, T2 floor.

---

## 11. References (background reading for bidders)

Public write-ups and talks describing the techniques this project uses — **conceptual references, not code/assets to copy.**

- Oskar Stålberg — *"Organic Towns from Square Tiles"* (IndieCade Europe 2019) and *"Beyond Townscapers"* (SGC 2021) talks — the source-of-truth on the grid + WFC approach.
- *"How Townscaper Works: A Story Four Games in the Making"* — Game Developer — the marching-cubes + WFC + irregular-grid synthesis and decoration/recipe hierarchy.
- Boris the Brave — *Sylves* grid library docs, "Townscaper Grid" tutorial — the hex→merge→subdivide→relax pipeline + adjacency (MIT).
- andersource — *"Generating an organic grid"* — the relaxation math (best-fit-square, closed-form rotation) with derivation.
- mxgmn — *WaveFunctionCollapse* reference implementation + README (MIT) — canonical WFC.
- Townscaper community guides on color-driven builds (lighthouses via alternating colors, garden courtyards from differing colors, flag buntings, arches, hooks, stairs) — the basis for the special-build catalog (product §8). *(URLs collected in the delivery message accompanying this package.)*

---

*End of bid package. Files: README.md · 01-product-spec.md · 02-technical-architecture.md · 03-project-plan.md · 04-contractor-brief.md*
