import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';

import { getItemDef } from '../data/items';
import type { Inventory } from './Inventory';
import type { Interactable } from './Interactable';

export interface WorldItemOptions {
  readonly id: string;
  readonly itemId: string;
  readonly count?: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly inventory: Inventory;
  readonly onCollected: (item: WorldItem) => void;
}

/** Rotating, bobbing procedural pickup. */
export class WorldItem implements Interactable {
  readonly root = new Group();
  readonly position = this.root.position;
  readonly radius = 0.45;
  readonly id: string;
  readonly itemId: string;
  readonly count: number;
  private readonly baseY: number;
  private readonly phase: number;
  private available = true;

  constructor(private readonly options: WorldItemOptions) {
    this.id = options.id;
    this.itemId = options.itemId;
    this.count = options.count ?? 1;
    this.baseY = options.y + 0.45;
    this.phase = hashText(options.id) * Math.PI * 2;
    this.root.name = `world-item:${this.id}`;
    this.root.position.set(options.x, this.baseY, options.z);
    this.root.add(createItemMesh(options.itemId));
  }

  get promptLabel(): string {
    return `拾う（${getItemDef(this.itemId)?.name ?? this.itemId}）`;
  }

  isAvailable(): boolean {
    return this.available;
  }

  interact(): void {
    if (!this.available) return;
    const added = this.options.inventory.add(this.itemId, this.count);
    if (added <= 0) return;
    this.available = false;
    this.options.onCollected(this);
  }

  frameUpdate(elapsed: number, frameDt: number): void {
    this.root.rotation.y += frameDt * 1.4;
    this.root.position.y = this.baseY + Math.sin(elapsed * 2.1 + this.phase) * 0.13;
  }

  dispose(): void {
    disposeObject(this.root);
    this.root.removeFromParent();
  }
}

function createItemMesh(itemId: string): Object3D {
  const def = getItemDef(itemId);
  const group = new Group();
  const color = def?.icon.color ?? '#ffffff';
  const material = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    roughness: 0.55,
  });
  let geometry: BufferGeometry;
  switch (def?.icon.shape) {
    case 'leaf':
      geometry = new ConeGeometry(0.24, 0.62, 5);
      break;
    case 'mushroom': {
      const stem = new Mesh(
        new CylinderGeometry(0.09, 0.12, 0.3, 6),
        new MeshStandardMaterial({ color: 0xe7d6b7, roughness: 0.8 }),
      );
      stem.position.y = -0.1;
      const cap = new Mesh(
        new SphereGeometry(0.25, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
        material,
      );
      cap.position.y = 0.05;
      group.add(stem, cap);
      return group;
    }
    case 'fruit':
      geometry = new IcosahedronGeometry(0.28, 1);
      break;
    case 'crystal':
      geometry = new OctahedronGeometry(0.3);
      break;
    case 'horn':
      geometry = new ConeGeometry(0.18, 0.65, 7);
      break;
    case 'sword':
      geometry = new BoxGeometry(0.09, 0.72, 0.08);
      break;
    case 'gear':
      geometry = new TorusGeometry(0.24, 0.09, 6, 10);
      break;
    default:
      geometry = new IcosahedronGeometry(0.25, 0);
      break;
  }
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
