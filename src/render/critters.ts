/**
 * Idle life — gulls wheeling over the town and little sailboats drifting
 * offshore. Pure ambience: everything is a closed-form function of time so
 * update() is allocation-free and trivially deterministic (paths, phases and
 * counts all derive from rng(grid.seed, 'critters', ...) — determinism law).
 * Geometry is built once in the constructor from a handful of triangles via
 * GeoSink; update() only mutates transforms. Boats route around the island in
 * the open-water ring past the grid's outermost vertex, and refresh() re-checks
 * routes against LAND cells after terrain edits, pushing radii outward so a
 * boat can never plough through a coastline the player just painted.
 */

import * as THREE from 'three';
import { GeoSink, type P3 } from '../arch/geom';
import { WATER_Y } from '../core/constants';
import { rng } from '../core/rng';
import type { Town } from '../town/town';

// Model convention: forward = local +X, up = +Y. Heading θ about +Y maps
// +X to (cosθ, 0, -sinθ), so θ = atan2(-vz, vx). Euler order 'YXZ' makes
// rotation.y = yaw, rotation.x = roll about the body axis, rotation.z = pitch.
const TURN_EPS = 0.05; // seconds; numerical turn-rate step (still deterministic)
const FLAP_AMP = 0.5; // radians of wing pivot
const ROUTE_SAMPLES = 96; // land probes per boat route circle

interface GullParams {
  cx: number; cz: number; // loop center
  rx: number; rz: number; // lissajous radii
  alt: number; ay: number; wy: number; // altitude base / bob amp / bob speed
  w1: number; w2: number; dir: number; // angular speeds + orbit direction
  p1: number; p2: number; p3: number; // phases
  flapSpeed: number; flapPhase: number;
}

interface GullRig {
  root: THREE.Group;
  left: THREE.Group; // wing pivots (children of root, rotate about body axis)
  right: THREE.Group;
  q: GullParams;
}

interface BoatRig {
  root: THREE.Group;
  baseRadius: number; // seeded preference; refresh() may push outward
  radius: number;
  w: number; dir: number; phase: number;
  bobPhase: number; rollPhase: number; heel: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

function buildGullBody(): THREE.BufferGeometry {
  const s = new GeoSink();
  const white = new THREE.Color(0xf4f6f7);
  const n: P3 = { x: 0.17, y: 0, z: 0 };
  const t: P3 = { x: -0.14, y: 0.035, z: 0 };
  const l: P3 = { x: 0, y: 0.02, z: -0.055 };
  const r: P3 = { x: 0, y: 0.02, z: 0.055 };
  s.tri(n, l, t, white);
  s.tri(n, t, r, white);
  return s.build();
}

/** one wing triangle spanning toward -Z (side=-1, port) or +Z (side=+1) */
function buildGullWing(side: 1 | -1): THREE.BufferGeometry {
  const s = new GeoSink();
  const gray = new THREE.Color(0xe6eaec);
  const a: P3 = { x: 0.05, y: 0, z: 0 };
  const b: P3 = { x: -0.07, y: 0, z: 0 };
  const tip: P3 = { x: -0.04, y: 0, z: 0.26 * side };
  if (side < 0) s.tri(a, tip, b, gray);
  else s.tri(a, b, tip, gray);
  return s.build();
}

function buildBoat(): THREE.BufferGeometry {
  const s = new GeoSink();
  const hull = new THREE.Color(0x9a4a3b); // hull-red
  const deck = new THREE.Color(0xc59a6d); // warm wood
  const mast = new THREE.Color(0x54432e);
  const sail = new THREE.Color(0xf2ead6); // cream
  // length ~1.4 along +X, origin at the waterline
  const bow: P3 = { x: 0.7, y: 0.1, z: 0 };
  const fl: P3 = { x: 0.25, y: 0.1, z: -0.2 };
  const fr: P3 = { x: 0.25, y: 0.1, z: 0.2 };
  const al: P3 = { x: -0.7, y: 0.1, z: -0.16 };
  const ar: P3 = { x: -0.7, y: 0.1, z: 0.16 };
  const kf: P3 = { x: 0.45, y: -0.1, z: 0 }; // keel line
  const ka: P3 = { x: -0.62, y: -0.1, z: 0 };
  s.tri(bow, fl, fr, deck); // deck, facing +Y
  s.quad(fl, al, ar, fr, deck);
  s.tri(bow, kf, fl, hull); // port side (-Z outward)
  s.quad(fl, kf, ka, al, hull);
  s.tri(bow, fr, kf, hull); // starboard (+Z outward)
  s.quad(fr, ar, ka, kf, hull);
  s.tri(al, ka, ar, hull); // transom (-X outward)
  s.post(0.05, 0, 0.08, 1.2, 0.028, mast);
  s.tri({ x: 0.09, y: 1.12, z: 0 }, { x: 0.09, y: 0.3, z: 0 },
    { x: -0.58, y: 0.34, z: 0.05 }, sail);
  return s.build();
}

export class Critters {
  readonly group: THREE.Group;
  private readonly town: Town;
  private readonly gulls: GullRig[] = [];
  private readonly boats: BoatRig[] = [];
  /** hard outer limit for land-avoidance pushes */
  private readonly routeCap: number;

  constructor(town: Town) {
    this.town = town;
    this.group = new THREE.Group();
    this.group.name = 'critters';

    // gulls stay readable at night: emissive floor instead of an unlit material
    const gullMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0,
      emissive: 0x222222, side: THREE.DoubleSide,
    });
    const boatMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0,
      emissive: 0x1a1a1a, side: THREE.DoubleSide,
    });

    const counts = rng(town.grid.seed, 'critters');
    const nGulls = 4 + counts.int(3); // 4..6
    const nBoats = 2 + counts.int(2); // 2..3

    const bodyGeo = buildGullBody();
    const wingL = buildGullWing(-1);
    const wingR = buildGullWing(1);
    for (let i = 0; i < nGulls; i++) {
      const r = rng(town.grid.seed, 'critters', 'gull', i);
      const w1 = r.range(0.18, 0.32);
      const q: GullParams = {
        cx: r.range(-3, 3), cz: r.range(-3, 3),
        rx: r.range(4, 14), rz: r.range(4, 14),
        alt: r.range(6.5, 11), ay: r.range(0.6, 1.2), wy: r.range(0.3, 0.6),
        w1, w2: w1 * r.range(0.8, 1.25), dir: r.chance(0.5) ? 1 : -1,
        p1: r.range(0, Math.PI * 2), p2: r.range(0, Math.PI * 2),
        p3: r.range(0, Math.PI * 2),
        flapSpeed: r.range(8, 10), flapPhase: r.range(0, Math.PI * 2),
      };
      const root = new THREE.Group();
      root.name = 'gull';
      root.rotation.order = 'YXZ';
      root.add(new THREE.Mesh(bodyGeo, gullMat));
      const left = new THREE.Group();
      left.position.set(0, 0.02, -0.03);
      left.add(new THREE.Mesh(wingL, gullMat));
      const right = new THREE.Group();
      right.position.set(0, 0.02, 0.03);
      right.add(new THREE.Mesh(wingR, gullMat));
      root.add(left, right);
      this.group.add(root);
      this.gulls.push({ root, left, right, q });
    }

    // the water ring starts just past the grid's outermost vertex, so boats
    // work on any grid size — not just the default ~24-unit hexagon
    let gridMax = 0;
    for (const v of town.grid.vertices) gridMax = Math.max(gridMax, Math.hypot(v.x, v.y));
    const routeMin = Math.max(26, gridMax + 2);
    const routeMax = routeMin + 8;
    this.routeCap = routeMax + 4;

    const boatGeo = buildBoat();
    for (let i = 0; i < nBoats; i++) {
      const r = rng(town.grid.seed, 'critters', 'boat', i);
      const root = new THREE.Group();
      root.name = 'boat';
      root.rotation.order = 'YXZ';
      root.add(new THREE.Mesh(boatGeo, boatMat));
      this.group.add(root);
      this.boats.push({
        root,
        baseRadius: r.range(routeMin, routeMax),
        radius: routeMin,
        w: r.range(0.02, 0.045), dir: r.chance(0.5) ? 1 : -1,
        phase: r.range(0, Math.PI * 2),
        bobPhase: r.range(0, Math.PI * 2), rollPhase: r.range(0, Math.PI * 2),
        heel: r.range(0.015, 0.04),
      });
    }

    this.refresh();
    this.update(0, 0); // pose everything before the first frame
  }

  /** re-validate boat routes against the coastline (call after terrain edits) */
  refresh(): void {
    for (const b of this.boats) {
      let radius = b.baseRadius;
      while (radius < this.routeCap && this.routeHitsLand(radius)) radius += 0.75;
      b.radius = radius;
    }
  }

  private routeHitsLand(radius: number): boolean {
    const grid = this.town.grid;
    for (let k = 0; k < ROUTE_SAMPLES; k++) {
      const a = (k / ROUTE_SAMPLES) * Math.PI * 2;
      const cell = grid.cellAt(radius * Math.cos(a), radius * Math.sin(a));
      if (cell >= 0 && this.town.isLand(cell)) return true;
    }
    return false;
  }

  update(_dt: number, time: number): void {
    for (const g of this.gulls) {
      const q = g.q;
      const a1 = q.dir * q.w1 * time + q.p1;
      const a2 = q.dir * q.w2 * time + q.p2;
      const x = q.cx + q.rx * Math.sin(a1);
      const z = q.cz + q.rz * Math.cos(a2);
      const y = q.alt + q.ay * Math.sin(q.wy * time + q.p3);
      // analytic velocity → heading; a nearby resample gives the turn rate
      const vx = q.rx * q.dir * q.w1 * Math.cos(a1);
      const vz = -q.rz * q.dir * q.w2 * Math.sin(a2);
      const vy = q.ay * q.wy * Math.cos(q.wy * time + q.p3);
      const heading = Math.atan2(-vz, vx);
      const t2 = time + TURN_EPS;
      const vx2 = q.rx * q.dir * q.w1 * Math.cos(q.dir * q.w1 * t2 + q.p1);
      const vz2 = -q.rz * q.dir * q.w2 * Math.sin(q.dir * q.w2 * t2 + q.p2);
      const dh = Math.atan2(-vz2, vx2) - heading;
      const turnRate = Math.atan2(Math.sin(dh), Math.cos(dh)) / TURN_EPS;
      const roll = clamp(-turnRate * 0.9, -0.65, 0.65); // bank into the turn
      const pitch = clamp(Math.atan2(vy, Math.hypot(vx, vz)) * 0.6, -0.5, 0.5);
      g.root.position.set(x, y, z);
      g.root.rotation.set(roll, heading, pitch);
      const flap = Math.sin(time * q.flapSpeed + q.flapPhase) * FLAP_AMP;
      g.left.rotation.x = flap; // +x lifts the -Z tip; mirror for the other side
      g.right.rotation.x = -flap;
    }

    for (const b of this.boats) {
      const a = b.dir * b.w * time + b.phase;
      const x = b.radius * Math.cos(a);
      const z = b.radius * Math.sin(a);
      const vx = -b.radius * b.dir * b.w * Math.sin(a);
      const vz = b.radius * b.dir * b.w * Math.cos(a);
      b.root.position.set(x, WATER_Y + Math.sin(time * 1.3 + b.bobPhase) * 0.05, z);
      b.root.rotation.set(
        b.heel + Math.sin(time * 1.1 + b.rollPhase) * 0.05,
        Math.atan2(-vz, vx),
        Math.sin(time * 0.7 + b.bobPhase) * 0.02
      );
    }
  }
}
