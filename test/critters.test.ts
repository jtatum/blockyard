/**
 * Idle-life critters (render/critters.ts), headless: no WebGL, just transform
 * math. Asserts the flight/route envelopes hold over a long simulated run,
 * that every world matrix stays finite, and that construction is a pure
 * function of the town (determinism law).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateGrid } from '../src/grid/generate';
import { Critters } from '../src/render/critters';
import { Town } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

function partsOf(critters: Critters, name: string): THREE.Object3D[] {
  return critters.group.children.filter((c) => c.name === name);
}

/** flat local-transform snapshot in traversal order */
function transforms(root: THREE.Object3D): number[][] {
  const out: number[][] = [];
  root.traverse((o) => {
    out.push([
      o.position.x, o.position.y, o.position.z,
      o.rotation.x, o.rotation.y, o.rotation.z,
      o.scale.x, o.scale.y, o.scale.z,
    ]);
  });
  return out;
}

describe('Critters', () => {
  it('populates gulls and boats from the seed', () => {
    const critters = new Critters(freshTown());
    const gulls = partsOf(critters, 'gull');
    const boats = partsOf(critters, 'boat');
    expect(gulls.length).toBeGreaterThanOrEqual(4);
    expect(gulls.length).toBeLessThanOrEqual(6);
    expect(boats.length).toBeGreaterThanOrEqual(2);
    expect(boats.length).toBeLessThanOrEqual(3);
  });

  it('keeps everything in its envelope across 600 frames', () => {
    const critters = new Critters(freshTown());
    const gulls = partsOf(critters, 'gull');
    const boats = partsOf(critters, 'boat');
    const dt = 0.016;
    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += dt;
      critters.update(dt, time);
      for (const g of gulls) {
        expect(g.position.y).toBeGreaterThan(4);
        expect(g.position.y).toBeLessThan(16);
        expect(Math.hypot(g.position.x, g.position.z)).toBeLessThan(40);
      }
      for (const b of boats) {
        const r = Math.hypot(b.position.x, b.position.z);
        expect(r).toBeGreaterThan(24);
        expect(r).toBeLessThan(40);
      }
      if (i === 300) critters.refresh(); // mid-run route recheck must be safe
    }
    critters.group.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    critters.group.traverse((o) => {
      o.getWorldPosition(wp);
      expect(Number.isFinite(wp.x)).toBe(true);
      expect(Number.isFinite(wp.y)).toBe(true);
      expect(Number.isFinite(wp.z)).toBe(true);
    });
  });

  it('is deterministic: same town, identical initial transforms', () => {
    const town = freshTown();
    const a = new Critters(town);
    const b = new Critters(town);
    expect(transforms(b.group)).toEqual(transforms(a.group));
  });
});
