import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';

import { MeshKit, paint, type Paint } from './meshKit';

/** Shared proportions. Feet are y = 0 when the hips sit at {@link PERSON.hipHeight}. */
export const PERSON = {
  hipHeight: 0.9,
  shoulderX: 0.3,
  shoulderY: 0.52,
  hipX: 0.11,
  /** Grip centre of the hand on the arm group (weapon attach point). */
  handY: -0.46,
  /** Centre of the boot foot on the leg group. */
  bootY: -0.855,
  headRadius: 0.16,
  /** Centre of the chest on the hips group. */
  torsoLift: 0.43,
  /** Centre of the head on the hips group. */
  headY: 0.835,
  /** Elbow on the arm group. */
  elbowY: -0.26,
  /** Knee on the leg group. */
  kneeY: -0.43,
} as const;

export type HairStyle = 'short' | 'bob' | 'ponytail' | 'bun' | 'long';
export type PersonBuild = 'slim' | 'average' | 'stout';

export interface PersonPalette {
  readonly tunic: number;
  readonly skin: number;
  readonly hair: number;
  readonly pants: number;
  readonly boots: number;
  readonly belt: number;
  readonly hat?: number | undefined;
  readonly hairStyle?: HairStyle | undefined;
  readonly build?: PersonBuild | undefined;
  /** Collar, hem and hat band colour. Defaults to a darker tunic. */
  readonly trim?: number | undefined;
  /** Upper-arm colour. Defaults to the tunic. */
  readonly sleeves?: number | undefined;
  /** Pupil colour. */
  readonly eye?: number | undefined;
}

export interface PersonBuckets {
  geometries: BufferGeometry[];
  materials: Material[];
}

export interface PersonLimbs {
  readonly hips: Group;
  readonly leftArm: Group;
  readonly rightArm: Group;
  readonly leftLeg: Group;
  readonly rightLeg: Group;
}

const DEFAULT_EYE = 0x2a2118;
const SCLERA = 0xf6f1ea;
const MOUTH = 0x6e3428;
const BUCKLE = 0xc9a94e;
const TRIM_SHADE = 0.68;
const BROW_SHADE = 0.75;

const BUILD_WIDTH: Readonly<Record<PersonBuild, number>> = {
  slim: 0.9,
  average: 1,
  stout: 1.15,
};

/** Arm bend: the upper arm leans back and the forearm forward so the hand stays under the shoulder. */
const ARM = {
  upperTilt: 0.13,
  forearmBend: -0.3,
  /** Elbow → hand distance chosen so the hand lands on (0, handY, 0). */
  forearmLength: 0.2052,
} as const;

/** Low segment counts keep a person around 3.5k triangles. */
const CAP_SEGMENTS = 3;
const RADIAL_SEGMENTS = 8;
/** Width / height segments of small spheres (joints, pupils, ears, nose). */
const SMALL_SPHERE = [6, 5] as const;

/**
 * Surface finishes. Parts sharing a finish and a rigid parent are merged into one
 * vertex-coloured mesh, so a person costs about 14 draw calls.
 */
type Finish = 'cloth' | 'skin' | 'hair' | 'leather' | 'eye' | 'metal';
const FINISHES: Readonly<Record<Finish, { roughness: number; metalness: number }>> = {
  cloth: { roughness: 0.85, metalness: 0 },
  skin: { roughness: 0.6, metalness: 0 },
  hair: { roughness: 0.7, metalness: 0 },
  leather: { roughness: 0.75, metalness: 0 },
  eye: { roughness: 0.35, metalness: 0 },
  metal: { roughness: 0.4, metalness: 0.6 },
};

type FigurePaint = Paint<Finish>;

/** A person standing on y = 0, facing +Z. Each mesh owns its geometry. */
export function createStandingPerson(palette: PersonPalette): Group {
  const root = new Group();
  const limbs = {
    hips: new Group(),
    leftArm: new Group(),
    rightArm: new Group(),
    leftLeg: new Group(),
    rightLeg: new Group(),
  };
  limbs.hips.position.y = PERSON.hipHeight;
  limbs.leftArm.position.set(PERSON.shoulderX, PERSON.shoulderY, 0);
  limbs.rightArm.position.set(-PERSON.shoulderX, PERSON.shoulderY, 0);
  limbs.leftLeg.position.set(PERSON.hipX, 0, 0);
  limbs.rightLeg.position.set(-PERSON.hipX, 0, 0);
  limbs.hips.add(limbs.leftArm, limbs.rightArm, limbs.leftLeg, limbs.rightLeg);
  root.add(limbs.hips);
  dressPerson(limbs, palette, { geometries: [], materials: [] });
  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  return root;
}

interface Kit {
  readonly w: number;
  readonly mesh: MeshKit<Finish>;
  readonly tunic: FigurePaint;
  readonly trim: FigurePaint;
  readonly sleeves: FigurePaint;
  readonly skin: FigurePaint;
  readonly hair: FigurePaint;
  readonly pants: FigurePaint;
  readonly boots: FigurePaint;
  readonly belt: FigurePaint;
  readonly buckle: FigurePaint;
  readonly sclera: FigurePaint;
  readonly pupil: FigurePaint;
  readonly brow: FigurePaint;
  readonly mouth: FigurePaint;
}

/** Adds the body meshes under joints that the caller animates. */
export function dressPerson(
  limbs: PersonLimbs,
  palette: PersonPalette,
  bucket: PersonBuckets,
): void {
  const kit: Kit = {
    w: BUILD_WIDTH[palette.build ?? 'average'],
    mesh: new MeshKit<Finish>(),
    tunic: paint(palette.tunic, 'cloth'),
    trim:
      palette.trim === undefined
        ? paint(new Color(palette.tunic).multiplyScalar(TRIM_SHADE), 'cloth')
        : paint(palette.trim, 'cloth'),
    sleeves: paint(palette.sleeves ?? palette.tunic, 'cloth'),
    skin: paint(palette.skin, 'skin'),
    hair: paint(palette.hair, 'hair'),
    pants: paint(palette.pants, 'cloth'),
    boots: paint(palette.boots, 'leather'),
    belt: paint(palette.belt, 'leather'),
    buckle: paint(BUCKLE, 'metal'),
    sclera: paint(SCLERA, 'eye'),
    pupil: paint(palette.eye ?? DEFAULT_EYE, 'eye'),
    brow: paint(new Color(palette.hair).multiplyScalar(BROW_SHADE), 'hair'),
    mouth: paint(MOUTH, 'skin'),
  };
  dressTorso(limbs.hips, kit);
  dressHead(limbs.hips, kit);
  dressHair(limbs.hips, palette, kit);
  dressArm(limbs.leftArm, 1, kit);
  dressArm(limbs.rightArm, -1, kit);
  dressLeg(limbs.leftLeg, kit);
  dressLeg(limbs.rightLeg, kit);
  kit.mesh.bake({
    joints: [limbs.hips, limbs.leftArm, limbs.rightArm, limbs.leftLeg, limbs.rightLeg],
    geometries: bucket.geometries,
    material: (finish) => {
      const material = new MeshStandardMaterial({ vertexColors: true, ...FINISHES[finish] });
      bucket.materials.push(material);
      return material;
    },
  });
}

function dressTorso(hips: Group, k: Kit): void {
  const w = k.w;
  // Chest: widest at the shoulders.
  place(
    new CapsuleGeometry(0.145, 0.16, 4, RADIAL_SEGMENTS),
    k.tunic,
    hips,
    0,
    PERSON.torsoLift,
    0,
    k,
  ).scale.set(1.5 * w, 1, 0.85 * w);
  // Shoulder yoke so the arms always meet the torso, whatever the build.
  const yoke = place(
    new CapsuleGeometry(0.07, 0.36, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.tunic,
    hips,
    0,
    PERSON.shoulderY - 0.02,
    -0.005,
    k,
  );
  yoke.rotation.z = Math.PI / 2;
  yoke.scale.set(1, 1, 0.85 * w);
  // Waist / pelvis: narrower, so the silhouette tapers.
  place(
    new CapsuleGeometry(0.125, 0.1, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.tunic,
    hips,
    0,
    0.1,
    0,
    k,
  ).scale.set(1.3 * w, 1, 0.82 * w);
  // Hem band at the bottom of the tunic.
  const hem = place(new TorusGeometry(0.1, 0.026, 5, 12), k.trim, hips, 0, -0.035, 0, k);
  hem.rotation.x = Math.PI / 2;
  hem.scale.set(1.3 * w, 0.82 * w, 1);
  // Collar.
  const collar = place(new TorusGeometry(0.06, 0.022, 5, 12), k.trim, hips, 0, 0.655, 0.005, k);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1.2 * w, 0.95 * w, 1);
  // Belt and buckle.
  place(
    new CapsuleGeometry(0.13, 0.03, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.belt,
    hips,
    0,
    0.19,
    0,
    k,
  ).scale.set(1.32 * w, 0.32, 0.86 * w);
  place(new BoxGeometry(0.065, 0.05, 0.02), k.buckle, hips, 0, 0.19, 0.115 * w, k);
  // Neck.
  place(new CylinderGeometry(0.05, 0.056, 0.13, 8, 1, true), k.skin, hips, 0, 0.665, 0, k);
}

function dressHead(hips: Group, k: Kit): void {
  const y = PERSON.headY;
  place(new SphereGeometry(PERSON.headRadius, 12, 8), k.skin, hips, 0, y, 0, k).scale.set(
    0.95,
    1.06,
    0.98,
  );
  for (const side of [1, -1]) {
    const x = 0.058 * side;
    place(new SphereGeometry(0.034, 8, 6), k.sclera, hips, x, y, 0.135, k).scale.set(1, 1.05, 0.6);
    place(
      new SphereGeometry(0.018, ...SMALL_SPHERE),
      k.pupil,
      hips,
      x,
      y - 0.002,
      0.153,
      k,
    ).scale.set(1, 1.15, 0.6);
    const brow = place(new BoxGeometry(0.056, 0.013, 0.016), k.brow, hips, x, y + 0.045, 0.14, k);
    brow.rotation.z = -0.12 * side;
    place(
      new SphereGeometry(0.034, ...SMALL_SPHERE),
      k.skin,
      hips,
      0.152 * side,
      y - 0.01,
      -0.005,
      k,
    ).scale.set(0.65, 1, 0.8);
  }
  place(new SphereGeometry(0.022, ...SMALL_SPHERE), k.skin, hips, 0, y - 0.035, 0.155, k);
  place(new BoxGeometry(0.048, 0.011, 0.012), k.mouth, hips, 0, y - 0.08, 0.142, k);
}

function dressHair(hips: Group, palette: PersonPalette, k: Kit): void {
  const y = PERSON.headY;
  const style = palette.hairStyle ?? 'short';
  const hatted = palette.hat !== undefined;
  // Shell over the top and back of the skull, tilted back so the hairline clears the brows.
  const cap = place(
    new SphereGeometry(0.172, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    k.hair,
    hips,
    0,
    y,
    -0.01,
    k,
  );
  cap.rotation.x = -0.6;
  cap.scale.set(0.98, 1.04, 1.02);

  if (style === 'short' && !hatted) {
    const fringe = place(
      new SphereGeometry(0.06, ...SMALL_SPHERE),
      k.hair,
      hips,
      0.025,
      y + 0.068,
      0.138,
      k,
    );
    fringe.scale.set(1.9, 0.6, 0.55);
    fringe.rotation.z = 0.3;
  } else if (style === 'bob') {
    for (const side of [1, -1]) {
      place(
        new CapsuleGeometry(0.05, 0.14, CAP_SEGMENTS, RADIAL_SEGMENTS),
        k.hair,
        hips,
        0.152 * side,
        y - 0.05,
        -0.015,
        k,
      ).scale.set(0.7, 1, 1.6);
    }
    place(
      new CapsuleGeometry(0.07, 0.1, CAP_SEGMENTS, RADIAL_SEGMENTS),
      k.hair,
      hips,
      0,
      y - 0.06,
      -0.12,
      k,
    ).scale.set(1.8, 1, 0.6);
  } else if (style === 'ponytail') {
    place(new SphereGeometry(0.032, ...SMALL_SPHERE), k.trim, hips, 0, y + 0.03, -0.172, k);
    const tail = place(
      new CapsuleGeometry(0.045, 0.2, CAP_SEGMENTS, RADIAL_SEGMENTS),
      k.hair,
      hips,
      0,
      y - 0.07,
      -0.205,
      k,
    );
    tail.rotation.x = 0.34;
    tail.scale.set(1, 1, 0.85);
  } else if (style === 'bun' && !hatted) {
    place(new SphereGeometry(0.075, 12, 8), k.hair, hips, 0, y + 0.13, -0.1, k);
  } else if (style === 'long') {
    place(
      new CapsuleGeometry(0.07, 0.2, CAP_SEGMENTS, RADIAL_SEGMENTS),
      k.hair,
      hips,
      0,
      y - 0.13,
      -0.13,
      k,
    ).scale.set(1.9, 1, 0.55);
  }

  if (palette.hat === undefined) return;
  const hat = paint(palette.hat, 'cloth');
  place(new CylinderGeometry(0.24, 0.24, 0.025, 16), hat, hips, 0, y + 0.125, 0, k);
  place(new ConeGeometry(0.14, 0.26, 12), hat, hips, 0, y + 0.255, 0, k);
  place(new CylinderGeometry(0.133, 0.137, 0.04, 12, 1, true), k.trim, hips, 0, y + 0.15, 0, k);
}

/** `side` is +1 for the left arm (+X) and -1 for the right arm. */
function dressArm(arm: Group, side: 1 | -1, k: Kit): void {
  const w = k.w;
  place(new SphereGeometry(0.085, 10, 7), k.sleeves, arm, -0.012 * side, 0, 0, k);

  const upper = new Group();
  upper.rotation.x = ARM.upperTilt;
  arm.add(upper);
  k.mesh.scaffold(upper);
  place(
    new CapsuleGeometry(0.058, 0.17, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.sleeves,
    upper,
    0,
    -0.13,
    0,
    k,
  ).scale.set(w, 1, w);
  place(
    new SphereGeometry(0.056, ...SMALL_SPHERE),
    k.sleeves,
    upper,
    0,
    PERSON.elbowY,
    0,
    k,
  ).scale.set(w, 1, w);

  const forearm = new Group();
  forearm.position.y = PERSON.elbowY;
  forearm.rotation.x = ARM.forearmBend;
  upper.add(forearm);
  place(
    new CapsuleGeometry(0.046, 0.1, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.skin,
    forearm,
    0,
    -0.085,
    0,
    k,
  ).scale.set(w, 1, w);
  // Mitt: flattened side to side, palm facing the body.
  place(
    new CapsuleGeometry(0.045, 0.05, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.skin,
    forearm,
    0,
    -ARM.forearmLength,
    0,
    k,
  ).scale.set(0.72 * w, 1, 1.12 * w);
}

function dressLeg(leg: Group, k: Kit): void {
  const w = k.w;
  place(
    new CapsuleGeometry(0.078, 0.26, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.pants,
    leg,
    0,
    -0.2,
    0,
    k,
  ).scale.set(w, 1, w);
  place(
    new SphereGeometry(0.066, ...SMALL_SPHERE),
    k.pants,
    leg,
    0,
    PERSON.kneeY,
    0.005,
    k,
  ).scale.set(w, 1, w);
  place(
    new CapsuleGeometry(0.062, 0.26, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.pants,
    leg,
    0,
    -0.62,
    0,
    k,
  ).scale.set(w, 1, w);
  // Boot cuff overlapping the shin bottom and the foot top.
  place(new CylinderGeometry(0.074, 0.07, 0.12, 8), k.boots, leg, 0, -0.77, 0, k).scale.set(
    w,
    1,
    w,
  );
  // Foot: a capsule lying along +Z, sole on the ground, toes ahead of the shin.
  const foot = place(
    new CapsuleGeometry(0.06, 0.12, CAP_SEGMENTS, RADIAL_SEGMENTS),
    k.boots,
    leg,
    0,
    PERSON.bootY,
    0.06,
    k,
  );
  foot.rotation.x = Math.PI / 2;
  foot.scale.set(1.15 * w, 1, 0.75);
}

/** Registers a part with the person's {@link MeshKit}; see {@link MeshKit.place}. */
function place(
  geometry: BufferGeometry,
  surface: FigurePaint,
  parent: Group,
  x: number,
  y: number,
  z: number,
  k: Kit,
): Object3D {
  return k.mesh.place(geometry, surface, parent, x, y, z);
}
