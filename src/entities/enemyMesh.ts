import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';

import type { EnemyDef } from '../data/enemies';
import { MeshKit, paint, type Paint } from './meshKit';

/** Proportions of the goblin rig at scale 1. Feet are y = 0 when the body sits at hipHeight. */
export const GOBLIN = {
  hipHeight: 0.62,
  hipX: 0.17,
  shoulderX: 0.36,
  shoulderY: 0.6,
  neckY: 0.74,
} as const;

/** Joints the enemy animates. Ground enemies fill the limbs, the wisp fills the wings. */
export interface EnemyRig {
  /** Scaled container (appearance.scale) to add under the enemy root. */
  readonly container: Group;
  /** Hip-height body; bobs while walking. */
  readonly body: Group;
  readonly head: Group | null;
  readonly leftArm: Group | null;
  readonly rightArm: Group | null;
  readonly leftLeg: Group | null;
  readonly rightLeg: Group | null;
  readonly leftWing: Group | null;
  readonly rightWing: Group | null;
}

type Finish =
  'skin' | 'cloth' | 'dark' | 'bone' | 'wood' | 'metal' | 'flame' | 'core' | 'eyeGlow' | 'wing';

const BONE = 0xe8dcc0;
const SCLERA = 0xf3eedc;
const DARK = 0x1c140f;
const CLUB = 0x7a4a28;
const FOOT_SHADE = 0.62;
const ROPE = 0x4a3524;

const CAP = 3;
const RADIAL = 8;

/**
 * Builds the merged, vertex-coloured mesh rig of an enemy. Every material created is pushed
 * into `materials` (flash / fade) and every geometry into `geometries` (dispose).
 */
export function buildEnemyRig(
  def: Pick<EnemyDef, 'appearance' | 'boss'>,
  materials: MeshStandardMaterial[],
  geometries: BufferGeometry[],
): EnemyRig {
  const appearance = def.appearance;
  const container = new Group();
  container.scale.setScalar(appearance.scale);
  const body = new Group();
  container.add(body);
  const kit = new MeshKit<Finish>();
  const material = (finish: Finish): MeshStandardMaterial => {
    const result = createMaterial(finish, appearance.color, appearance.accent);
    materials.push(result);
    return result;
  };

  if (appearance.floating) {
    const leftWing = new Group();
    const rightWing = new Group();
    buildWisp(kit, body, leftWing, rightWing, appearance.color, appearance.accent);
    kit.bake({ joints: [body, leftWing, rightWing], geometries, material });
    return {
      container,
      body,
      head: null,
      leftArm: null,
      rightArm: null,
      leftLeg: null,
      rightLeg: null,
      leftWing,
      rightWing,
    };
  }

  const joints = {
    head: new Group(),
    leftArm: new Group(),
    rightArm: new Group(),
    leftLeg: new Group(),
    rightLeg: new Group(),
  };
  body.position.y = GOBLIN.hipHeight;
  joints.head.position.set(0, GOBLIN.neckY, 0.02);
  joints.leftArm.position.set(GOBLIN.shoulderX, GOBLIN.shoulderY, 0);
  joints.rightArm.position.set(-GOBLIN.shoulderX, GOBLIN.shoulderY, 0);
  joints.leftLeg.position.set(GOBLIN.hipX, 0, 0);
  joints.rightLeg.position.set(-GOBLIN.hipX, 0, 0);
  body.add(joints.head, joints.leftArm, joints.rightArm, joints.leftLeg, joints.rightLeg);

  const paints: GoblinPaints = {
    skin: paint(appearance.color, 'skin'),
    feet: paint(new Color(appearance.color).multiplyScalar(FOOT_SHADE), 'skin'),
    accent: paint(appearance.accent, 'cloth'),
    rope: paint(ROPE, 'dark'),
    dark: paint(DARK, 'dark'),
    bone: paint(BONE, 'bone'),
    sclera: paint(SCLERA, 'bone'),
    wood: paint(CLUB, 'wood'),
    gold: paint(appearance.accent, 'metal'),
  };
  const boss = def.boss === true;
  buildGoblinBody(kit, body, paints, boss);
  buildGoblinHead(kit, joints.head, paints, boss);
  buildGoblinArm(kit, joints.leftArm, 1, paints, false);
  buildGoblinArm(kit, joints.rightArm, -1, paints, true);
  buildGoblinLeg(kit, joints.leftLeg, paints);
  buildGoblinLeg(kit, joints.rightLeg, paints);
  kit.bake({
    joints: [body, joints.head, joints.leftArm, joints.rightArm, joints.leftLeg, joints.rightLeg],
    geometries,
    material,
  });
  return { container, body, ...joints, leftWing: null, rightWing: null };
}

/** Wisp glow levels: kept low because ACES tone mapping clips pale emissive colours to white. */
const WISP_GLOW = { body: 0.25, core: 0.7, eyes: 0.8 } as const;

function createMaterial(finish: Finish, color: number, accent: number): MeshStandardMaterial {
  switch (finish) {
    case 'metal':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 });
    case 'bone':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    case 'dark':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    case 'wood':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    case 'cloth':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    case 'flame':
      return new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.45,
        emissive: color,
        emissiveIntensity: WISP_GLOW.body,
      });
    case 'core':
      return new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.4,
        emissive: color,
        emissiveIntensity: WISP_GLOW.core,
      });
    case 'eyeGlow':
      return new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.4,
        emissive: accent,
        emissiveIntensity: WISP_GLOW.eyes,
      });
    case 'wing':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: DoubleSide });
    case 'skin':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  }
}

interface GoblinPaints {
  readonly skin: Paint<Finish>;
  readonly feet: Paint<Finish>;
  readonly accent: Paint<Finish>;
  readonly rope: Paint<Finish>;
  readonly dark: Paint<Finish>;
  readonly bone: Paint<Finish>;
  readonly sclera: Paint<Finish>;
  readonly wood: Paint<Finish>;
  readonly gold: Paint<Finish>;
}

function buildGoblinBody(kit: MeshKit<Finish>, body: Group, p: GoblinPaints, boss: boolean): void {
  // Pelvis, chest and a round belly.
  kit.place(new SphereGeometry(0.22, 12, 8), p.skin, body, 0, 0.04, 0).scale.set(1.2, 0.8, 0.95);
  kit
    .place(new CapsuleGeometry(0.26, 0.2, 4, RADIAL), p.skin, body, 0, 0.38, 0)
    .scale.set(1.15, 1, 0.9);
  kit.place(new SphereGeometry(0.27, 12, 8), p.skin, body, 0, 0.28, 0.07).scale.set(1.05, 0.95, 1);
  // Rope belt and a loincloth flap.
  const belt = kit.place(new TorusGeometry(0.245, 0.035, 5, 14), p.rope, body, 0, 0.12, 0.03);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 1.05, 1);
  kit.place(new BoxGeometry(0.26, 0.3, 0.03), p.accent, body, 0, -0.1, 0.25).rotation.x = -0.12;
  kit.place(new BoxGeometry(0.22, 0.24, 0.03), p.accent, body, 0, -0.07, -0.21).rotation.x = 0.12;
  if (boss) {
    for (const side of [1, -1]) {
      for (let i = 0; i < 2; i++) {
        const spike = kit.place(
          new ConeGeometry(0.05, 0.2, 6),
          p.gold,
          body,
          side * (0.3 + i * 0.09),
          0.72 - i * 0.04,
          -0.02,
        );
        spike.rotation.z = -side * (0.35 + i * 0.3);
      }
    }
  }
}

function buildGoblinHead(kit: MeshKit<Finish>, head: Group, p: GoblinPaints, boss: boolean): void {
  kit.place(new SphereGeometry(0.3, 14, 10), p.skin, head, 0, 0.24, 0).scale.set(1.05, 0.95, 1);
  // Pig snout with nostrils.
  kit.place(new SphereGeometry(0.12, 10, 7), p.skin, head, 0, 0.17, 0.27).scale.set(1.2, 0.8, 0.7);
  for (const side of [1, -1]) {
    kit.place(new SphereGeometry(0.025, 6, 5), p.dark, head, side * 0.045, 0.17, 0.348);
    // Eyes, angry brows, tusks.
    kit
      .place(new SphereGeometry(0.065, 8, 6), p.sclera, head, side * 0.11, 0.3, 0.25)
      .scale.set(1, 1, 0.6);
    kit
      .place(new SphereGeometry(0.03, 6, 5), p.dark, head, side * 0.11, 0.3, 0.285)
      .scale.set(1, 1.2, 0.6);
    kit.place(new BoxGeometry(0.12, 0.03, 0.03), p.dark, head, side * 0.11, 0.37, 0.25).rotation.z =
      0.35 * side;
    kit.place(new ConeGeometry(0.025, 0.09, 6), p.bone, head, side * 0.09, 0.09, 0.24);
    // Big pointed ears: body colour outside, accent inside.
    const ear = kit.place(new ConeGeometry(0.08, 0.32, 6), p.skin, head, side * 0.31, 0.3, -0.01);
    ear.rotation.z = -side * (Math.PI / 2 - 0.35);
    ear.scale.set(1, 1, 0.55);
    const inner = kit.place(new ConeGeometry(0.05, 0.22, 6), p.accent, head, side * 0.3, 0.3, 0.02);
    inner.rotation.z = -side * (Math.PI / 2 - 0.35);
    inner.scale.set(1, 1, 0.4);
  }
  kit.place(new BoxGeometry(0.14, 0.02, 0.02), p.dark, head, 0, 0.08, 0.25);
  // Forehead horn: the trophy players collect.
  const horn = boss
    ? kit.place(new ConeGeometry(0.08, 0.3, 8), p.bone, head, 0, 0.56, 0.1)
    : kit.place(new ConeGeometry(0.05, 0.18, 8), p.bone, head, 0, 0.5, 0.12);
  horn.rotation.x = 0.3;
  if (boss) {
    kit.place(new TorusGeometry(0.19, 0.03, 5, 14), p.gold, head, 0, 0.44, -0.02).rotation.x =
      Math.PI / 2 - 0.15;
    for (const x of [-0.13, 0, 0.13]) {
      kit.place(new ConeGeometry(0.045, 0.2, 6), p.gold, head, x, 0.55, -0.06 - Math.abs(x) * 0.3);
    }
  }
}

function buildGoblinArm(
  kit: MeshKit<Finish>,
  arm: Group,
  side: 1 | -1,
  p: GoblinPaints,
  club: boolean,
): void {
  kit.place(new SphereGeometry(0.1, 8, 6), p.skin, arm, -0.02 * side, 0, 0);
  kit.place(new CapsuleGeometry(0.085, 0.14, CAP, RADIAL), p.skin, arm, 0, -0.15, 0);
  const forearm = kit.scaffold(new Group());
  forearm.position.y = -0.3;
  forearm.rotation.x = -0.35;
  arm.add(forearm);
  kit.place(new CapsuleGeometry(0.075, 0.12, CAP, RADIAL), p.skin, forearm, 0, -0.11, 0);
  kit
    .place(new SphereGeometry(0.095, 8, 6), p.skin, forearm, 0, -0.27, 0.01)
    .scale.set(0.85, 1, 1.1);
  if (!club) return;
  // Wooden club gripped in the fist, pointing forward with a knobbed end.
  const grip = kit.scaffold(new Group());
  grip.position.set(0, -0.27, 0.02);
  grip.rotation.x = Math.PI / 2 + 0.35;
  forearm.add(grip);
  kit.place(new CylinderGeometry(0.075, 0.04, 0.75, 7), p.wood, grip, 0, 0.3, 0);
  kit.place(new SphereGeometry(0.1, 8, 6), p.wood, grip, 0, 0.66, 0);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    kit
      .place(
        new ConeGeometry(0.025, 0.07, 5),
        p.bone,
        grip,
        Math.cos(angle) * 0.09,
        0.58,
        Math.sin(angle) * 0.09,
      )
      .rotation.set(Math.sin(angle) * 1.2, 0, -Math.cos(angle) * 1.2);
  }
}

function buildGoblinLeg(kit: MeshKit<Finish>, leg: Group, p: GoblinPaints): void {
  kit.place(new CapsuleGeometry(0.1, 0.14, CAP, RADIAL), p.skin, leg, 0, -0.14, 0);
  kit.place(new CapsuleGeometry(0.085, 0.14, CAP, RADIAL), p.skin, leg, 0, -0.4, 0.01);
  // Flat foot: sole at the ground, toes forward.
  const foot = kit.place(
    new CapsuleGeometry(0.075, 0.14, CAP, RADIAL),
    p.feet,
    leg,
    0,
    -GOBLIN.hipHeight + 0.075 * 0.7,
    0.08,
  );
  foot.rotation.x = Math.PI / 2;
  foot.scale.set(1.3, 1, 0.7);
}

function buildWisp(
  kit: MeshKit<Finish>,
  body: Group,
  leftWing: Group,
  rightWing: Group,
  color: number,
  accent: number,
): void {
  const flame = paint<Finish>(color, 'flame');
  const core = paint<Finish>(new Color(color).multiplyScalar(1.3), 'core');
  const eyes = paint<Finish>(accent, 'eyeGlow');
  const membrane = paint<Finish>(new Color(color).multiplyScalar(0.7), 'wing');
  // Teardrop flame: round bottom, tip up.
  kit.place(new SphereGeometry(0.55, 14, 10), flame, body, 0, 0, 0).scale.set(1, 0.95, 1);
  kit.place(new ConeGeometry(0.5, 0.8, 14), flame, body, 0, 0.55, 0);
  // Small purple core just breaking the surface, and two glowing eyes.
  kit.place(new SphereGeometry(0.18, 10, 7), core, body, 0, -0.12, 0.47).scale.set(1, 1, 0.6);
  for (const side of [1, -1]) {
    kit.place(new SphereGeometry(0.08, 8, 6), eyes, body, side * 0.17, 0.18, 0.5);
  }
  // Trailing embers, shrinking behind.
  const trail = [0.2, 0.14, 0.09];
  trail.forEach((radius, i) => {
    kit.place(new SphereGeometry(radius, 8, 6), flame, body, 0, -0.15 - i * 0.07, -0.55 - i * 0.3);
  });
  // Bat wings on shoulder pivots.
  leftWing.position.set(0.42, 0.1, -0.05);
  rightWing.position.set(-0.42, 0.1, -0.05);
  body.add(leftWing, rightWing);
  kit.place(batWing(1), membrane, leftWing, 0, 0, 0);
  kit.place(batWing(-1), membrane, rightWing, 0, 0, 0);
}

/** Scalloped bat wing in the XZ plane, extending along `side` × X, leading edge forward. */
function batWing(side: 1 | -1): ShapeGeometry {
  const outline: readonly (readonly [number, number])[] = [
    [0, 0.12],
    [0.45, 0.42],
    [1.05, 0.3],
    [0.85, 0.05],
    [0.7, -0.12],
    [0.52, 0],
    [0.34, -0.15],
    [0.17, -0.04],
    [0, -0.1],
  ];
  const shape = new Shape();
  outline.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x * side, y);
    else shape.lineTo(x * side, y);
  });
  const geometry = new ShapeGeometry(shape);
  // Shape +Y becomes +Z (forward).
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
