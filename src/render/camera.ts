/**
 * Camera rig — damped orbit/zoom/pan with pitch clamps.
 * Feel is a correctness requirement (product §5.3): smooth inertia, no flipping
 * under the world, sensible zoom range.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 500);
    this.camera.position.set(24, 22, 24);

    const c = new OrbitControls(this.camera, dom);
    c.target.set(0, 0, 0);
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.55;
    c.panSpeed = 0.7;
    c.zoomSpeed = 0.8;
    c.minDistance = 7;
    c.maxDistance = 90;
    c.minPolarAngle = 0.08;
    c.maxPolarAngle = 1.38; // never below the horizon
    c.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE, // left is for building
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE, // right-drag orbits; right-click (no drag) removes
    };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // clamp pan target so the town can't be lost off-screen
    const clampTarget = () => {
      const t = c.target;
      const r = Math.hypot(t.x, t.z);
      const maxR = 40;
      if (r > maxR) {
        t.x *= maxR / r;
        t.z *= maxR / r;
      }
      t.y = THREE.MathUtils.clamp(t.y, 0, 14);
    };
    c.addEventListener('change', clampTarget);
    this.controls = c;
  }

  update(): void {
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
