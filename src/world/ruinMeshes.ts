import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';

import type { RuinPlacement } from './vegetationPlacement';

const wall = new MeshStandardMaterial({ color: 0xc4b49a, roughness: 0.9 });
const timber = new MeshStandardMaterial({ color: 0x6a4630, roughness: 0.86 });
const roof = new MeshStandardMaterial({ color: 0x8d3d32, roughness: 0.84 });
const stone = new MeshStandardMaterial({ color: 0x8d877f, roughness: 0.95, flatShading: true });
const adobe = new MeshStandardMaterial({ color: 0xc4925c, roughness: 0.92 });
const dark = new MeshStandardMaterial({ color: 0x4e463e, roughness: 0.8 });
const plank = new MeshStandardMaterial({ color: 0x8a6244, roughness: 0.84 });
const snowStone = new MeshStandardMaterial({ color: 0xd5dde4, roughness: 0.78 });

/** A small building or ruin standing on the ground at the placement point. */
export function createRuinGroup(ruin: RuinPlacement): Group {
  const group = new Group();
  group.name = `ruin-${ruin.kind}`;
  group.position.set(ruin.x, ruin.y, ruin.z);
  group.rotation.y = ruin.rotation;
  switch (ruin.kind) {
    case 'cottage':
      addCottage(group);
      break;
    case 'stones':
      addStones(group);
      break;
    case 'arch':
      addArch(group);
      break;
    case 'cairn':
      addCairn(group);
      break;
    case 'adobe':
      addAdobe(group);
      break;
    case 'stilt':
      addStilt(group);
      break;
    case 'shelter':
      addShelter(group);
      break;
    case 'wreck':
      addWreck(group);
      break;
  }
  group.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

function addCottage(group: Group): void {
  const body = mesh(new BoxGeometry(2.6, 1.5, 2.2), wall, 0, 0.75, 0);
  const beam = mesh(new BoxGeometry(2.7, 0.16, 0.16), timber, 0, 1.15, 1.05);
  const cap = mesh(new ConeGeometry(1.7, 1.15, 4), roof, 0.25, 2.15, -0.1);
  cap.rotation.y = Math.PI / 4;
  cap.rotation.z = 0.18;
  const door = mesh(new BoxGeometry(0.55, 0.9, 0.08), dark, 0, 0.45, 1.12);
  group.add(body, beam, cap, door);
}

function addStones(group: Group): void {
  for (let index = 0; index < 5; index++) {
    const angle = (index / 5) * Math.PI * 2;
    const height = 1.15 + (index % 3) * 0.45;
    const pillar = mesh(
      new CylinderGeometry(0.28, 0.36, height, 6),
      stone,
      Math.cos(angle) * 2.15,
      height / 2,
      Math.sin(angle) * 2.15,
    );
    pillar.rotation.z = (index - 2) * 0.06;
    group.add(pillar);
  }
}

function addArch(group: Group): void {
  const left = mesh(new BoxGeometry(0.55, 2.3, 0.55), stone, -1.15, 1.15, 0);
  const right = mesh(new BoxGeometry(0.5, 1.7, 0.5), stone, 1.15, 0.85, 0);
  right.rotation.z = 0.08;
  const lintel = mesh(new BoxGeometry(2.5, 0.32, 0.48), stone, -0.05, 2.35, 0);
  const fallen = mesh(new BoxGeometry(1.4, 0.28, 0.4), stone, 0.4, 0.16, 1.1);
  fallen.rotation.y = 0.4;
  group.add(left, right, lintel, fallen);
}

function addCairn(group: Group): void {
  const bottom = mesh(new IcosahedronGeometry(0.7, 0), stone, 0, 0.45, 0);
  const middle = mesh(new IcosahedronGeometry(0.48, 0), stone, 0.08, 1.05, 0.05);
  const top = mesh(new IcosahedronGeometry(0.28, 0), snowStone, -0.04, 1.5, 0);
  group.add(bottom, middle, top);
}

function addAdobe(group: Group): void {
  const body = mesh(new BoxGeometry(2.8, 1.7, 2.3), adobe, 0, 0.85, 0);
  const flat = mesh(new BoxGeometry(3.1, 0.16, 2.6), adobe, 0, 1.75, 0);
  const hole = mesh(new BoxGeometry(0.4, 0.4, 0.08), dark, 0.7, 1.15, 1.16);
  const stub = mesh(new BoxGeometry(0.7, 0.9, 0.35), adobe, -1.5, 0.45, 0.8);
  group.add(body, flat, hole, stub);
}

function addStilt(group: Group): void {
  const posts = [
    [-0.8, -0.7],
    [0.8, -0.7],
    [-0.8, 0.7],
    [0.8, 0.7],
  ] as const;
  for (const [x, z] of posts) {
    group.add(mesh(new CylinderGeometry(0.08, 0.1, 1.3, 5), timber, x, 0.65, z));
  }
  const deck = mesh(new BoxGeometry(2.2, 0.12, 1.8), plank, 0, 1.32, 0);
  const hut = mesh(new BoxGeometry(1.3, 0.9, 1.1), wall, 0, 1.85, 0);
  const cap = mesh(new ConeGeometry(0.95, 0.55, 4), roof, 0, 2.45, 0);
  cap.rotation.y = Math.PI / 4;
  group.add(deck, hut, cap);
}

function addShelter(group: Group): void {
  const body = mesh(new BoxGeometry(2.2, 1.15, 1.8), snowStone, 0, 0.58, 0);
  const slab = mesh(new BoxGeometry(2.5, 0.14, 2.1), stone, 0.1, 1.22, 0);
  slab.rotation.z = -0.08;
  group.add(body, slab);
}

function addWreck(group: Group): void {
  const left = mesh(new CylinderGeometry(0.1, 0.14, 1.7, 5), timber, -0.7, 0.7, 0);
  left.rotation.z = 0.35;
  const right = mesh(new CylinderGeometry(0.09, 0.12, 1.2, 5), timber, 0.8, 0.45, 0.3);
  right.rotation.x = 0.5;
  const rib = mesh(new BoxGeometry(1.6, 0.08, 0.12), plank, 0.1, 0.2, 0.15);
  rib.rotation.y = 0.3;
  group.add(left, right, rib);
}

function mesh(
  geometry: BoxGeometry | CylinderGeometry | ConeGeometry | IcosahedronGeometry,
  material: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
): Mesh {
  const part = new Mesh(geometry, material);
  part.position.set(x, y, z);
  return part;
}
