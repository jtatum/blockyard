/**
 * Stylized water (tech doc §5.1) — one circular plane at WATER_Y with a cheap
 * analytic shader: three slow sine-wave layers perturb the normal (derivatives
 * computed in closed form, no noise texture), a fresnel term blends deep→
 * shallow color, and a single specular glint tracks the sun. Deliberately no
 * reflection/refraction targets — this must stay calm-looking and mobile-safe.
 * Distance fade to the fog color matches the scene fog range (60..140) since
 * ShaderMaterial skips three's built-in fog. Colors all come from DayState so
 * the water follows the time-of-day grade for free.
 */

import * as THREE from 'three';
import { WATER_Y } from '../core/constants';
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
  uniform float uTime;
  uniform vec3 uSunDir;   // FROM sun TOWARD scene
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFog;
  varying vec3 vWorldPos;

  void main() {
    vec2 p = vWorldPos.xz;
    float t = uTime;
    // three gentle directional wave layers; slopes are analytic derivatives
    float ph1 = p.x * 0.50 + p.y * 0.31 + t * 0.26;
    float ph2 = p.x * -0.27 + p.y * 0.43 + t * 0.19;
    float ph3 = p.x * 0.11 + p.y * -0.17 + t * 0.33;
    float dx = 0.55 * 0.50 * cos(ph1) - 0.35 * 0.27 * cos(ph2) + 0.22 * 0.11 * cos(ph3);
    float dz = 0.55 * 0.31 * cos(ph1) + 0.35 * 0.43 * cos(ph2) - 0.22 * 0.17 * cos(ph3);
    vec3 n = normalize(vec3(-dx * 0.35, 1.0, -dz * 0.35));

    vec3 v = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
    vec3 col = mix(uDeep, uShallow, clamp(0.08 + fres * 1.1, 0.0, 1.0));

    // soft sun glint
    float spec = pow(max(dot(reflect(uSunDir, n), v), 0.0), 140.0);
    col += uSunColor * spec * 0.8;

    // fade toward the fog color with distance, matching scene fog
    float dist = length(cameraPosition - vWorldPos);
    col = mix(col, uFog, smoothstep(60.0, 140.0, dist));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RADIUS = 200;

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uTime: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uDeep: { value: THREE.Color };
    uShallow: { value: THREE.Color };
    uFog: { value: THREE.Color };
  };

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color(0xfff4e4) },
      uDeep: { value: new THREE.Color(0x28719b) },
      uShallow: { value: new THREE.Color(0x93cddd) },
      uFog: { value: new THREE.Color(0xcfe0ec) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: false,
      fog: false,
    });
    const geo = new THREE.CircleGeometry(RADIUS, 128).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
  }

  update(time: number, state: DayState): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uSunDir.value.copy(state.sunDir);
    this.uniforms.uSunColor.value.copy(state.sunColor);
    this.uniforms.uDeep.value.copy(state.waterDeep);
    this.uniforms.uShallow.value.copy(state.waterShallow);
    this.uniforms.uFog.value.copy(state.fogColor);
  }
}
