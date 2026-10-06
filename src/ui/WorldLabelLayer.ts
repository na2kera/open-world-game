import { Vector3, type Camera } from 'three';

import type { System } from '../core/System';

export interface WorldLabelOptions {
  readonly className: string;
  readonly getPosition: (out: Vector3) => Vector3;
  readonly isVisible?: () => boolean;
}

export interface WorldLabelHandle {
  readonly element: HTMLDivElement;
  remove(): void;
}

interface LabelRecord {
  readonly element: HTMLDivElement;
  readonly getPosition: (out: Vector3) => Vector3;
  readonly isVisible?: () => boolean;
}

const tmpPosition = new Vector3();
const tmpDirection = new Vector3();
const tmpToLabel = new Vector3();

/** Single 3D-to-DOM projection layer for enemy HP, alert and lock-on labels. */
export class WorldLabelLayer implements System {
  readonly element = document.createElement('div');
  private readonly labels = new Set<LabelRecord>();

  constructor(
    container: HTMLElement,
    private readonly camera: Camera,
  ) {
    this.element.className = 'world-label-layer';
    container.appendChild(this.element);
  }

  add(options: WorldLabelOptions): WorldLabelHandle {
    const element = document.createElement('div');
    element.className = `world-label ${options.className}`;
    this.element.appendChild(element);
    const record: LabelRecord =
      options.isVisible === undefined
        ? { element, getPosition: options.getPosition }
        : { element, getPosition: options.getPosition, isVisible: options.isVisible };
    this.labels.add(record);
    return {
      element,
      remove: () => {
        this.labels.delete(record);
        element.remove();
      },
    };
  }

  frameUpdate(): void {
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    this.camera.getWorldDirection(tmpDirection);
    for (const label of this.labels) {
      if (label.isVisible && !label.isVisible()) {
        label.element.hidden = true;
        continue;
      }
      label.getPosition(tmpPosition);
      tmpToLabel.copy(tmpPosition).sub(this.camera.position);
      if (tmpToLabel.dot(tmpDirection) <= 0) {
        label.element.hidden = true;
        continue;
      }
      tmpPosition.project(this.camera);
      const visible =
        tmpPosition.z >= -1 &&
        tmpPosition.z <= 1 &&
        tmpPosition.x >= -1.15 &&
        tmpPosition.x <= 1.15 &&
        tmpPosition.y >= -1.15 &&
        tmpPosition.y <= 1.15;
      label.element.hidden = !visible;
      if (!visible) continue;
      label.element.style.transform =
        `translate(-50%, -50%) translate(${((tmpPosition.x + 1) * width) / 2}px, ` +
        `${((-tmpPosition.y + 1) * height) / 2}px)`;
    }
  }

  dispose(): void {
    this.labels.clear();
    this.element.remove();
  }
}
