import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Scene,
} from 'three';

import { CAMERA_FAR } from '../config';
import { mulberry32 } from '../utils/random';

const DOME_RADIUS = CAMERA_FAR * 0.9;
const DOME_SEGMENTS = 32;
const STAR_COUNT = 1200;
const STAR_RADIUS = DOME_RADIUS * 0.95;
const STAR_SIZE = 1.6;
const STAR_SEED = 4242;
/** Stars are placed above this direction.y (slightly below horizon is hidden by fog anyway). */
const STAR_MIN_Y = -0.05;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVisible;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 color = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
  color = mix(uBottom, color, smoothstep(-0.25, 0.0, h));
  float sd = max(dot(dir, uSunDir), 0.0);
  color += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 14.0) * 0.25) * uSunVisible;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Gradient sky dome with sun disc and stars; follows the camera. */
export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly stars: Points<BufferGeometry, PointsMaterial>;

  constructor(scene: Scene) {
    this.group.name = 'sky';
    const material = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uBottom: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uSunVisible: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(
      new SphereGeometry(DOME_RADIUS, DOME_SEGMENTS, DOME_SEGMENTS / 2),
      material,
    );
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;

    this.stars = new Points(
      createStarGeometry(),
      new PointsMaterial({
        color: 0xffffff,
        size: STAR_SIZE,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;

    this.group.add(this.dome, this.stars);
    scene.add(this.group);
  }

  /** Updates sky colours; `starOpacity` fades the star field in at night. */
  setColors(
    top: Color,
    horizon: Color,
    bottom: Color,
    sunDir: Vector3,
    sunColor: Color,
    sunVisible: number,
    starOpacity: number,
  ): void {
    const u = this.dome.material.uniforms;
    (u['uTop']?.value as Color | undefined)?.copy(top);
    (u['uHorizon']?.value as Color | undefined)?.copy(horizon);
    (u['uBottom']?.value as Color | undefined)?.copy(bottom);
    (u['uSunDir']?.value as Vector3 | undefined)?.copy(sunDir);
    (u['uSunColor']?.value as Color | undefined)?.copy(sunColor);
    if (u['uSunVisible']) u['uSunVisible'].value = sunVisible;
    this.stars.material.opacity = starOpacity;
    this.stars.visible = starOpacity > 0;
  }

  /** Keeps the dome centred on the camera. */
  follow(camera: Camera): void {
    this.group.position.copy(camera.position);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.group.removeFromParent();
  }
}

/** Random points on the upper part of a sphere. */
function createStarGeometry(): BufferGeometry {
  const rng = mulberry32(STAR_SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = STAR_MIN_Y + rng() * (1 - STAR_MIN_Y);
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(angle) * r * STAR_RADIUS;
    positions[i * 3 + 1] = y * STAR_RADIUS;
    positions[i * 3 + 2] = Math.sin(angle) * r * STAR_RADIUS;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}
