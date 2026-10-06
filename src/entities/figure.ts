import {
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';

/** Shared proportions. Feet are y = 0 when the hips sit at {@link PERSON.hipHeight}. */
export const PERSON = {
  hipHeight: 0.9,
  shoulderX: 0.3,
  shoulderY: 0.52,
  hipX: 0.11,
  handY: -0.46,
  bootY: -0.78,
  headRadius: 0.155,
  torsoLift: 0.34,
} as const;

export interface PersonPalette {
  readonly tunic: number;
  readonly skin: number;
  readonly hair: number;
  readonly pants: number;
  readonly boots: number;
  readonly belt: number;
  readonly hat?: number;
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

const EYE = 0x2a2118;

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

/** Adds the body meshes under joints that the caller animates. */
export function dressPerson(
  limbs: PersonLimbs,
  palette: PersonPalette,
  bucket: PersonBuckets,
): void {
  const tunic = cloth(palette.tunic, 0.72, bucket);
  const skin = cloth(palette.skin, 0.58, bucket);
  const hair = cloth(palette.hair, 0.64, bucket);
  const pants = cloth(palette.pants, 0.78, bucket);
  const boots = cloth(palette.boots, 0.7, bucket);
  const belt = cloth(palette.belt, 0.55, bucket);
  const eye = cloth(EYE, 0.35, bucket);
  const hatMaterial = palette.hat === undefined ? null : cloth(palette.hat, 0.6, bucket);

  const torso = place(
    new CapsuleGeometry(0.15, 0.32, 4, 10),
    tunic,
    limbs.hips,
    0,
    PERSON.torsoLift,
    0,
    bucket,
  );
  torso.scale.set(1.45, 1, 0.82);
  place(new CapsuleGeometry(0.155, 0.05, 3, 10), belt, limbs.hips, 0, 0.08, 0, bucket).scale.set(
    1.35,
    1,
    0.9,
  );

  const headY = 0.72;
  place(new SphereGeometry(PERSON.headRadius, 16, 12), skin, limbs.hips, 0, headY, 0, bucket);
  const hairCap = place(
    new SphereGeometry(PERSON.headRadius + 0.02, 14, 10),
    hair,
    limbs.hips,
    0,
    headY + 0.04,
    -0.02,
    bucket,
  );
  hairCap.scale.set(1.05, 0.62, 1.05);
  place(new SphereGeometry(0.028, 8, 6), eye, limbs.hips, 0.055, headY - 0.01, 0.13, bucket);
  place(new SphereGeometry(0.028, 8, 6), eye, limbs.hips, -0.055, headY - 0.01, 0.13, bucket);

  if (hatMaterial) {
    place(
      new CapsuleGeometry(0.2, 0.02, 2, 10),
      hatMaterial,
      limbs.hips,
      0,
      headY + 0.12,
      0,
      bucket,
    ).scale.set(1, 0.28, 1);
    place(new ConeGeometry(0.13, 0.22, 10), hatMaterial, limbs.hips, 0, headY + 0.28, 0, bucket);
  }

  place(new CapsuleGeometry(0.055, 0.34, 3, 8), tunic, limbs.leftArm, 0, -0.24, 0, bucket);
  place(new CapsuleGeometry(0.055, 0.34, 3, 8), tunic, limbs.rightArm, 0, -0.24, 0, bucket);
  place(new SphereGeometry(0.055, 8, 6), skin, limbs.leftArm, 0, PERSON.handY, 0, bucket);
  place(new SphereGeometry(0.055, 8, 6), skin, limbs.rightArm, 0, PERSON.handY, 0, bucket);

  place(new CapsuleGeometry(0.075, 0.46, 3, 8), pants, limbs.leftLeg, 0, -0.32, 0, bucket);
  place(new CapsuleGeometry(0.075, 0.46, 3, 8), pants, limbs.rightLeg, 0, -0.32, 0, bucket);
  place(new CapsuleGeometry(0.07, 0.12, 2, 8), boots, limbs.leftLeg, 0, PERSON.bootY, 0.02, bucket);
  place(
    new CapsuleGeometry(0.07, 0.12, 2, 8),
    boots,
    limbs.rightLeg,
    0,
    PERSON.bootY,
    0.02,
    bucket,
  );
}

function place(
  geometry: BufferGeometry,
  material: Material,
  parent: Group,
  x: number,
  y: number,
  z: number,
  bucket: PersonBuckets,
): Mesh {
  bucket.geometries.push(geometry);
  const part = new Mesh(geometry, material);
  part.position.set(x, y, z);
  part.castShadow = true;
  parent.add(part);
  return part;
}

function cloth(color: number, roughness: number, bucket: PersonBuckets): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0 });
  bucket.materials.push(material);
  return material;
}
