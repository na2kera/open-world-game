import { Group, Mesh, MeshStandardMaterial, SphereGeometry, type Vector3 } from 'three';

import type { PlayerSnapshot } from './NetTransport';

/** Placeholder avatar for another player. Not spawned in single-player. */
export class RemotePlayer {
  readonly root = new Group();
  readonly id: string;

  constructor(snapshot: PlayerSnapshot) {
    this.id = snapshot.id;
    const body = new Mesh(
      new SphereGeometry(0.45, 8, 6),
      new MeshStandardMaterial({ color: 0x4aa3d8, roughness: 0.6 }),
    );
    body.position.y = 1;
    this.root.add(body);
    this.apply(snapshot);
  }

  apply(snapshot: PlayerSnapshot): void {
    this.root.position.set(snapshot.x, snapshot.y, snapshot.z);
    this.root.rotation.y = snapshot.facing;
  }

  get position(): Vector3 {
    return this.root.position;
  }
}
