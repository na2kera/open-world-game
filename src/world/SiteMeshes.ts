import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type Scene,
} from 'three';

import { NPC_DEFS } from '../data/npcs';
import type { HairStyle, PersonBuild } from '../entities/figure';
import type { WorldCollision } from './WorldCollision';
import { placeLandmarks, type PlacedPoint } from './landmarkPlacement';
import type { Platforms } from './Platforms';
import type { Terrain, Vec3Like } from './Terrain';

export interface TowerSite extends PlacedPoint {
  readonly terminalX: number;
  readonly terminalY: number;
  readonly terminalZ: number;
}

export interface BuiltLandmarks {
  readonly towers: readonly TowerSite[];
  readonly shrine: PlacedPoint;
  readonly arena: PlacedPoint;
  readonly npcs: readonly {
    id: string;
    name: string;
    x: number;
    y: number;
    z: number;
    color: number;
    scale: number;
    hat: number | undefined;
    hairStyle: HairStyle | undefined;
    hair: number | undefined;
    build: PersonBuild | undefined;
    trim: number | undefined;
    sleeves: number | undefined;
  }[];
}

const STAIR_STEPS = 26;
const STAIR_RISE = 0.4;
const STAIR_RADIUS = 3.3;

/** Village, towers, shrine, arena and the objective beacon. All procedural. */
export class Landmarks {
  readonly group = new Group();
  private readonly beacon: Mesh;
  private readonly towerGlow = new Map<string, MeshStandardMaterial>();

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    private readonly platforms: Platforms,
    private readonly collision: WorldCollision,
  ) {
    this.group.name = 'landmarks';
    scene.add(this.group);
    this.beacon = new Mesh(
      new CylinderGeometry(0.45, 0.45, 24, 8, 1, true),
      new MeshStandardMaterial({
        color: 0x7ec8ff,
        emissive: 0x7ec8ff,
        emissiveIntensity: 1.6,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    this.group.add(this.beacon);
  }

  build(spawn: Readonly<Vec3Like>): BuiltLandmarks {
    this.buildVillage(spawn);
    const placed = placeLandmarks(spawn.x, spawn.z, this.terrain);
    const towers = placed.towers.map((tower) => this.buildTower(tower));
    this.buildShrine(placed.shrine);
    this.buildArena(placed.arena);
    const npcs = NPC_DEFS.map((def) => {
      const x = spawn.x + def.offsetX;
      const z = spawn.z + def.offsetZ;
      return {
        id: def.id,
        name: def.name,
        x,
        y: this.terrain.heightAt(x, z),
        z,
        color: def.color,
        scale: def.scale,
        hat: def.hat,
        hairStyle: def.hairStyle,
        hair: def.hair,
        build: def.build,
        trim: def.trim,
        sleeves: def.sleeves,
      };
    });
    return { towers, shrine: placed.shrine, arena: placed.arena, npcs };
  }

  resetTowers(): void {
    for (const material of this.towerGlow.values()) {
      material.emissiveIntensity = 0.35;
      material.color.setHex(0x6ea8c9);
      material.emissive.setHex(0x6ea8c9);
    }
  }

  setTowerActive(id: string): void {
    const material = this.towerGlow.get(id);
    if (!material) return;
    material.emissiveIntensity = 2.4;
    material.color.setHex(0xffe08a);
    material.emissive.setHex(0xffe08a);
  }

  setGuide(point: Vec3Like | null): void {
    this.beacon.visible = point !== null;
    if (!point) return;
    this.beacon.position.set(point.x, point.y + 12, point.z);
  }

  private buildVillage(spawn: Readonly<Vec3Like>): void {
    const spots = [
      { x: 14, z: 5 },
      { x: -13, z: 7 },
      { x: 5, z: -14 },
      { x: -11, z: -11 },
    ];
    for (const spot of spots) {
      const x = spawn.x + spot.x;
      const z = spawn.z + spot.z;
      const y = this.terrain.heightAt(x, z);
      if (y < 1) continue;
      this.hut(x, y, z);
      this.collision.addCollider({ x, z, radius: 2.1, baseY: y, topY: y + 3.2 });
    }
  }

  private hut(x: number, y: number, z: number): void {
    const wall = new Mesh(
      new BoxGeometry(3.2, 2.2, 3.2),
      new MeshStandardMaterial({ color: 0xc4a574, roughness: 0.9 }),
    );
    wall.position.set(x, y + 1.1, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    const roof = new Mesh(
      new ConeGeometry(2.7, 1.7, 4),
      new MeshStandardMaterial({ color: 0x8d3d32, roughness: 0.85 }),
    );
    roof.position.set(x, y + 2.95, z);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    const door = new Mesh(
      new BoxGeometry(0.7, 1.35, 0.08),
      new MeshStandardMaterial({ color: 0x5a3924, roughness: 0.8 }),
    );
    door.position.set(x, y + 0.68, z + 1.62);
    const windowMaterial = new MeshStandardMaterial({
      color: 0xffd7a1,
      emissive: 0xffb15a,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    const leftWindow = new Mesh(new BoxGeometry(0.42, 0.42, 0.08), windowMaterial);
    const rightWindow = leftWindow.clone();
    leftWindow.position.set(x - 0.85, y + 1.35, z + 1.62);
    rightWindow.position.set(x + 0.85, y + 1.35, z + 1.62);
    const chimney = new Mesh(
      new CylinderGeometry(0.18, 0.22, 1.1, 6),
      new MeshStandardMaterial({ color: 0x6e5344, roughness: 0.9 }),
    );
    chimney.position.set(x + 0.85, y + 3.15, z - 0.4);
    chimney.castShadow = true;
    this.group.add(wall, roof, door, leftWindow, rightWindow, chimney);
  }

  private buildTower(point: PlacedPoint): TowerSite {
    const { x, y, z, id } = point;
    const stone = new MeshStandardMaterial({ color: 0x8d97a3, roughness: 0.78 });
    const dark = new MeshStandardMaterial({ color: 0x4c555f, roughness: 0.84 });
    const pale = new MeshStandardMaterial({ color: 0xc5ced6, roughness: 0.72 });
    const timber = new MeshStandardMaterial({ color: 0x6a4630, roughness: 0.86 });
    const glowMaterial = new MeshStandardMaterial({
      color: 0x6ea8c9,
      emissive: 0x6ea8c9,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    this.towerGlow.set(id, glowMaterial);
    const add = (...meshes: Mesh[]): void => {
      for (const mesh of meshes) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    };

    const plinth = new Mesh(new CylinderGeometry(1.7, 2.05, 1.15, 8), dark);
    plinth.position.set(x, y + 0.5, z);
    const shaft = new Mesh(new CylinderGeometry(1.12, 1.42, 15.2, 10), stone);
    shaft.position.set(x, y + 8.2, z);
    const cap = new Mesh(
      new ConeGeometry(1.85, 2.4, 10),
      new MeshStandardMaterial({ color: 0x6e7580, roughness: 0.7 }),
    );
    cap.position.set(x, y + 17.2, z);
    const crystal = new Mesh(new OctahedronGeometry(0.55, 0), glowMaterial);
    crystal.position.set(x, y + 18.7, z);
    const gallery = new Mesh(new CylinderGeometry(2.15, 2.15, 0.22, 10), pale);
    gallery.position.set(x, y + 15.55, z);
    add(plinth, shaft, cap, crystal, gallery);

    for (let rib = 0; rib < 6; rib++) {
      const angle = (rib / 6) * Math.PI * 2;
      const pier = new Mesh(new BoxGeometry(0.28, 14.4, 0.42), dark);
      pier.position.set(x + Math.cos(angle) * 1.28, y + 7.6, z + Math.sin(angle) * 1.28);
      pier.rotation.y = -angle;
      add(pier);
    }
    for (const bandY of [4.2, 8.4, 12.4]) {
      const band = new Mesh(new TorusGeometry(1.48, 0.09, 6, 12), pale);
      band.position.set(x, y + bandY, z);
      band.rotation.x = Math.PI / 2;
      add(band);
    }
    const door = new Mesh(new BoxGeometry(0.7, 1.35, 0.12), dark);
    door.position.set(x, y + 0.85, z - 1.55);
    const lintel = new Mesh(new BoxGeometry(1.05, 0.16, 0.2), pale);
    lintel.position.set(x, y + 1.55, z - 1.58);
    add(door, lintel);
    for (let slit = 0; slit < 4; slit++) {
      const angle = slit * 1.4 + 0.6;
      const window = new Mesh(new BoxGeometry(0.16, 0.7, 0.08), glowMaterial);
      window.position.set(
        x + Math.cos(angle) * 1.2,
        y + 6.2 + slit * 1.8,
        z + Math.sin(angle) * 1.2,
      );
      window.lookAt(x, window.position.y, z);
      add(window);
    }
    for (let post = 0; post < 8; post++) {
      const angle = (post / 8) * Math.PI * 2;
      const column = new Mesh(new CylinderGeometry(0.08, 0.1, 1.15, 5), stone);
      column.position.set(x + Math.cos(angle) * 1.95, y + 16.2, z + Math.sin(angle) * 1.95);
      add(column);
    }

    this.collision.addCollider({ x, z, radius: 1.25, baseY: y, topY: y + 16 });
    const ring = new Mesh(new CylinderGeometry(1.7, 1.7, 0.28, 12), glowMaterial);
    let terminalX = x;
    let terminalY = y + 1.2;
    let terminalZ = z;
    for (let step = 0; step < STAIR_STEPS; step++) {
      const angle = step * 0.34;
      const topY = y + (step + 1) * STAIR_RISE;
      const sx = x + Math.cos(angle) * STAIR_RADIUS;
      const sz = z + Math.sin(angle) * STAIR_RADIUS;
      const tread = new Mesh(new BoxGeometry(2.4, 0.22, 2.1), pale);
      tread.position.set(sx, topY, sz);
      tread.rotation.y = -angle;
      const rail = new Mesh(new BoxGeometry(0.12, 0.72, 0.12), timber);
      rail.position.set(
        x + Math.cos(angle) * (STAIR_RADIUS + 0.95),
        topY + 0.42,
        z + Math.sin(angle) * (STAIR_RADIUS + 0.95),
      );
      add(tread, rail);
      this.platforms.add({ x: sx, z: sz, topY, halfX: 1.2, halfZ: 1.05, yaw: -angle });
      if (step === STAIR_STEPS - 1) {
        terminalX = sx;
        terminalY = topY;
        terminalZ = sz;
        ring.position.set(sx, topY + 1.1, sz);
      }
    }
    add(ring);
    return { ...point, terminalX, terminalY, terminalZ };
  }

  private buildShrine(point: PlacedPoint): void {
    const stone = new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.85 });
    const base = new Mesh(new BoxGeometry(3.4, 1.4, 3.4), stone);
    base.position.set(point.x, point.y + 0.7, point.z);
    base.castShadow = true;
    const slab = new Mesh(new BoxGeometry(1.2, 0.8, 1.2), stone);
    slab.position.set(point.x, point.y + 1.8, point.z);
    const crystal = new Mesh(
      new OctahedronGeometry(0.38, 0),
      new MeshStandardMaterial({
        color: 0x9ad7ff,
        emissive: 0x6ec8ff,
        emissiveIntensity: 0.8,
        roughness: 0.25,
        metalness: 0.15,
      }),
    );
    crystal.position.set(point.x, point.y + 2.55, point.z);
    this.group.add(base, slab, crystal);
    this.collision.addCollider({
      x: point.x,
      z: point.z,
      radius: 1.6,
      baseY: point.y,
      topY: point.y + 1.5,
    });
  }

  private buildArena(point: PlacedPoint): void {
    const stone = new MeshStandardMaterial({ color: 0x6e6258, roughness: 0.9 });
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2;
      const pillar = new Mesh(new CylinderGeometry(0.45, 0.55, 5, 6), stone);
      pillar.position.set(
        point.x + Math.cos(angle) * 10,
        point.y + 2.5,
        point.z + Math.sin(angle) * 10,
      );
      pillar.castShadow = true;
      this.group.add(pillar);
    }
  }
}
