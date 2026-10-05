import {
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Scene,
} from 'three';

import { VIEW_DISTANCE, WATER_LEVEL } from '../config';
import type { System } from '../core/System';
import type { Vec3Like } from './Terrain';

const WATER_SIZE = VIEW_DISTANCE * 2.6;
const WATER_SEGMENTS = 96;
/** The plane follows the focus in steps of this size so vertex waves do not slide. */
const FOLLOW_SNAP = WATER_SIZE / WATER_SEGMENTS;
const WATER_OPACITY = 0.78;
const DEEP_COLOR = 0x1d4f73;

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y += sin(world.x * 0.15 + uTime * 1.2) * 0.07 + cos(world.z * 0.12 + uTime * 0.9) * 0.07;
  vWorldPos = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uOpacity;
uniform float uDaylight;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
varying vec3 vWorldPos;
void main() {
  vec2 p = vWorldPos.xz;
  float t = uTime;
  vec3 n = normalize(vec3(
    0.06 * cos(p.x * 0.35 + t * 1.3) + 0.04 * cos((p.x + p.y) * 0.6 + t * 1.9),
    1.0,
    0.06 * sin(p.y * 0.31 + t * 1.1) + 0.04 * sin((p.x - p.y) * 0.5 - t * 1.7)
  ));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 base = mix(uDeepColor * (0.25 + 0.75 * uDaylight), uSkyColor, 0.2 + 0.6 * fresnel);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 140.0);
  vec3 color = base + uSunColor * spec;
  gl_FragColor = vec4(color, mix(uOpacity, 1.0, fresnel));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Large translucent water plane at {@link WATER_LEVEL} that follows the focus, with gentle
 * vertex waves and a procedural normal for sun glints.
 */
export class Water implements System {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly focus: Readonly<Vec3Like>,
  ) {
    const geometry = new PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEGMENTS, WATER_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uOpacity: { value: WATER_OPACITY },
          uDaylight: { value: 1 },
          uDeepColor: { value: new Color(DEEP_COLOR) },
          uSkyColor: { value: new Color() },
          uSunColor: { value: new Color() },
          uSunDir: { value: new Vector3(0, 1, 0) },
        },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'water';
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Updates lighting terms (called by the day/night cycle). */
  setLighting(sunDir: Vector3, sunColor: Color, skyColor: Color, daylight: number): void {
    const u = this.mesh.material.uniforms;
    (u['uSunDir']?.value as Vector3 | undefined)?.copy(sunDir);
    (u['uSunColor']?.value as Color | undefined)?.copy(sunColor);
    (u['uSkyColor']?.value as Color | undefined)?.copy(skyColor);
    if (u['uDaylight']) u['uDaylight'].value = daylight;
  }

  frameUpdate(frameDt: number): void {
    this.time += frameDt;
    const u = this.mesh.material.uniforms;
    if (u['uTime']) u['uTime'].value = this.time;
    this.mesh.position.x = Math.round(this.focus.x / FOLLOW_SNAP) * FOLLOW_SNAP;
    this.mesh.position.z = Math.round(this.focus.z / FOLLOW_SNAP) * FOLLOW_SNAP;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
