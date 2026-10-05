import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';

import type { Inventory } from './Inventory';
import type { Interactable } from './Interactable';

export interface TreasureChestOptions {
  readonly id: string;
  readonly itemId: string;
  readonly count?: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly inventory: Inventory;
  readonly onOpened: (chest: TreasureChest) => void;
}

const OPEN_DURATION = 0.55;

/** Procedural chest with a hinged-lid opening animation. */
export class TreasureChest implements Interactable {
  readonly root = new Group();
  readonly position = this.root.position;
  readonly radius = 0.8;
  readonly id: string;
  readonly itemId: string;
  private readonly lid = new Group();
  private openingTime = -1;
  private delivered = false;

  constructor(private readonly options: TreasureChestOptions) {
    this.id = options.id;
    this.itemId = options.itemId;
    this.root.name = `chest:${this.id}`;
    this.root.position.set(options.x, options.y, options.z);
    this.build();
  }

  get promptLabel(): string {
    return '開ける';
  }

  get isOpened(): boolean {
    return this.delivered;
  }

  isAvailable(): boolean {
    return this.openingTime < 0 && !this.delivered;
  }

  interact(): void {
    if (!this.isAvailable()) return;
    this.openingTime = 0;
  }

  frameUpdate(frameDt: number): void {
    if (this.openingTime < 0 || this.delivered) return;
    this.openingTime += frameDt;
    const progress = Math.min(1, this.openingTime / OPEN_DURATION);
    this.lid.rotation.x = -progress * Math.PI * 0.62;
    if (progress < 1) return;
    const added = this.options.inventory.add(this.itemId, this.options.count ?? 1);
    if (added <= 0) {
      this.openingTime = -1;
      this.lid.rotation.x = 0;
      return;
    }
    this.delivered = true;
    this.options.onOpened(this);
  }

  dispose(): void {
    disposeObject(this.root);
    this.root.removeFromParent();
  }

  private build(): void {
    const wood = new MeshStandardMaterial({ color: 0x6c3e1e, roughness: 0.82 });
    const metal = new MeshStandardMaterial({ color: 0xc59a42, metalness: 0.55, roughness: 0.35 });
    const base = new Mesh(new BoxGeometry(1.2, 0.62, 0.75), wood);
    base.position.y = 0.31;
    base.castShadow = true;
    const band = new Mesh(new BoxGeometry(0.14, 0.66, 0.79), metal);
    band.position.y = 0.32;
    band.castShadow = true;
    this.lid.position.set(0, 0.62, -0.32);
    const lidMesh = new Mesh(new BoxGeometry(1.2, 0.24, 0.75), wood);
    lidMesh.position.set(0, 0.12, 0.32);
    lidMesh.castShadow = true;
    const lock = new Mesh(new BoxGeometry(0.22, 0.28, 0.12), metal);
    lock.position.set(0, 0.02, 0.7);
    this.lid.add(lidMesh, lock);
    this.root.add(base, band, this.lid);
  }
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
