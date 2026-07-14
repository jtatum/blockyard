/**
 * Sky dome — a big inverted sphere with a zenith→horizon gradient, a soft sun
 * disc/bloom that swells near the horizon, and faint procedural stars past
 * dusk. All color comes from DayState (daylight.ts owns the look); this file
 * only knows how to paint it. Shader includes the tone-mapping/colorspace
 * chunks so the dome grades identically to the lit geometry. Stars are
 * hash-placed per direction cell — static (no time uniform), varied in size
 * and brightness so the field still reads as alive when the camera drifts.
 */

import * as THREE from 'three';
import type { DayState } from './daylight';

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;   // FROM sun TOWARD scene
  uniform vec3 uSunColor;
  uniform float uNightness;
  varying vec3 vWorldPos;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  void main() {
    vec3 dir = normalize(vWorldPos - cameraPosition);
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));

    // sun disc + bloom; both grow as the sun nears the horizon
    vec3 toSun = -uSunDir;
    float d = max(dot(dir, toSun), 0.0);
    float low = 1.0 - clamp(toSun.y * 2.2, 0.0, 1.0);
    float glow = pow(d, mix(160.0, 45.0, low)) * mix(0.55, 1.1, low);
    float disc = smoothstep(mix(0.9995, 0.9985, low), 1.0, d) * 1.5;
    col += uSunColor * (glow + disc) * (1.0 - uNightness * 0.55);

    // stars fade in past dusk, upper hemisphere only
    float starVis = smoothstep(0.6, 0.85, uNightness) * smoothstep(0.02, 0.18, dir.y);
    if (starVis > 0.001) {
      vec3 g = dir * 90.0;
      vec3 id = floor(g);
      vec3 f = fract(g) - 0.5;
      vec3 off = (hash33(id) - 0.5) * 0.7;
      float seed = hash13(id);
      float sd = length(f - off);
      float star = smoothstep(0.09 + 0.05 * fract(seed * 57.3), 0.0, sd)
        * step(0.976, seed) * (0.35 + 0.65 * fract(seed * 73.7));
      col += vec3(0.82, 0.88, 1.0) * star * starVis;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RADIUS = 240;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uNightness: { value: number };
  };

  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x5e9bcc) },
      uHorizon: { value: new THREE.Color(0xd6e7f0) },
      uSunDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color(0xfff4e4) },
      uNightness: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), mat);
    this.mesh.frustumCulled = false; // camera is always inside the dome
  }

  update(state: DayState): void {
    this.uniforms.uZenith.value.copy(state.skyZenith);
    this.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.uniforms.uSunDir.value.copy(state.sunDir);
    this.uniforms.uSunColor.value.copy(state.sunColor);
    this.uniforms.uNightness.value = state.nightness;
  }
}
