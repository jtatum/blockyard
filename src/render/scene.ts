/**
 * Renderer + scene shell. Owns the WebGL context, resize, and the frame loop.
 * Lighting/sky/water live in their own modules and attach to this scene.
 */

import * as THREE from 'three';
import { CameraRig } from './camera';

export class SceneShell {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly rig: CameraRig;
  private frameCallbacks: ((dt: number, time: number) => void)[] = [];
  private lastTime = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.rig = new CameraRig(canvas, window.innerWidth / window.innerHeight);

    const onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.rig.setAspect(window.innerWidth / window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  onFrame(cb: (dt: number, time: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    this.renderer.setAnimationLoop((timeMs: number) => {
      const time = timeMs / 1000;
      const dt = this.lastTime < 0 ? 0.016 : Math.min(time - this.lastTime, 0.1);
      this.lastTime = time;
      this.rig.update();
      for (const cb of this.frameCallbacks) cb(dt, time);
      this.renderer.render(this.scene, this.rig.camera);
    });
  }
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
