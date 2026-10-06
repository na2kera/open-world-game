import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';

import type { Interactable } from '../items/Interactable';
import type { WorldLabelLayer } from '../ui/WorldLabelLayer';

export interface NpcOptions {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly scale: number;
  readonly hat: number;
  readonly parent: Group;
  readonly labels: WorldLabelLayer;
  readonly onTalk: (npc: Npc) => void;
}

/** Villager. Stands still, turns toward the player when asked, and can be talked to. */
export class Npc implements Interactable {
  readonly id: string;
  readonly name: string;
  readonly position: Vector3;
  readonly radius = 1.1;
  readonly root = new Group();
  private readonly label;

  constructor(options: NpcOptions) {
    this.id = options.id;
    this.name = options.name;
    this.position = new Vector3(options.x, options.y, options.z);
    this.root.position.copy(this.position);
    this.root.scale.setScalar(options.scale);
    const body = new Mesh(
      new CapsuleGeometry(0.32, 0.7, 3, 6),
      new MeshStandardMaterial({ color: options.color, roughness: 0.75 }),
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const head = new Mesh(
      new SphereGeometry(0.26, 8, 6),
      new MeshStandardMaterial({ color: 0xf0d2b0, roughness: 0.7 }),
    );
    head.position.y = 1.55;
    head.castShadow = true;
    const hat = new Mesh(
      new SphereGeometry(0.2, 8, 6),
      new MeshStandardMaterial({ color: options.hat, roughness: 0.6 }),
    );
    hat.position.y = 1.78;
    hat.scale.y = 0.55;
    this.root.add(body, head, hat);
    options.parent.add(this.root);
    this.label = options.labels.add({
      className: 'npc-label',
      getPosition: (out) => out.set(this.position.x, this.position.y + 2.3, this.position.z),
    });
    this.label.element.textContent = options.name;
    this.onTalk = options.onTalk;
  }

  private readonly onTalk: (npc: Npc) => void;

  get promptLabel(): string {
    return '話す';
  }

  isAvailable(): boolean {
    return true;
  }

  interact(): void {
    this.onTalk(this);
  }

  lookAt(x: number, z: number): void {
    this.root.rotation.y = Math.atan2(x - this.position.x, z - this.position.z);
  }

  setMark(mark: '!' | '?' | null): void {
    this.label.element.textContent = mark ? `${this.name}  ${mark}` : this.name;
  }
}
