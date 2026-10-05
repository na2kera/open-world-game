import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Vector3,
  type Camera,
  type Scene,
} from 'three';

import { DAY_LENGTH_SEC, FOG_FAR, FOG_NEAR, SHADOW_CONFIG, START_TIME_OF_DAY } from '../config';
import type { System } from '../core/System';
import { lerp, smoothstep } from '../utils/math';
import type { Sky } from './Sky';
import type { Vec3Like } from './Terrain';
import type { Water } from './Water';

/** Lighting / colour state at one moment of the day. */
interface Palette {
  skyTop: Color;
  skyHorizon: Color;
  fog: Color;
  light: Color;
  lightIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  starOpacity: number;
  /** 0 (night) .. 1 (day) brightness factor for custom shaders. */
  daylight: number;
}

interface PaletteSpec {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  light: number;
  lightIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  starOpacity: number;
  daylight: number;
}

const NIGHT: PaletteSpec = {
  skyTop: 0x0a1230,
  skyHorizon: 0x1b2a4c,
  fog: 0x17223c,
  light: 0x8ea6d8,
  lightIntensity: 0.35,
  hemiSky: 0x2a3a66,
  hemiGround: 0x0d0f18,
  hemiIntensity: 0.4,
  starOpacity: 1,
  daylight: 0.1,
};
const DAWN: PaletteSpec = {
  skyTop: 0x3d5a8f,
  skyHorizon: 0xf0a070,
  fog: 0xc89a86,
  light: 0xffb070,
  lightIntensity: 0.6,
  hemiSky: 0x8899cc,
  hemiGround: 0x4a3a30,
  hemiIntensity: 0.55,
  starOpacity: 0.15,
  daylight: 0.5,
};
const MORNING: PaletteSpec = {
  skyTop: 0x4f8fdc,
  skyHorizon: 0xbfd8ee,
  fog: 0xb9d1e6,
  light: 0xfff1d6,
  lightIntensity: 2.2,
  hemiSky: 0xbcd7f5,
  hemiGround: 0x5f6b45,
  hemiIntensity: 1.2,
  starOpacity: 0,
  daylight: 1,
};
const NOON: PaletteSpec = {
  skyTop: 0x3f7fd6,
  skyHorizon: 0xc4dcf2,
  fog: 0xbfd6ec,
  light: 0xffffff,
  lightIntensity: 2.8,
  hemiSky: 0xc6defa,
  hemiGround: 0x667345,
  hemiIntensity: 1.25,
  starOpacity: 0,
  daylight: 1,
};
const EVENING: PaletteSpec = {
  skyTop: 0x4a7ccc,
  skyHorizon: 0xf2c48c,
  fog: 0xd8bf9f,
  light: 0xffd29a,
  lightIntensity: 2,
  hemiSky: 0xb0c4e8,
  hemiGround: 0x5a5a3c,
  hemiIntensity: 1.1,
  starOpacity: 0,
  daylight: 0.95,
};
const DUSK: PaletteSpec = {
  skyTop: 0x2b3c70,
  skyHorizon: 0xe8805a,
  fog: 0xa47a78,
  light: 0xff8a50,
  lightIntensity: 0.6,
  hemiSky: 0x6a6aa0,
  hemiGround: 0x3a2c2a,
  hemiIntensity: 0.5,
  starOpacity: 0.3,
  daylight: 0.45,
};

/** Keyframes over the day (0 = midnight, 0.25 = 6:00, 0.5 = noon, 0.75 = 18:00). */
const KEYFRAMES: readonly { t: number; palette: Palette }[] = (
  [
    { t: 0, spec: NIGHT },
    { t: 0.2, spec: NIGHT },
    { t: 0.25, spec: DAWN },
    { t: 0.31, spec: MORNING },
    { t: 0.5, spec: NOON },
    { t: 0.68, spec: EVENING },
    { t: 0.75, spec: DUSK },
    { t: 0.8, spec: NIGHT },
    { t: 1, spec: NIGHT },
  ] as const
).map(({ t, spec }) => ({ t, palette: toPalette(spec) }));

function toPalette(spec: PaletteSpec): Palette {
  return {
    ...spec,
    skyTop: new Color(spec.skyTop),
    skyHorizon: new Color(spec.skyHorizon),
    fog: new Color(spec.fog),
    light: new Color(spec.light),
    hemiSky: new Color(spec.hemiSky),
    hemiGround: new Color(spec.hemiGround),
  };
}

/** Interpolates the palette for `timeOfDay` (0..1) into `out`. */
function samplePalette(timeOfDay: number, out: Palette): Palette {
  let index = 0;
  while (index < KEYFRAMES.length - 2 && (KEYFRAMES[index + 1]?.t ?? 1) < timeOfDay) index++;
  const a = KEYFRAMES[index];
  const b = KEYFRAMES[index + 1];
  if (!a || !b) return out;
  const f = smoothstep(a.t, b.t, timeOfDay);
  const pa = a.palette;
  const pb = b.palette;
  out.skyTop.lerpColors(pa.skyTop, pb.skyTop, f);
  out.skyHorizon.lerpColors(pa.skyHorizon, pb.skyHorizon, f);
  out.fog.lerpColors(pa.fog, pb.fog, f);
  out.light.lerpColors(pa.light, pb.light, f);
  out.hemiSky.lerpColors(pa.hemiSky, pb.hemiSky, f);
  out.hemiGround.lerpColors(pa.hemiGround, pb.hemiGround, f);
  out.lightIntensity = lerp(pa.lightIntensity, pb.lightIntensity, f);
  out.hemiIntensity = lerp(pa.hemiIntensity, pb.hemiIntensity, f);
  out.starOpacity = lerp(pa.starOpacity, pb.starOpacity, f);
  out.daylight = lerp(pa.daylight, pb.daylight, f);
  return out;
}

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

/** Formats a time of day (0..1) as `HH:MM`. */
export function formatClock(timeOfDay: number): string {
  const totalMinutes = Math.floor(timeOfDay * HOURS_PER_DAY * MINUTES_PER_HOUR);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Sun path shape. */
const SUN = {
  /** Scales the vertical component so the noon sun is not straight overhead. */
  elevationScale: 0.9,
  /** Constant tilt towards +z so shadows are never perfectly east-west. */
  tilt: 0.35,
  /** Sun disc fade range around the horizon (direction.y). */
  discFade: 0.05,
} as const;

const SKY_BOTTOM_DARKEN = 0.55;

const tmpBottom = new Color();

/**
 * Advances the in-game clock and drives sun/moon light, hemisphere light, fog, sky and water.
 * The shadow camera follows the focus point.
 */
export class DayNightCycle implements System {
  readonly sun = new DirectionalLight(0xffffff, 1);
  readonly hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  /** Direction towards the sun (unit). */
  readonly sunDirection = new Vector3();
  /** Direction towards the active light (sun by day, moon by night). */
  readonly lightDirection = new Vector3();
  private time = START_TIME_OF_DAY;
  private readonly palette = toPalette(NIGHT);
  private readonly fog: Fog;

  constructor(
    private readonly scene: Scene,
    private readonly sky: Sky,
    private readonly water: Water,
    private readonly focus: Readonly<Vec3Like>,
  ) {
    const shadow = this.sun.shadow;
    shadow.mapSize.set(SHADOW_CONFIG.mapSize, SHADOW_CONFIG.mapSize);
    shadow.camera.left = -SHADOW_CONFIG.extent;
    shadow.camera.right = SHADOW_CONFIG.extent;
    shadow.camera.top = SHADOW_CONFIG.extent;
    shadow.camera.bottom = -SHADOW_CONFIG.extent;
    shadow.camera.near = 1;
    shadow.camera.far = SHADOW_CONFIG.lightDistance * 2;
    shadow.bias = SHADOW_CONFIG.bias;
    shadow.normalBias = SHADOW_CONFIG.normalBias;
    this.sun.castShadow = true;
    this.fog = new Fog(0xffffff, FOG_NEAR, FOG_FAR);
    scene.fog = this.fog;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.apply();
  }

  /** Current time of day in [0, 1). */
  get timeOfDay(): number {
    return this.time;
  }

  /** Current time as `HH:MM`. */
  get clockText(): string {
    return formatClock(this.time);
  }

  /** True between dusk and dawn. */
  get isNight(): boolean {
    return this.sunDirection.y < 0;
  }

  setTimeOfDay(timeOfDay: number): void {
    this.time = ((timeOfDay % 1) + 1) % 1;
    this.apply();
  }

  update(dt: number): void {
    this.time = (this.time + dt / DAY_LENGTH_SEC) % 1;
  }

  frameUpdate(): void {
    this.apply();
  }

  /** Keeps the sky dome on the camera (call after the camera moved). */
  followCamera(camera: Camera): void {
    this.sky.follow(camera);
  }

  dispose(): void {
    this.scene.remove(this.sun, this.sun.target, this.hemi);
    this.sun.dispose();
    this.hemi.dispose();
    this.sky.dispose();
  }

  private apply(): void {
    const angle = (this.time - 0.25) * Math.PI * 2;
    this.sunDirection
      .set(Math.cos(angle), Math.sin(angle) * SUN.elevationScale, SUN.tilt)
      .normalize();
    const isDay = this.sunDirection.y >= 0;
    this.lightDirection.copy(this.sunDirection);
    if (!isDay) this.lightDirection.negate();

    const p = samplePalette(this.time, this.palette);
    this.sun.color.copy(p.light);
    this.sun.intensity = p.lightIntensity;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.copy(p.fog);

    // Shadow camera follows the focus, snapped to shadow-map texels to limit shimmering.
    const texel = (SHADOW_CONFIG.extent * 2) / SHADOW_CONFIG.mapSize;
    const tx = Math.round(this.focus.x / texel) * texel;
    const tz = Math.round(this.focus.z / texel) * texel;
    this.sun.target.position.set(tx, this.focus.y, tz);
    this.sun.position
      .copy(this.lightDirection)
      .multiplyScalar(SHADOW_CONFIG.lightDistance)
      .add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();

    tmpBottom.copy(p.fog).multiplyScalar(SKY_BOTTOM_DARKEN);
    const sunVisible = smoothstep(-SUN.discFade, SUN.discFade, this.sunDirection.y);
    this.sky.setColors(
      p.skyTop,
      p.skyHorizon,
      tmpBottom,
      this.sunDirection,
      p.light,
      sunVisible,
      p.starOpacity,
    );
    this.water.setLighting(this.lightDirection, this.sun.color, p.skyHorizon, p.daylight);
  }
}
