import {
  CapsuleGeometry,
  type Object3D,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import type { WorldLabelLayer } from '../ui/WorldLabelLayer';
import { damp, dampAngle } from '../utils/math';
import type { NetPlayer } from './room';

const FOLLOW = 10;

/** Another person in the room. The mesh eases toward the latest network snapshot. */
export class RemoteAvatar {
  readonly id: string;
  readonly root = new Group();
  private readonly target = new Vector3();
  private facing = 0;
  private labelText = '';
  private readonly label;

  constructor(player: NetPlayer, parent: Object3D, labels: WorldLabelLayer) {
    this.id = player.id;
    this.labelText = player.name;
    const hue = hashHue(player.id);
    const tunic = new MeshStandardMaterial({ color: hsl(hue, 0.55, 0.42), roughness: 0.7 });
    const body = new Mesh(new CapsuleGeometry(0.28, 0.7, 3, 6), tunic);
    body.position.y = 0.9;
    body.castShadow = true;
    const head = new Mesh(
      new SphereGeometry(0.22, 8, 6),
      new MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.65 }),
    );
    head.position.y = 1.55;
    head.castShadow = true;
    this.root.add(body, head);
    this.root.name = `remote:${player.id}`;
    parent.add(this.root);
    this.apply(player, true);
    this.label = labels.add({
      className: 'npc-label',
      getPosition: (out) =>
        out.set(this.root.position.x, this.root.position.y + 2.15, this.root.position.z),
    });
    this.label.element.textContent = player.name;
  }

  apply(player: NetPlayer, snap = false): void {
    this.target.set(player.x, player.y, player.z);
    this.facing = player.facing;
    if (player.name !== this.labelText) {
      this.labelText = player.name;
      this.label.element.textContent = player.name;
    }
    if (snap) {
      this.root.position.copy(this.target);
      this.root.rotation.y = this.facing;
    }
  }

  frameUpdate(dt: number): void {
    this.root.position.x = damp(this.root.position.x, this.target.x, FOLLOW, dt);
    this.root.position.y = damp(this.root.position.y, this.target.y, FOLLOW, dt);
    this.root.position.z = damp(this.root.position.z, this.target.z, FOLLOW, dt);
    this.root.rotation.y = dampAngle(this.root.rotation.y, this.facing, FOLLOW, dt);
  }

  dispose(): void {
    this.label.remove();
    this.root.removeFromParent();
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}

function hashHue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 33);
  return (hash >>> 0) % 360;
}

function hsl(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const channel =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const match = lightness - chroma / 2;
  const red = channel[0] ?? 0;
  const green = channel[1] ?? 0;
  const blue = channel[2] ?? 0;
  return (
    ((Math.round((red + match) * 255) << 16) |
      (Math.round((green + match) * 255) << 8) |
      Math.round((blue + match) * 255)) >>>
    0
  );
}
