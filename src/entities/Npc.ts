import { Group, Vector3 } from 'three';

import type { Interactable } from '../items/Interactable';
import type { WorldLabelLayer } from '../ui/WorldLabelLayer';
import { createStandingPerson, type HairStyle, type PersonBuild } from './figure';

export interface NpcOptions {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly scale: number;
  readonly hat?: number | undefined;
  readonly hairStyle?: HairStyle | undefined;
  /** Hair colour. */
  readonly hair?: number | undefined;
  readonly build?: PersonBuild | undefined;
  readonly trim?: number | undefined;
  readonly sleeves?: number | undefined;
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
    this.root.add(
      createStandingPerson({
        tunic: options.color,
        skin: 0xf1c9a5,
        hair: options.hair ?? 0x4a3428,
        pants: 0x4e4034,
        boots: 0x3a2a1c,
        belt: 0x2c2118,
        hat: options.hat,
        hairStyle: options.hairStyle,
        build: options.build,
        trim: options.trim,
        sleeves: options.sleeves,
      }),
    );
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
