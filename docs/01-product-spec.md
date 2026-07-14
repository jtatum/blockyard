# 01 — Product & Functional Specification

**Project:** Blockyard (working title) — Townscaper-style building toy
**Document owner:** Client
**Read after:** README.md · **Read before:** 02-technical-architecture.md

> **Scope stance (v1):** This is a **full, high-fidelity clone.** Every feature marked **Required** below is in scope and must ship — there is no reduced-tier or "massing-only" delivery. A small, clearly-labeled **Stretch** set is genuinely optional (bid separately). The art bar is **T3 "Indistinguishable" as the target, T2 "Charming" as the non-negotiable minimum** (see §7).

---

## 1. Product vision & design pillars

The product is a **toy, not a game.** There is no objective, score, timer, resource, or lose condition. Its entire value is the loop of *place a block → watch something charming appear → place another.* Every requirement serves three non-negotiable pillars:

1. **Immediacy.** From cold page load to placing the first block is seconds, with zero menus, tutorials, or accounts. One click does something delightful.
2. **Effortless beauty.** The user makes crude inputs (colored boxes); the system returns architecture that looks intentional and hand-built. The user should feel more talented than they are.
3. **Calm.** Soft light, gentle water, quiet interaction, no pressure, no notifications, no dark patterns. A fidget toy, not software.

Any feature that conflicts with these pillars is out of scope by default, however "cool" it sounds.

---

## 2. Target platforms & runtime

| Attribute | Requirement |
|-----------|-------------|
| Primary platform | Desktop web browser (Chrome, Edge, Firefox, Safari), latest 2 major versions |
| Rendering | WebGL2 via Three.js; graceful "unsupported browser" message if WebGL2 absent |
| Secondary platform | Tablet & mobile web (touch controls) — Required, hardened in P6 |
| Delivery | Static single-page web app; no server required for the core toy (see §6) |
| Install | None. Runs from a URL. Optional PWA "add to home screen" is Stretch |
| Offline | Core toy must work fully offline once loaded |
| Orientation | Landscape primary; portrait supported on mobile |

---

## 3. Feature list with priorities

Priorities: **R** = Required (must ship for v1) · **ST** = Stretch (optional, separately priced) · **W** = Won't (explicitly out of scope for v1).

### 3.1 The world, grid & terrain
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| W1 | Organic irregular quad grid | **R** | The signature look. Full spec in tech doc §2 |
| W2 | Gently domed/curved world (subtle horizon) | **R** | Adds charm; may be flat plane in early phases, curved by ship |
| W3 | Animated water plane with soft reflections/refraction | **R** | Stylized, not photoreal; calm motion |
| W4 | **Land vs. water base per cell** | **R** | Every base cell is land or water; both are valid ground. See §3.6 |
| W5 | **Terrain sculpting: dig down to water, or build land up** | **R** | Convert land↔water so expanding the buildable area is coherent; produces shorelines, canals, cliffs, beaches. See §3.6 |
| W6 | Expandable buildable area (grow the island/coast outward) | **R** | Large, growable world. True *infinite* streaming grid is Stretch (W-INF) |
| W7 | Soft ambient sky / gradient backdrop tied to time-of-day | **R** | Sets the calm mood; see lighting §3.7 |
| W-INF | Truly infinite streaming grid | **ST** | Nice; large-but-bounded world is acceptable for v1 |

### 3.2 Building interaction
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| B1 | Left-click empty cell → place a block at ground level | **R** | |
| B2 | Left-click on top of a block → stack a block above | **R** | Towers grow upward |
| B3 | Right-click a block → remove it (safely re-solve neighbors) | **R** | |
| B4 | New block adopts the currently selected color | **R** | |
| B5 | Click-drag to place/remove multiple blocks in one stroke | **R** | "Painting"; must feel smooth |
| B6 | Blocks may not float unsupported… unless architecture bridges/hooks them | **R** | Support/bridge/hook logic is emergent from tiles, not hard physics |
| B7 | Forgiving placement raycast (snaps to nearest sensible cell/face) | **R** | Interaction feel is first-class, not polish |

### 3.3 Bulk build tools
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| BB1 | **Line tool (1D):** click a start cell, drag to an end cell → fill a straight run of blocks between them | **R** | Follows grid adjacency along the straightest path; single undo step |
| BB2 | **Area/region tool (2D):** drag to fill a 2D region (a "line" widened, or a rubber-band area) of blocks on the current level | **R** | Batched solve so the frame rate holds mid-drag |
| BB3 | Bulk fill respects current color and current build level | **R** | |
| BB4 | Bulk **remove** variants of line/area tools | **R** | Symmetry with placement |
| BB5 | **Blueprint / stamp system** (save a structure, re-stamp it elsewhere) | **ST** | Genuinely hard on an irregular grid (cells don't map 1:1). Explicitly a stretch goal per client |

### 3.4 Procedural architecture (the "magic")
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| A1 | Adjacent same-level blocks fuse into continuous walls (no seams) | **R** | |
| A2 | Wall surfaces gain context-appropriate windows and doors | **R** | Doors low/near entrances; windows on upper walls; stencilled so never cut off |
| A3 | Tops become roofs (pitched, flat, stepped, hipped as fits) | **R** | |
| A4 | Ground-level open cells become cobbled plazas / paths / grass | **R** | |
| A5 | Enclosed courtyards become gardens (grass, hedges, fences, benches, trees) | **R** | High-priority recipe; see §3.5 for the color rule |
| A6 | Arches over openings; bridges joining separated masses | **R** | Emergent from tile constraints; large arches may show scaffolding |
| A7 | Adaptive props: chimneys, dormers, railings, bushes, lanterns | **R** | Scale/appear based on available surface geometry |
| A8 | Distinct landmark/special-build recipes | **R** | Includes color-triggered builds — see §3.5 |
| A9 | Architecture updates within a fraction of a second of any edit | **R** | Responsiveness target in §5.1 |
| A10 | Decoration applies as a fast second pass after structure resolves | **R** | Matches source "structure first, ornament a beat later" |

### 3.5 Color-driven architecture & special builds  *(a defining behavior — see the catalog in §8)*
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| CD1 | **Block color influences the generated art, not just tint** | **R** | Different colors → different roof/window/adornment variants |
| CD2 | Certain **color patterns trigger special structures** | **R** | Lighthouses, garden courtyards, flag buntings, etc. — full catalog §8 |
| CD3 | Adjacency of *differing* colors changes output | **R** | e.g. courtyards require differently-colored surrounds; flags hybridize by endpoint color |
| CD4 | Special builds appear automatically when their spatial+color precondition holds | **R** | No mode switch; emerges from normal building |

### 3.6 Land, water & terrain behavior *(expanded from §3.1)*
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| T1 | Choose a new base cell as **land** or **water** when expanding | **R** | A base-type brush/toggle |
| T2 | **Dig** a land cell down → becomes water (canal/harbor/moat) | **R** | Generates shoreline/quay edges automatically |
| T3 | **Raise** a water cell → becomes land (extend the island/coast) | **R** | Generates beach/cliff/retaining edges automatically |
| T4 | Shorelines, cliffs, beaches, and waterline trims generate automatically at land/water boundaries | **R** | Terrain is part of the procedural tile system, not separate art |
| T5 | Buildings sit correctly on both land and over-water pilings/quays | **R** | Over-water builds get appropriate footings |

### 3.7 Lighting & time of day  *(new, Required)*
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| L1 | **Time-of-day slider** controlling the sun's position across the sky | **R** | Continuous, smooth; the primary lighting control |
| L2 | Sun position drives **direction and length of shadows** | **R** | Dynamic shadows that move as the sun moves |
| L3 | Sun position drives **sky, ambient, and light color grading** | **R** | Midday neutral → warm **golden hour** near the horizon → dusk/night when set |
| L4 | **Golden-hour** state near the horizon (warm, long shadows) | **R** | Explicitly called out by client |
| L5 | **Sunset / night** state with the sun set | **R** | Darkened exterior |
| L6 | **Interior / window lighting** switches on when the sun is low/set | **R** | Windows glow warmly; buildings read as "lived-in" at night |
| L7 | Lighting state is saved with (or alongside) the town | **R** | So a shared scene reopens at its chosen time of day |
| L8 | Optional slow automatic day-cycle animation | **ST** | Ambient showcase mode |

### 3.8 Color palette
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| C1 | Curated palette of ~12–18 colors, always visible/one-tap | **R** | Curated palette is part of the aesthetic, not a full picker |
| C2 | Select color by clicking a swatch | **R** | |
| C3 | Select color by number/letter hotkeys | **R** | |
| C4 | Eyedropper: pick an existing block's color (Alt+click) | **R** | |
| C5 | Cycle palette with keys (e.g. `,` / `.`) | **R** | |
| C6 | Color is per-block and persists through re-solves | **R** | Editing geometry must never scramble existing colors |
| C7 | Swappable/alternate palettes (themes) | **ST** | Community-valued but not required for v1 |

### 3.9 Camera
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| CAM1 | Orbit around the build (drag) | **R** | |
| CAM2 | Zoom (scroll / pinch) | **R** | |
| CAM3 | Pan (right-drag / two-finger) | **R** | |
| CAM4 | Smooth inertia/damping on all camera motion | **R** | Central to the "calm" pillar |
| CAM5 | Sensible pitch clamps (can't flip under the world) | **R** | |
| CAM6 | Optional slow auto-rotate idle showcase | **ST** | |

### 3.10 History
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| H1 | Undo (Ctrl/Cmd+Z), multi-step | **R** | Covers block, bulk, terrain, and color actions |
| H2 | Redo | **R** | |
| H3 | History survives within a session; bounded stack depth | **R** | |

### 3.11 Persistence & sharing
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| P1 | Auto-save current town locally (survives reload/crash) | **R** | IndexedDB |
| P2 | Multiple saved towns / gallery with thumbnails | **R** | |
| P3 | Export town as a compact shareable code/URL | **R** | Deterministic re-load; includes terrain + lighting; tech §7 |
| P4 | Import town from code/URL | **R** | |
| P5 | Export a high-resolution screenshot (PNG) | **R** | The main "output" users share; respects current time-of-day |
| P6 | New / clear town (with confirm) | **R** | |
| P7 | Export the 3D model (glTF/OBJ) | **ST** | Power-user feature |

### 3.12 Onboarding & UI chrome
| ID | Feature | Pri | Notes |
|----|---------|-----|-------|
| U1 | Zero-modal first run — user can build immediately | **R** | Maybe one fading hint |
| U2 | Minimal, unobtrusive UI (palette, tool selector, time slider, a few icons); dims when idle | **R** | |
| U-GRID | **Grid/cell display:** hover-highlight of the target cell always on; toggle to **show the whole grid** (full cell overlay) | **R** | Townscaper has a show-the-whole-grid option; the clone matches it. Aids precise placement, bulk line/area aiming, and terrain editing |
| U3 | Settings: quality, palette, reduce-motion, reset, (sound if shipped) | **R** | |
| U4 | Accessibility: keyboard-navigable controls, reduced-motion mode, colorblind-friendly default palette | **R** | See §9 |
| U5 | Subtle sound design (place/remove, ambient) with mute | **ST** | Client to decide in/out (open decision) |

### 3.13 Explicitly out of scope for v1 (Won't)
- Multiplayer / real-time collaboration; user accounts, login, cloud sync, social feed.
- Monetization, ads, analytics beyond anonymous opt-out error logging.
- Native desktop/mobile app-store builds (web only for v1).
- In-app tileset/mod editor UI (the engine is data-driven, but no editor ships).
- Additional non-Scandinavian art themes beyond the one shipped style.
- Seasons/weather. (Time-of-day **is** in scope; weather is not.)

---

## 4. Detailed interaction behaviors (acceptance-level)

Testable statements; the QA plan derives cases from these.

**Placing / stacking / removing.** As before: a click adds/stacks/removes a block of the current color, snapped to the cell; affected architecture re-resolves within the responsiveness budget (§5.1); each action is one undo step. Towers reach ≥16 levels without breakage. Removing a supporting block never crashes; unsupported results fall back to a valid loose/hook/pilings tile.

**Bulk line (BB1).** Given a start cell and a drag to an end cell, when the stroke ends, then a straight run of blocks of the current color at the current level is placed along the grid path between the two cells, the whole run re-solves, and it is recorded as **one** undo step.

**Bulk area (BB2).** Given a rubber-band/area drag, then all covered cells on the current level are filled (or removed, if started on removal), with re-solves batched so frame rate does not collapse mid-drag, coalesced into one undo step.

**Terrain edit (T1–T4).** Given the base-type tool, when the user marks a land cell to dig, then that cell becomes water and its neighbors regenerate shoreline/quay geometry; when the user raises a water cell, it becomes land with beach/cliff edges. Terrain edits are undoable and never leave floating or cracked ground. Buildings already present adapt their footings to the new base.

**Time of day (L1–L6).** Given the time-of-day control, when the user moves it, then the sun's position, shadow direction/length, and sky/ambient color update continuously and smoothly; at low sun the scene reads as golden hour; past the horizon it reads as night, and window/interior lighting turns on. The chosen time is saved with the town (L7) and reflected in screenshots (P5).

**Color-driven art (CD1–CD4).** Given the same geometry, when the user changes a block's color (or builds with differing colors), then the *generated art can change*, not merely the tint — e.g. differently-colored enclosed surrounds yield a garden courtyard; a narrow tower with an alternating-color top yields a lighthouse lantern; buildings a short gap apart yield flag buntings whose colors derive from the two endpoints. Special builds appear automatically when their precondition holds, with **no** mode switch. (Exact trigger thresholds are specified in §8 and to be tuned against reference footage.)

**Color persistence & determinism.** Editing geometry never changes an existing block's color as a side effect. Given identical town data (grid seed + filled voxels + terrain + colors + lighting), the rendered result is byte-identical on every machine and release. No un-seeded randomness affects grid, tiles, decoration, or special builds. This is what makes shareable codes work.

**Undo fidelity.** Any sequence of block/bulk/terrain/color actions reverses exactly (geometry + terrain + colors + re-solved architecture) on Undo, and re-applies on Redo.

---

## 5. Non-functional requirements

### 5.1 Performance & responsiveness  *(client accepts the "Stretch" column as aspirational)*
| Metric | Target (desktop, mid-range 2022 laptop, integrated GPU) | Stretch |
|--------|--------|---------|
| Cold load to interactive | ≤ 4 s on broadband | ≤ 2.5 s |
| Frame rate orbiting a medium town (~500 blocks), dynamic shadows on | ≥ 60 fps | 60 fps at ~2,000 blocks |
| Frame rate on mobile (mid-range phone, ~300 blocks) | ≥ 30 fps | 60 fps |
| Edit → architecture visibly updated | ≤ 150 ms typical, ≤ 400 ms for large connected structures | ≤ 80 ms |
| Time-of-day slider drag | smooth (no hitching) as shadows update | — |
| Memory footprint, medium town | ≤ 500 MB | ≤ 300 MB |
| Max town size before graceful degradation | ≥ 2,000 blocks | ≥ 5,000 blocks |

"Graceful degradation" = frame rate may drop but the app must not crash, hang, or lose data. Dynamic shadows may drop to a cheaper mode on low-end devices (§tech 5/6) but must remain present at the Target tier.

### 5.2 Reliability
- No data loss: auto-save survives tab close, reload, and crash-recovery.
- **Solver totality:** for *any* configuration of blocks, terrain, and colors the user can create, the system produces a renderable result — no input yields an exception or infinite loop. Hard acceptance gate for P3.

### 5.3 Quality bar
- No visible z-fighting, cracks between tiles, flipped normals, or shadow acne at normal zoom.
- One coherent art direction, one material system, one lighting rig that reads correctly across the whole time-of-day range.
- 60 fps damped camera feel is a **correctness** requirement per the calm pillar.

---

## 6. Sharing model (no-backend default)

The core toy ships with **no server dependency.** Sharing encodes the entire town — grid seed, terrain (land/water), filled voxels, per-voxel colors, and lighting/time-of-day — into a compact URL-safe string (tech §7) that reconstructs the town deterministically on open. An **optional** thin backend (short-link + screenshot gallery) is **Stretch**, priced separately.

---

## 7. Art fidelity bar (decided)

The art *volume* is the main cost driver; the client has set the bar:

| Tier | Description | Role in this project |
|------|-------------|----------------------|
| **T3 — Indistinguishable** | Full decoration hierarchy, color-conditioned variants, special-build recipes, rich props, stencil windows, curved organic roofs, full terrain edges. Hard to tell from the original at a glance. | **Target** for v1 |
| **T2 — Charming** | Windows, doors, varied roofs, arches, gardens, core special builds, warm materials, core terrain edges. ~90% of the magic. | **Minimum acceptable** floor |
| ~~T1 — Massing~~ | Forms only, minimal ornament. | **Not acceptable** for v1 |

All bids target T3 and must not fall below T2. Estimates in the project plan assume a T3 target.

---

## 8. Color-driven & special-build catalog  *(Required content — CD1–CD4, A8)*

These behaviors are drawn from documented Townscaper community findings (see references in `04-contractor-brief.md` §11). **Exact thresholds are indicative and to be tuned against reference footage during design**, but the *set* of behaviors is Required. Each is a spatial+color pattern the solver/decoration layer recognizes and fulfills automatically.

| Build | Trigger (indicative) | Result | Color role |
|-------|----------------------|--------|-----------|
| **Lighthouse** | A narrow (single-cell) tower whose top ~3+ blocks **alternate between two colors** | Top becomes a windowed lantern/light housing; the tower reads as a striped lighthouse | The alternating color pair *defines* the stripe pattern; different pairs → different lighthouses |
| **Garden courtyard** | An open area **enclosed** by buildings of **differing colors** | Grass, hedges, fences, benches, small trees fill the courtyard | Requires *different* colors around the enclosure; the surrounding colors seed the little walls/fences |
| **Flag buntings** | Two buildings **~1 cell apart** (stretching up to ~2) | Strings of flags/bunting span the gap | Same-color endpoints → uniform flags; **different-color endpoints → hybrid/mixed-color flags** |
| **Archway** | Two masses with a roof spanning both plus the gap between | An arch forms in the gap; large spans may show scaffolding on top | Adjacent colors carry through the arch masonry |
| **Hook / crane** | A floating block bridged between two foundations with a single-cell gap and clearance in front | A hanging hook/crane appears | — (geometry-driven; color tints the structure) |
| **Stairs** | Two buildings on a foundation edge with a 1–2 cell gap between | A staircase generates in the gap | — |
| **Bridge** | Two separated masses at similar height across a short water/void gap | A connecting bridge generates | Endpoint colors carry across |
| **Color-conditioned trim** | Any wall/roof, per its block color | Roof style, window style, and adornments vary by color family | The core CD1 behavior — pervasive, not a discrete "build" |

**Implementation note for bidders:** these are not hard-coded one-offs. They are entries in a **data-driven recipe library** layered over the tile solver — spatial+color pattern matchers with priorities. The set above is the Required minimum; the tileset and recipe weights are tuned so they appear at a pleasing, non-spammy frequency. Getting the *color → art* conditioning right (CD1) multiplies the art volume, which is reflected in the P4 estimate.

---

## 9. Accessibility & inclusivity (target)
- Default palette distinguishable under common color-vision deficiencies.
- "Reduce motion" setting: damps water, disables auto day-cycle/auto-rotate/inertia, softens transitions.
- All primary actions (build, bulk, terrain, color, time-of-day) reachable by keyboard; visible focus states.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` where sensible.
- No reliance on color alone for any UI state.

---

## 10. Content & tone guardrails
- Family-friendly, universally calm. No public user-generated text surfaces in v1 (no chat, no public gallery naming).
- No collection of personal data. Any optional error telemetry is anonymous, opt-out, and documented.

---

*Continue to `02-technical-architecture.md`.*
