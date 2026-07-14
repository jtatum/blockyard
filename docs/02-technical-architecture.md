# 02 — Technical Architecture

**Project:** Blockyard (working title) — Townscaper-style building toy
**Audience:** The implementing engineer(s). Assumes comfort with 3D math, meshes, and constraint solving.
**Read after:** 01-product-spec.md

> This document specifies **an** architecture known to be sufficient. A contractor may propose a different-but-equivalent approach in their bid, but they must show it meets the same acceptance criteria (especially determinism, totality of the solver, and the performance budget). The two deep systems — the **irregular grid** (§2) and the **procedural architecture solver** (§3) — are where the project lives or dies. Everything else is conventional web-3D work.

---

## 1. Stack, tooling & conventions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | **TypeScript** (strict mode) | Type safety is essential across the grid/solver data structures |
| 3D engine | **Three.js** (latest stable) on **WebGL2** | Client requirement; mature, well-documented, huge ecosystem |
| Build tooling | **Vite** | Fast dev server, simple static output |
| Package manager | npm or pnpm (contractor's choice, documented) | |
| State/UI chrome | Lightweight (vanilla + a thin reactive layer, or Preact/Svelte). **No heavy framework** in the render loop | UI is minimal; keep the hot path framework-free |
| Testing | **Vitest** (unit) + **Playwright** (E2E/visual) | See QA plan |
| Linting/format | ESLint + Prettier, enforced in CI | |
| Worker offloading | **Web Workers** for the solver where needed | Keep the main thread at 60 fps during large re-solves |
| Optional geometry math | Consider **Sylves** (Boris the Brave's grid library, MIT) as reference/inspiration for grid topology; port concepts if useful | Not a hard dependency; see references |

**Determinism rule (project-wide law):** all "randomness" (grid jitter, tile tie-breaking, decoration scatter) must be driven by a **seeded PRNG** keyed off stable coordinates (cell/vertex IDs). The same town data must render identically everywhere, forever. Ban `Math.random()` from all generation code paths; provide a single seeded RNG utility and lint against the native call.

---

## 2. System A — The organic irregular grid

This is the visual soul of the product. The grid is a mesh of **quadrilateral cells** that are *approximately* square but collectively wobble in an organic, non-orthogonal way. It is generated once (deterministically from a seed), then treated as fixed topology on which the player builds.

### 2.1 Requirements the grid must satisfy
- **All faces are quads** (four-sided cells). This is what lets the tile system treat every cell uniformly.
- **Organic irregularity** — cells vary in orientation and shape; no global square lattice is visible.
- **Well-conditioned** — no degenerate (near-zero-area, extremely skewed, or non-convex) quads, which would break tiling. Relaxation enforces this.
- **Deterministic** from a seed; **tileable/extendable** so the world can grow (or, for v1, so a large fixed island is reproducible).
- **Rich adjacency data** — for each cell, its neighbors across each edge and around each vertex must be queryable in O(1); the solver depends on this.

### 2.2 Generation pipeline (recommended)

The recommended pipeline is the well-documented "hex → merge → subdivide → relax" method used by Townscaper and reproduced by several public write-ups (see references). Steps:

1. **Seed a triangular/hex base.** Lay down a regular triangular grid bounded to a hexagonal region (a "chunk"). For a large world, tile the plane with hex chunks; each chunk is seeded deterministically by its axial coordinate so chunk boundaries match.
2. **Randomly merge triangle pairs into quads.** Iterate the triangles in a seed-shuffled order; greedily merge each unmerged triangle with an adjacent unmerged triangle to form a quad. Some triangles may remain — handle leftovers by (a) splitting a leftover triangle into 3 quads (mid-edge + centroid subdivision), guaranteeing an all-quad mesh. (This "ortho/Conway-operator" style subdivision is the robust way to guarantee no triangles survive.)
3. **Subdivide once more into smaller quads** (each quad → 4) if a finer cell size is desired. This also regularizes valence.
4. **Weld coincident vertices** across the whole mesh (and across chunk seams) so the mesh is topologically connected — critical before relaxation.
5. **Relax (the key step).** Iteratively nudge every interior vertex toward the shape that makes each incident quad as square as possible:
   - For each quad, compute the **best-fit square**: same centroid, a fixed target side length, and the rotation that minimizes the sum of squared distances from the quad's corners to the square's corners. The optimal rotation has a **closed-form solution** (derive via least-squares / `atan2` of summed cross/dot terms — see the andersource write-up in references).
   - Each quad thus "pulls" its four corners toward their ideal squared positions. Accumulate these pulls per vertex and move each vertex by the average (a relaxation/Laplacian-like step with a step size < 1).
   - Repeat for N iterations (typically 10–50) until the field settles. Pin boundary vertices as appropriate to keep chunks aligned.
6. **Bake adjacency.** Produce the final immutable data structures (§2.3). Optionally project onto a **gentle dome** (see product W2) by displacing vertices along a large-radius sphere for the curved-horizon look.

> **Spike required (P0).** This pipeline has several failure modes (leftover triangles, relaxation instability, chunk-seam mismatches). It must be prototyped and proven **before** the full build is priced/committed. See risk R1.

### 2.3 Grid data model (baked, immutable)

```
Vertex   { id, position: Vec3 (or Vec2 + dome height) }
Edge     { id, v0, v1, leftCell, rightCell }
Cell     { id,                       // a quad
           corners: [v0,v1,v2,v3],   // CCW
           edges:   [e0,e1,e2,e3],
           edgeNeighbors: [c|null ×4],
           cornerNeighbors: [[cells sharing each corner] ×4],
           centroid, normal, basis (local frame for placing tiles) }
Grid     { cells[], edges[], vertices[], spatialIndex (for picking) }
```

The **local basis per corner** (and per cell) is what lets a single library of tile meshes be instanced into every irregular cell: each tile is authored in a canonical unit-cell space and transformed by the cell/corner's basis at render time. Because relaxation makes cells near-square, the distortion is small and unnoticeable — this is *why* relaxation matters beyond aesthetics.

### 2.4 The third dimension, terrain & state

Building is **vertical extrusion of the 2D grid.** The world is a set of **voxels** where a voxel = `(cellId, level)`, `level ∈ 0..maxHeight`. Each **base cell** additionally carries a **terrain type** — `land` or `water` — at ground level; both are valid bases to build on, and the user can convert between them (dig land→water, raise water→land). The build state is small and fully derived-from:

```
Town {
  gridSeed, worldBounds,
  terrain: Map<cellId, {base: LAND|WATER, groundLevel}>,   // §3.6
  filled:  Map<cellId, SortedSet<level>>,                  // placed blocks
  color:   Map<voxelKey, colorIndex>,                      // per-voxel color (drives art, not just tint — §3.2/§3.4)
  lighting: { timeOfDay: 0..1 }                            // sun position; §5.2
}
```

Everything the architecture solver renders — buildings, terrain edges (shorelines/cliffs/beaches), color-conditioned art, and special builds — is derived from this tiny state. It is also exactly what the save format serializes (§7). **Color is first-class state**, not a render-time tint: it is an *input* to tile and recipe selection (§3.2–§3.4).

---

## 3. System B — Procedural architecture (marching cubes + wave function collapse)

This turns the raw voxel set into believable buildings. It fuses three ideas from Oskar Stålberg's lineage (Brick Block → Bad North → Townscaper): **corner-based marching cubes**, **a handcrafted modular tile library**, and **wave function collapse (WFC) constraint solving**, followed by a **decoration pass.**

### 3.1 The core idea: build from corners, not cubes

Do **not** render each filled voxel as a cube. Instead decompose the world into **corner cells** and pick a mesh tile for each corner based on the occupancy of the voxels around it.

Concretely: consider each **grid vertex column** — a vertical line at a grid vertex, at each level boundary. Around that vertical line sit the (up to 4) quad cells meeting at that vertex, and above/below sit two levels. That gives a small neighborhood of voxel occupancy samples (the "marching cube" around the corner). For each such corner-neighborhood, select a **corner tile mesh** — a piece that fills the quarter of each surrounding cell nearest that vertex — whose shape matches the occupancy pattern (solid below/empty above ⇒ a roof-edge corner; solid on two adjacent cells ⇒ a wall corner; etc.).

Because tiles are **quarter-cell corner pieces**, four tiles meet inside every cell and they must **agree on their shared boundaries** (heights, wall lines, floor levels). Enforcing that agreement is the job of WFC.

**Why corners not cubes:** corner decomposition is what allows smooth walls, mitred roof ridges, arches, and diagonal features to emerge on an irregular grid without a combinatorial explosion of full-cell tiles. It is the central architectural insight of the source game and must be respected.

### 3.2 The tile library (data-driven)

A **tile** = a small 3D mesh authored in canonical corner space + metadata:

```
Tile {
  id, mesh,
  sockets: { +X, -X, +Y, -Y, +Z (up), -Z (down), and diagonal corner sockets },
            // a socket is a small enum/hash describing the profile at that face:
            // e.g. WALL_FULL, WALL_HALF, FLOOR, ROOF_RIDGE_A, OPEN, GROUND,
            //      WATER_EDGE, SHORE, CLIFF, BEACH, QUAY, PILING ...
  occupancyPattern,   // which of the surrounding voxels this tile is valid for
  weight,             // base selection probability / priority
  tags: [wall, roof, arch, ground, terrain-edge, garden-capable, ...],
  colorConditioning,  // §3.6 — how this tile's variant/adornment depends on the
                      // color(s) of the voxel(s) it renders (roof style, window
                      // style, trim); NOT just a tint
  variants: [...]     // mirror, decoration hooks, per-color-family variants
}
```

Two tiles may sit adjacent **iff their facing sockets are compatible** (matching profile). This adjacency relation is the WFC constraint set. Sockets are the contract; get the socket taxonomy right early (P3 spike) because the entire tileset and solver depend on it. **The socket alphabet must include terrain profiles** (water edge, shore, cliff, beach, quay, over-water piling) so land/water boundaries are solved by the same system, not bolted on.

The tile library is **content, not code** — authored as glTF meshes + a JSON/TS manifest of sockets/weights/tags. This is what makes the art tier (T1/T2/T3 in the product spec) a data-scaling exercise rather than a re-engineering one, and it is what a modding community could later extend.

### 3.3 The solver: local WFC / constraint propagation

On every edit, the system must choose one valid tile per corner cell such that all shared sockets agree, then render. Approach:

1. **Domain init.** For each affected corner cell, compute the set of tiles whose `occupancyPattern` matches the local voxel occupancy. This is a fast lookup (precompute a map: occupancy pattern → candidate tiles).
2. **Constraint propagation (arc consistency).** Where a corner cell has multiple candidates, propagate socket constraints to neighbors, pruning incompatible tiles (classic WFC "collapse + propagate"). Use weights to bias selection toward the intended look.
3. **Observe/collapse** the lowest-entropy cells first; tie-break with the **seeded RNG** keyed on the cell ID (determinism!).
4. **Totality guarantee (critical).** Unlike Bad North's strict WFC (which restarts on contradiction), this system must **never fail visibly.** Follow Townscaper's approach: allow "silent failures" — if a corner cannot be satisfied perfectly, fall back to a permissive/default tile (e.g. a plain support/steel piece) rather than backtracking the whole town. Design the tileset with guaranteed-valid fallback tiles for every occupancy pattern so the solver is **total by construction.** This is an acceptance gate (see product §5.2).
5. **Locality & incrementality.** An edit only invalidates corner cells within a bounded radius of the changed voxel (and their propagation neighbors). Re-solve **only the dirty region**, not the whole town. This is what keeps edits within the ≤150 ms budget on large towns. Maintain a dirty-set and re-solve/re-mesh incrementally.
6. **Threading.** For large dirty regions, run propagation in a **Web Worker** and hand back a tile assignment for the main thread to mesh, so the frame loop never stalls. Batch drag-strokes into a single solve.

### 3.4 Decoration pass (structure first, ornament after)

After structure resolves, a **second, cheaper pass** adds ornament, matching the source game's feel that decoration "pops in a beat later":

- **Windows & doors:** placed on wall tiles by context (doors low/near entrances, windows on upper walls), authored either as sub-meshes or via a **stencil-buffer / decal approach** so they never clip cell edges. (Townscaper uses stencilled windows to avoid cut-off.)
- **Color-conditioned trim:** window style, roof style, and adornments are selected using the **color** of the underlying voxel(s), not merely tinted (see §3.6 and product §8 CD1). This is pervasive and is what makes a red house and a green house *look built differently*, not just recolored.
- **Adaptive props:** chimneys, dormers, railings, bushes, lanterns scattered by seeded RNG onto valid surfaces, scaled to available geometry.
- **Special-build recipes** are handled by the recipe engine in §3.7.

Decoration is deterministic (seeded) and **purely cosmetic for structure** — it never changes collision/support, so it can be computed lazily/async at a lower priority than structure. (Special-build *recipes*, by contrast, may substitute structural sub-assemblies — see §3.7.)

### 3.5 Meshing & rendering the result

- Convert the per-corner tile assignment into GPU geometry. Prefer **instanced rendering** (`InstancedMesh`) keyed by tile id, with per-instance transform (from the corner basis) and per-instance color. This keeps draw calls low even for thousands of tiles.
- Color is applied per-instance (per-voxel color propagated to that voxel's tiles), via instance color attributes / a small material that tints a shared brick texture. Keep **one or few materials**; do not spawn a material per color.
- Chunk the town into render batches so only dirty batches rebuild their instance buffers on edit.
- Subtle **brick/stone texturing** and an **outline/edge treatment** (post-process outline or baked) give the hand-built look and keep silhouettes readable at all zooms.

### 3.6 Terrain (land / water) & color as a solver input

**Terrain** is not a separate system — it flows through the same tile solver. Each base cell's `base` type (land/water) participates in the occupancy/socket computation at ground level: a land cell exposes `GROUND/SHORE/CLIFF/BEACH` sockets to its neighbors, a water cell exposes `WATER_EDGE/QUAY/PILING`. When the user **digs** a land cell (land→water) or **raises** a water cell (water→land), only that cell and its ring of neighbors are marked dirty and re-solved, regenerating shoreline, quay, cliff, or beach tiles automatically. Buildings over water resolve pilings/quays as footings; buildings on land sit on cobbles/plaza tiles. This keeps "expanding the world" coherent: growing land or carving canals is just editing base cells and letting the solver respond.

**Color as a solver input.** Color is read at two points:
1. **Tile/variant selection (CD1):** where a tile has `colorConditioning`, the color family of the voxel(s) it covers biases which variant/adornment is chosen (roof pitch/material, window style, trim). Implement as color-family → variant-weight modifiers layered on the base tile weights, so the WFC still respects sockets but leans toward color-appropriate art.
2. **Recipe preconditions (CD2–CD4):** several special builds are *defined* by color relationships (see §3.7).

Both must stay **deterministic** (seeded) and must **preserve existing colors** through any re-solve.

### 3.7 The special-build recipe engine

Special builds (lighthouse, garden courtyard, flag buntings, arches, hooks, stairs, bridges — full catalog in product spec §8) are **not hard-coded one-offs.** They are entries in a **data-driven recipe library** evaluated after (and partly during) the base solve:

```
Recipe {
  id,
  match(pattern) -> bool,   // spatial + color predicate over the local voxel/terrain/color field
                            // e.g. LIGHTHOUSE: single-cell tower, top >=3 voxels alternating 2 colors
                            //      GARDEN:     enclosed open region bounded by DIFFERING colors
                            //      FLAGS:      two masses ~1-2 cells apart -> bunting colored by both endpoints
  priority,                 // high-priority recipes win over plain tiles
  apply(region) -> sub-assembly (tiles/props/emissive), deterministic, seeded
}
```

- Recipes run as **priority-ordered pattern matchers** over the local field. On match, they **substitute** a curated sub-assembly for the plain tiles in their footprint. Because they can change structure (a lighthouse lantern, a bridge deck), they run inside the solve/mesh dirty-region pipeline, not the cosmetic decoration pass.
- **Color relationships are predicates:** e.g. the garden recipe requires the enclosing masses to be *differently* colored; the flag recipe derives flag colors from the two endpoint colors (same → uniform, different → hybrid). This is the concrete mechanism behind product §8.
- Recipes must respect **totality**: a recipe that fails to fully apply falls back to the plain tiles (never an error).
- The library is **content**: adding a recipe is authoring a predicate + a sub-assembly + a weight, not changing the engine. This is what makes the special-build catalog a tuning exercise, and it is the main reason color-driven art inflates the P4 art budget.

> **P0 note:** validate the recipe-engine shape and at least one color-predicate recipe (lighthouse) in the spike, since it interacts with both the solver and determinism.

---

## 4. Module map

```
/src
  /core
    rng.ts                 // seeded PRNG utilities (the only source of randomness)
    math.ts                // vec/quat/basis helpers on top of three
  /grid
    generate.ts            // hex→merge→subdivide→relax pipeline (System A)
    grid.ts                // baked Grid data model + adjacency queries
    picking.ts             // ray → (cell, level, face) resolution
  /town
    town.ts                // voxel build state (terrain + filled + colors + seed + lighting)
    terrain.ts             // land/water base + dig/raise commands (§3.6)
    history.ts             // undo/redo command stack (block, bulk, terrain, color)
    serialize.ts           // save codes / URL encoding (§7)
  /architecture
    tiles/                 // tile manifest (sockets, weights, tags, colorConditioning) + glTF
    sockets.ts             // socket taxonomy (incl. terrain profiles) + compatibility
    solver.ts              // marching-cubes decomposition + local WFC (System B)
    solver.worker.ts       // worker wrapper for large re-solves
    recipes/               // data-driven special-build recipe library (§3.7)
    recipe-engine.ts       // priority pattern-match + substitute (lighthouse, garden, flags…)
    color.ts               // color-family → variant weighting (CD1) + recipe color predicates
    decorate.ts            // windows/doors/props cosmetic pass
    mesher.ts              // tile assignment → InstancedMesh batches
  /render
    scene.ts               // three scene, camera rig, water, sky
    daylight.ts            // time-of-day sun rig: dynamic shadows, sky/ambient grading, night interiors (§5.2)
    water.ts               // stylized water shader
    materials.ts           // shared materials, outline, instancing, emissive-window handling
    camera.ts              // orbit/zoom/pan with damping (feel-critical)
  /ui
    palette.ts, tools.ts, timeslider.ts, chrome.ts, settings.ts, gallery.ts, hints.ts
  /app
    input.ts               // pointer/touch/keyboard → commands (incl. bulk line/area, terrain, eyedropper)
    tools.ts               // build tools: single, line (BB1), area (BB2), terrain, remove variants
    loop.ts                // dirty-driven update + render loop
    persistence.ts         // autosave, load, import/export
    main.ts
/assets  (meshes, textures, palettes)
/test    (unit + e2e + visual snapshots)
```

**Coupling rules:** `town` never imports `render`; the pipeline is one-directional `input → town(+history) → architecture(solver→decorate→mesher) → render`. The solver is pure (state in, tile assignment out) so it is unit-testable headlessly and worker-safe.

---

## 5. Rendering, lighting & art direction (technical)

### 5.1 Art direction & materials
- **Stylized water:** scrolling normal/foam, soft depth-based shoreline blend, gentle vertical bob. Cheap; must run on mobile. Shoreline blend must react to terrain edges (§3.6).
- **Outline pass** for silhouette readability (post-process edge detect or inverted-hull).
- **Color pipeline:** curated palette values live in one data file; color drives *both* per-instance tint **and** art variant selection (§3.6 CD1) over a shared subtle albedo texture. Keep one/few materials.
- **Camera feel is code, not art:** damped orbit controls with inertia, clamped pitch, smooth zoom. Budget real time to tune this — a stated correctness requirement.
- **Grid display:** a hover-highlight of the pick-target cell is always on; a toggle renders the full cell overlay (edges) for precise placement, bulk-tool aiming, and terrain editing (product U-GRID).

### 5.2 Time-of-day lighting system  *(Required — product §3.7)*

The lighting is interactive, not a fixed rig. A single **time-of-day parameter** (`0..1`) drives the whole look:

- **Sun rig:** one directional light whose direction is a function of time-of-day, arcing from horizon → zenith → opposite horizon. This drives **dynamic shadow direction and length** in real time as the user scrubs the slider.
- **Dynamic shadows:** cascaded shadow maps (CSM) sized to the visible town, or a single tight shadow frustum for smaller towns. Shadows update every frame while the slider moves and settle when idle. Bias/normal-offset tuning to avoid acne/peter-panning across the full sun-angle range is explicit work.
- **Sky & ambient grading:** sky color, ambient/hemisphere fill, fog, and a subtle color-grade LUT are keyframed against time-of-day: neutral-cool midday → warm **golden hour** at low sun → deep dusk/**night** past the horizon. Interpolate smoothly.
- **Night interiors (L6):** as the sun drops below a threshold, **window/interior emissive** ramps up — windows glow warm, lanterns/props emit. Implement via an emissive channel on window/lantern tiles whose intensity is driven by the time-of-day uniform (a global uniform read by the shared material — cheap, no per-window state).
- **Persistence:** `timeOfDay` is part of town state (§2.4) and the save format (§7), so a shared scene reopens at its chosen time and screenshots capture it.
- **Performance & fallback:** dynamic shadows are the biggest new GPU cost. Budget per product §5.1; on low-end/mobile, degrade to a cheaper shadow mode (lower-res CSM, single cascade, or contact-shadow approximation) while keeping the lighting *look* — shadows must remain present at the desktop Target tier. See §6 and risk R11.
- **Reduce-motion:** the optional auto day-cycle (product L8) is off by default and disabled under `prefers-reduced-motion`.

---

## 6. Performance strategy (how the budget in product §5.1 is met)

1. **Instanced rendering** → draw calls stay ~O(number of tile types), not O(blocks).
2. **Dirty-region solving & meshing** → edit cost is O(edit neighborhood), not O(town).
3. **Worker-threaded solves** → main thread holds 60 fps during big re-solves.
4. **Chunked instance buffers** → only touched chunks re-upload to GPU.
5. **LOD/culling** for large towns → frustum cull chunks; optional distance LOD dropping decoration first.
6. **Asset budget** → texture atlas for tiles; keep total texture memory bounded; compressed glTF (Draco/meshopt).
7. **Object pooling** for temporary solver structures to avoid GC spikes mid-stroke.
8. **Shadows** → cascaded shadow map sized to visible town; re-render the shadow map only when the sun *or* geometry changes (not every frame when idle); tiered shadow quality by device (§5.2). This is the main new GPU cost from the time-of-day system.
9. **Emissive night lighting** is a global-uniform ramp (no per-window light) so night scenes cost no extra draw calls.

A **performance test town** (a large reference save, including terrain and a stress of special builds) must be committed and used in automated perf checks each milestone — profiled at **both** midday (no window emissive) and night (full emissive + low-angle shadows), the two extremes of the lighting cost curve.

---

## 7. Save / share format

The entire town derives from a tiny state, so the save is small and the format is the contract for determinism and sharing.

**Canonical serialized fields:**
```
version, gridSeed (+ world bounds/chunk set), maxHeight,
terrain: per-cell base (land/water) — bit-packed, delta/RLE-encoded,
filled voxels (cellId, level),
per-voxel colorIndex,
paletteId,
lighting: timeOfDay (quantized)
```
Terrain and lighting are part of the shared scene: opening a code reproduces the same land/water layout **and** the same time-of-day. Special builds are *not* stored — they are re-derived deterministically from voxels + colors + terrain on load (that is what determinism buys).

**Encoding:**
- Serialize to a compact binary layout (varint cell deltas + bit-packed levels + palette-indexed colors), then **base64url** it into a URL fragment / shareable code. Target: a typical town in a copy-pasteable string; large towns still well under URL limits, with gzip/deflate before base64 if needed.
- **Versioned**: first byte(s) = format version so future changes stay backward-compatible. Loaders must handle all shipped versions.
- **Determinism dependency:** because grid generation and tile selection are seeded and pure, `code → identical town` holds across machines and releases (guard this with golden-file tests — a set of codes whose rendered output is snapshotted).

**Local persistence:** autosave the current town (and a gallery of saved towns) to IndexedDB; the shareable code is the interchange/export format. Optional glTF/OBJ export (product P6) runs off the final meshed scene.

**Optional backend (priced separately):** a short-link service mapping short IDs → codes, plus an optional screenshot gallery. Not required for v1.

---

## 8. Third-party & licensing hygiene (technical)
- Three.js (MIT), Vite (MIT), Vitest/Playwright (MIT/Apache) — all permissive; fine.
- If porting concepts from **Sylves** (MIT) or public WFC implementations (e.g. mxgmn's reference, MIT), keep license notices; prefer clean-room re-implementation guided by the algorithm, not copied assets.
- **All 3D art, textures, sounds, and the palette must be original or properly licensed for commercial use.** No ripped Townscaper assets. This is both legal and technical acceptance (see contractor brief §6).
- Maintain a `THIRD_PARTY.md` / SBOM listing every dependency and license.

---

## 9. Known technical risks (summary — full register in project plan §7)
| Ref | Risk | Where addressed |
|-----|------|-----------------|
| R1 | Grid relaxation instability / degenerate quads | P0 spike; §2.2 |
| R2 | Solver not total (some edit throws/hangs) | Fallback-tile design; §3.3.4; P3 gate |
| R3 | Re-solve too slow on large towns | Dirty-region + worker; §3.3.5/§6 |
| R4 | Tileset art volume balloons (T3 + color-conditioning multiplies variants) | Data-driven tiles; recipe library; art bar fixed at T3/T2 (product §7) |
| R5 | Socket taxonomy (incl. terrain profiles) wrong → tileset rework | Lock taxonomy in P0/P3 spike before authoring the full set |
| R6 | Mobile performance | Perf gate each milestone; §6 |
| R11 | Dynamic shadows/time-of-day too costly, esp. mobile | Tiered shadow quality; re-render shadow map only on change; night = global emissive uniform; §5.2/§6 |
| R12 | Color-driven art & special-build recipes explode combinatorially | Color-family buckets (not per-hue); recipes as bounded data-driven predicates; tune weights for frequency |

---

*Continue to `03-project-plan.md`.*
