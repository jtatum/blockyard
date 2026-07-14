/**
 * Time-of-day lighting rig (product §3.7, tech doc §5.2). `evalDay(t)` is the
 * single source of truth for "what does time t look like": every visual
 * channel (sun, sky, ambient, fog, water, window glow, exposure) is keyframed
 * against t∈0..1 and smoothstep-interpolated so scrubbing the slider never
 * jumps. The Daylight class applies that state to the scene's lights and fog
 * and drives the shared window-glass material's night glow.
 *
 * Night light: rather than swapping to a second directional (which would pop
 * the shadow map), the one sun light is continuous — it eases down to the
 * horizon at dusk, dims, cools, and rises again as faint moonlight. Its
 * elevation never goes negative, so shadows never come from below; "the sun
 * setting" is expressed by nightness dimming sky/ambient while the light's
 * color slides from gold to pale blue.
 */

import * as THREE from 'three';
import { glassMaterial } from '../arch/mesher';

export interface DayState {
  /** normalized, points FROM the sun TOWARD the scene */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientIntensity: number;
  fogColor: THREE.Color;
  waterDeep: THREE.Color;
  waterShallow: THREE.Color;
  /** 0 = full day … 1 = full night */
  nightness: number;
  /** tone-mapping exposure for the renderer */
  exposure: number;
}

const DEG = Math.PI / 180;

/** [t, value] keyframes; segments are eased with smoothstep (C1 continuous) */
type Keys = readonly (readonly [number, number])[];

/** light elevation above horizon, degrees — dips low at dusk, rises as moon */
const ELEVATION: Keys = [
  [0.0, 3], [0.25, 41], [0.5, 62], [0.75, 12], [0.83, 4], [0.9, 18], [1.0, 34],
];
/** azimuth in degrees from +X (east) toward +Z; sun travels east → west */
const AZIMUTH: Keys = [
  [0.0, 15], [0.25, 55], [0.5, 90], [0.75, 150], [0.85, 175], [1.0, 200],
];
const SUN_INTENSITY: Keys = [
  [0.0, 1.5], [0.25, 2.4], [0.5, 2.6], [0.75, 2.0], [0.85, 0.6], [0.95, 0.35], [1.0, 0.32],
];
const AMBIENT_INTENSITY: Keys = [
  [0.0, 0.7], [0.25, 0.9], [0.5, 0.95], [0.75, 0.72], [0.85, 0.5], [0.95, 0.4], [1.0, 0.38],
];
const NIGHTNESS: Keys = [[0.0, 0], [0.78, 0], [0.95, 1], [1.0, 1]];
const EXPOSURE: Keys = [
  [0.0, 0.98], [0.25, 1.0], [0.5, 1.0], [0.75, 1.06], [0.85, 0.95], [0.95, 0.85], [1.0, 0.84],
];

/** color keyframes as sRGB hex; interpolated in the linear working space */
const SUN_COLOR: Keys = [
  [0.0, 0xffb87e], [0.2, 0xffe8cf], [0.5, 0xfff4e4], [0.7, 0xffcf96],
  [0.78, 0xff9e58], [0.86, 0x7d76a8], [0.95, 0x8fa7cc], [1.0, 0x8aa2c8],
];
const SKY_ZENITH: Keys = [
  [0.0, 0x6f95b8], [0.25, 0x6aa0cd], [0.5, 0x5e9bcc], [0.72, 0x5c82ad],
  [0.82, 0x33406b], [0.92, 0x101a33], [1.0, 0x0c1428],
];
const SKY_HORIZON: Keys = [
  [0.0, 0xffd9ae], [0.25, 0xcfe3ee], [0.5, 0xd6e7f0], [0.72, 0xf6c894],
  [0.8, 0xff9e6a], [0.88, 0x6f5577], [0.95, 0x1e2c48], [1.0, 0x182440],
];
const AMBIENT_SKY: Keys = [
  [0.0, 0xd9cdc0], [0.25, 0xcfe5f5], [0.5, 0xd4e9f7], [0.75, 0xe0c3a6],
  [0.85, 0x51516e], [0.95, 0x25304a], [1.0, 0x222c44],
];
const AMBIENT_GROUND: Keys = [
  [0.0, 0x8d8474], [0.25, 0x8b9a7d], [0.5, 0x8e9d80], [0.75, 0x8a7a64],
  [0.85, 0x3c3a4a], [0.95, 0x181e2c], [1.0, 0x161c28],
];
const FOG_COLOR: Keys = [
  [0.0, 0xecd4b8], [0.25, 0xc9dcea], [0.5, 0xcfe0ec], [0.72, 0xeac9a4],
  [0.8, 0xe89f74], [0.88, 0x565273], [0.95, 0x1c2840], [1.0, 0x17223a],
];
const WATER_DEEP: Keys = [
  [0.0, 0x2c5f7e], [0.25, 0x2a6f96], [0.5, 0x28719b], [0.75, 0x2d5878],
  [0.85, 0x1c2c48], [0.95, 0x0d1a2c], [1.0, 0x0b1728],
];
const WATER_SHALLOW: Keys = [
  [0.0, 0xd6b79a], [0.25, 0x8ec6d6], [0.5, 0x93cddd], [0.72, 0xd9b184],
  [0.8, 0xdf9d70], [0.88, 0x4c4a68], [0.95, 0x223450], [1.0, 0x1e304a],
];

/** locate the keyframe segment containing t; returns [a, b, eased alpha] */
function segment(keys: Keys, t: number): readonly [number, number, number] {
  const first = keys[0]!;
  if (t <= first[0]) return [first[1], first[1], 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      return [a[1], b[1], u * u * (3 - 2 * u)];
    }
  }
  const last = keys[keys.length - 1]!;
  return [last[1], last[1], 0];
}

function evalScalar(keys: Keys, t: number): number {
  const [a, b, s] = segment(keys, t);
  return a + (b - a) * s;
}

const colorA = new THREE.Color();
const colorB = new THREE.Color();
function evalColor(keys: Keys, t: number): THREE.Color {
  const [a, b, s] = segment(keys, t);
  colorA.setHex(a);
  colorB.setHex(b);
  return new THREE.Color().lerpColors(colorA, colorB, s);
}

export function evalDay(t: number): DayState {
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  const elev = evalScalar(ELEVATION, tt) * DEG;
  const azim = evalScalar(AZIMUTH, tt) * DEG;
  // light sits at (cos a·cos e, sin e, sin a·cos e); sunDir points back at us
  const sunDir = new THREE.Vector3(
    -Math.cos(azim) * Math.cos(elev),
    -Math.sin(elev),
    -Math.sin(azim) * Math.cos(elev)
  ).normalize();
  return {
    sunDir,
    sunColor: evalColor(SUN_COLOR, tt),
    sunIntensity: evalScalar(SUN_INTENSITY, tt),
    skyZenith: evalColor(SKY_ZENITH, tt),
    skyHorizon: evalColor(SKY_HORIZON, tt),
    ambientSky: evalColor(AMBIENT_SKY, tt),
    ambientGround: evalColor(AMBIENT_GROUND, tt),
    ambientIntensity: evalScalar(AMBIENT_INTENSITY, tt),
    fogColor: evalColor(FOG_COLOR, tt),
    waterDeep: evalColor(WATER_DEEP, tt),
    waterShallow: evalColor(WATER_SHALLOW, tt),
    nightness: evalScalar(NIGHTNESS, tt),
    exposure: evalScalar(EXPOSURE, tt),
  };
}

const SUN_DIST = 55;
const GLASS_DAY = new THREE.Color(0x4a5c6e);
const GLASS_NIGHT = new THREE.Color(0x1a222c);
const GLASS_MAX_EMISSIVE = 1.6;

export class Daylight {
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private _state: DayState;

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -32;
    cam.right = 32;
    cam.top = 32;
    cam.bottom = -32;
    cam.near = 1;
    cam.far = 120;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    // the target must live in the scene or the light never re-aims
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xcfe5f5, 0x8b9a7d, 0.9);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xcfe0ec, 60, 140);
    scene.fog = this.fog;
    scene.background = null; // the sky dome (sky.ts) draws the backdrop

    this._state = evalDay(0.5);
    this.set(0.5);
  }

  get state(): DayState {
    return this._state;
  }

  set(t: number): void {
    const s = (this._state = evalDay(t));
    this.sun.position.copy(s.sunDir).multiplyScalar(-SUN_DIST);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.hemi.color.copy(s.ambientSky);
    this.hemi.groundColor.copy(s.ambientGround);
    this.hemi.intensity = s.ambientIntensity;
    this.fog.color.copy(s.fogColor);

    // window glow (L6): shared glass material ramps on as night falls
    const w = THREE.MathUtils.smoothstep(s.nightness, 0.4, 0.75);
    glassMaterial.emissiveIntensity = GLASS_MAX_EMISSIVE * w;
    glassMaterial.color.copy(GLASS_DAY).lerp(GLASS_NIGHT, w);
  }
}
