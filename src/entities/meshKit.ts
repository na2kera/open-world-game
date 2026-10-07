import {
  BufferAttribute,
  Color,
  Matrix4,
  Mesh,
  Object3D,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A colour on a named surface finish. Parts sharing a finish and a joint merge into one mesh. */
export interface Paint<F extends string = string> {
  readonly color: Color;
  readonly finish: F;
}

export function paint<F extends string>(color: number | Color, finish: F): Paint<F> {
  return { color: new Color(color), finish };
}

interface Part<F extends string> {
  readonly node: Object3D;
  readonly geometry: BufferGeometry;
  readonly paint: Paint<F>;
}

export interface BakeOptions<F extends string> {
  /** Animated (or root) groups. Each part merges into the nearest joint above it. */
  readonly joints: readonly Object3D[];
  /** Creates the shared material of a finish; called once per finish per bake. */
  readonly material: (finish: F) => Material;
  /** Receives every merged geometry (dispose path). */
  readonly geometries: BufferGeometry[];
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

const tmpMatrix = new Matrix4();

/**
 * Collects procedural parts as transform nodes, then bakes them into one vertex-coloured mesh
 * per (joint, finish). Keeps the draw-call count of composite props and creatures low.
 *
 * Every geometry passed to {@link place} must carry position, normal and uv attributes and be
 * indexed (all built-in three.js primitives do).
 */
export class MeshKit<F extends string = string> {
  private readonly parts: Part<F>[] = [];
  private readonly scaffolds: Object3D[] = [];

  /**
   * Registers a part at (x, y, z) under `parent`. Returns its transform node for further
   * rotation / scale; the geometry is baked by {@link bake}.
   */
  place(
    geometry: BufferGeometry,
    surface: Paint<F>,
    parent: Object3D,
    x: number,
    y: number,
    z: number,
  ): Object3D {
    const node = new Object3D();
    node.position.set(x, y, z);
    parent.add(node);
    this.parts.push({ node, geometry, paint: surface });
    return node;
  }

  /** Marks a helper group (not a joint) for removal once its parts are baked. */
  scaffold<T extends Object3D>(group: T): T {
    this.scaffolds.push(group);
    return group;
  }

  /** Merges every placed part and adds the resulting meshes under their joints. */
  bake(options: BakeOptions<F>): void {
    const batches = new Map<Object3D, Map<F, BufferGeometry[]>>();
    for (const part of this.parts) {
      part.node.updateMatrix();
      tmpMatrix.copy(part.node.matrix);
      let joint = part.node.parent;
      while (joint && !options.joints.includes(joint)) {
        joint.updateMatrix();
        tmpMatrix.premultiply(joint.matrix);
        joint = joint.parent;
      }
      if (!joint) throw new Error('meshKit: part is not under any joint');
      part.geometry.applyMatrix4(tmpMatrix);
      paintVertices(part.geometry, part.paint.color);
      part.node.removeFromParent();

      let byFinish = batches.get(joint);
      if (!byFinish) batches.set(joint, (byFinish = new Map()));
      const list = byFinish.get(part.paint.finish);
      if (list) list.push(part.geometry);
      else byFinish.set(part.paint.finish, [part.geometry]);
    }
    for (const scaffold of this.scaffolds) scaffold.removeFromParent();
    this.parts.length = 0;
    this.scaffolds.length = 0;

    const materials = new Map<F, Material>();
    for (const [joint, byFinish] of batches) {
      for (const [finish, geometries] of byFinish) {
        const merged = mergeGeometries(geometries);
        if (!merged) throw new Error(`meshKit: could not merge ${finish} parts`);
        for (const geometry of geometries) geometry.dispose();
        options.geometries.push(merged);
        let material = materials.get(finish);
        if (!material) {
          material = options.material(finish);
          materials.set(finish, material);
        }
        const mesh = new Mesh(merged, material);
        mesh.castShadow = options.castShadow ?? true;
        mesh.receiveShadow = options.receiveShadow ?? false;
        joint.add(mesh);
      }
    }
  }
}

function paintVertices(geometry: BufferGeometry, color: Color): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}
