import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';

import type { Interactable } from './Interactable';

/** Village cooking pot. Opening the menu is left to the caller. */
export class CookingPot implements Interactable {
  readonly root = new Group();
  readonly position = this.root.position;
  readonly radius = 1.3;
  readonly promptLabel = '料理する';
  private available = true;

  constructor(
    parent: Object3D,
    x: number,
    y: number,
    z: number,
    private readonly onOpen: () => void,
  ) {
    this.root.name = 'cooking-pot';
    this.root.position.set(x, y, z);
    const clay = new MeshStandardMaterial({ color: 0x6e4634, roughness: 0.85 });
    const body = new Mesh(new CylinderGeometry(0.42, 0.34, 0.55, 8), clay);
    body.position.y = 0.45;
    body.castShadow = true;
    const rim = new Mesh(new CylinderGeometry(0.48, 0.48, 0.08, 8), clay);
    rim.position.y = 0.74;
    const fire = new Mesh(
      new CylinderGeometry(0.05, 0.16, 0.28, 5),
      new MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a1a, emissiveIntensity: 0.6 }),
    );
    fire.position.y = 0.16;
    this.root.add(body, rim, fire);
    parent.add(this.root);
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  interact(): void {
    if (!this.available) return;
    this.onOpen();
  }
}
