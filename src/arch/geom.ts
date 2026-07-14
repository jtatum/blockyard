/**
 * Geometry emission helpers for the architecture mesher.
 * GeoSink accumulates non-indexed triangles (flat-shaded look via
 * computeVertexNormals on unshared verts). WallFrame maps 2D wall-local
 * coordinates (u along the edge, v up, d inward) into world space so window
 * and door layouts are authored once and reused on every irregular wall.
 */

import * as THREE from 'three';

export interface P3 { x: number; y: number; z: number }

export class GeoSink {
  pos: number[] = [];
  col: number[] = [];

  tri(a: P3, b: P3, c: P3, color: THREE.Color): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  /** quad a-b-c-d → tris (a,b,c) (a,c,d); wind so (b-a)×(c-a) faces the viewer */
  quad(a: P3, b: P3, c: P3, d: P3, color: THREE.Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** horizontal quad from grid-CCW corners, facing +Y */
  horzUp(c0: P3, c1: P3, c2: P3, c3: P3, color: THREE.Color): void {
    this.quad(c0, c3, c2, c1, color);
  }

  /** horizontal quad from grid-CCW corners, facing -Y */
  horzDown(c0: P3, c1: P3, c2: P3, c3: P3, color: THREE.Color): void {
    this.quad(c0, c1, c2, c3, color);
  }

  /** axis-aligned-ish vertical box between two ground points (posts, chimneys) */
  post(x: number, z: number, y0: number, y1: number, r: number, color: THREE.Color): void {
    const c = [
      { x: x - r, z: z - r }, { x: x + r, z: z - r },
      { x: x + r, z: z + r }, { x: x - r, z: z + r },
    ];
    for (let k = 0; k < 4; k++) {
      const a = c[k]!;
      const b = c[(k + 1) % 4]!;
      // CCW footprint (grid coords) -> outward wall = quad(A0, A1, B1, B0)
      this.quad(
        { x: a.x, y: y0, z: a.z }, { x: a.x, y: y1, z: a.z },
        { x: b.x, y: y1, z: b.z }, { x: b.x, y: y0, z: b.z },
        color
      );
    }
    this.horzUp(
      { x: c[0]!.x, y: y1, z: c[0]!.z }, { x: c[1]!.x, y: y1, z: c[1]!.z },
      { x: c[2]!.x, y: y1, z: c[2]!.z }, { x: c[3]!.x, y: y1, z: c[3]!.z },
      color
    );
  }

  isEmpty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    return geo;
  }
}

/**
 * Wall-local frame over a grid edge a→b (grid coords) between heights y0..y1.
 * u ∈ [0, width] along the edge, v ∈ [0, y1-y0] up, d ≥ 0 recessed inward
 * (toward the cell interior, which lies LEFT of a→b).
 */
export class WallFrame {
  readonly width: number;
  readonly height: number;
  private ax: number;
  private az: number;
  private y0: number;
  private ux: number;
  private uz: number;
  private nx: number;
  private nz: number;

  constructor(ax: number, az: number, bx: number, bz: number, y0: number, y1: number) {
    this.ax = ax;
    this.az = az;
    this.y0 = y0;
    const ex = bx - ax;
    const ez = bz - az;
    this.width = Math.sqrt(ex * ex + ez * ez);
    this.height = y1 - y0;
    this.ux = ex / this.width;
    this.uz = ez / this.width;
    // inward = left of a→b in grid coords: (-ez, ex)
    this.nx = -this.uz;
    this.nz = this.ux;
  }

  p(u: number, v: number, d = 0): P3 {
    return {
      x: this.ax + this.ux * u + this.nx * d,
      y: this.y0 + v,
      z: this.az + this.uz * u + this.nz * d,
    };
  }

  /** outward-facing rectangle in this wall plane (at depth d) */
  rect(sink: GeoSink, u0: number, v0: number, u1: number, v1: number, d: number, color: THREE.Color): void {
    sink.quad(this.p(u0, v0, d), this.p(u0, v1, d), this.p(u1, v1, d), this.p(u1, v0, d), color);
  }

  /** the four inward reveal faces of an opening u0..u1 × v0..v1 from depth 0..d */
  reveal(sink: GeoSink, u0: number, v0: number, u1: number, v1: number, d: number, color: THREE.Color): void {
    // left face (normal +u)
    sink.quad(this.p(u0, v0, d), this.p(u0, v0, 0), this.p(u0, v1, 0), this.p(u0, v1, d), color);
    // right face (normal -u)
    sink.quad(this.p(u1, v0, 0), this.p(u1, v0, d), this.p(u1, v1, d), this.p(u1, v1, 0), color);
    // bottom face (normal +v)
    sink.quad(this.p(u0, v0, d), this.p(u1, v0, d), this.p(u1, v0, 0), this.p(u0, v0, 0), color);
    // top face (normal -v)
    sink.quad(this.p(u0, v1, 0), this.p(u1, v1, 0), this.p(u1, v1, d), this.p(u0, v1, d), color);
  }

  /** a raised box on the wall surface (sills, shutters, lintels), thickness t outward */
  box(sink: GeoSink, u0: number, v0: number, u1: number, v1: number, t: number, color: THREE.Color): void {
    const D = -t; // outward is negative d
    this.rect(sink, u0, v0, u1, v1, D, color);
    // sides of the box
    sink.quad(this.p(u0, v0, 0), this.p(u0, v0, D), this.p(u0, v1, D), this.p(u0, v1, 0), color);
    sink.quad(this.p(u1, v0, D), this.p(u1, v0, 0), this.p(u1, v1, 0), this.p(u1, v1, D), color);
    sink.quad(this.p(u0, v1, 0), this.p(u0, v1, D), this.p(u1, v1, D), this.p(u1, v1, 0), color);
    sink.quad(this.p(u0, v0, D), this.p(u0, v0, 0), this.p(u1, v0, 0), this.p(u1, v0, D), color);
  }
}
