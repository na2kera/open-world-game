import { Color } from 'three';

import { WATER_LEVEL, WORLD_HALF, WORLD_SIZE } from '../config';
import { classifyBiome, type Terrain } from '../world/Terrain';
import { BIOME_COLORS } from '../world/terrainColors';

/** Resolution of the pre-rendered world map (pixels per side). */
const MAP_RESOLUTION = 512;
const UNITS_PER_PIXEL = WORLD_SIZE / MAP_RESOLUTION;
/** Rows of the world map rendered per frame (spreads the cost over ~half a second). */
const ROWS_PER_FRAME = 12;
/** Displayed size in CSS pixels. */
const DISPLAY_SIZE = 176;
/** World units from the map centre to its edge. */
const VIEW_RADIUS = 256;
/** Hillshade strength per unit of height difference. */
const HILLSHADE = 0.035;
const HILLSHADE_MIN = 0.65;
const HILLSHADE_MAX = 1.3;
/** Water gets darker with depth down to this factor. */
const WATER_DEPTH_SHADE = 0.02;
const WATER_MIN_SHADE = 0.55;
const ARROW_SIZE = 7;
/** Arrow outline in units of {@link ARROW_SIZE}, pointing up (-y). */
const ARROW_SHAPE: readonly (readonly [number, number])[] = [
  [0, -1.3],
  [0.85, 1],
  [0, 0.45],
  [-0.85, 1],
];
const ARROW_FILL = '#ffd94a';
const ARROW_STROKE = 'rgba(0, 0, 0, 0.7)';
const ARROW_STROKE_WIDTH = 1.5;
/** Background shown where the world map is not rendered yet / outside the world. */
const UNRENDERED_FILL = '#1d3a52';
const BYTE = 255;
const RGBA = 4;

const tmpColor = new Color();

export type MinimapMarkerShape = 'dot' | 'diamond' | 'chest' | 'quest';

export interface MinimapMarker {
  readonly id: string;
  x: number;
  z: number;
  color: string;
  shape: MinimapMarkerShape;
  visible?: boolean;
}

/**
 * Corner minimap: the whole world is rendered once (progressively) into a small biome-coloured,
 * hill-shaded canvas, then a window around the player is drawn every frame (north up).
 */
export class Minimap {
  readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly source = document.createElement('canvas');
  private readonly sourceContext: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly previousRow = new Float32Array(MAP_RESOLUTION);
  private nextRow = 0;
  private reveals: readonly { x: number; z: number; radius: number }[] = [];
  private readonly pixelRatio: number;
  private readonly markers = new Map<string, MinimapMarker>();

  constructor(private readonly terrain: Terrain) {
    this.element.className = 'hud-minimap';
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = DISPLAY_SIZE * this.pixelRatio;
    this.canvas.height = DISPLAY_SIZE * this.pixelRatio;
    this.canvas.style.width = `${DISPLAY_SIZE}px`;
    this.canvas.style.height = `${DISPLAY_SIZE}px`;
    const north = document.createElement('div');
    north.className = 'hud-minimap-north';
    north.textContent = 'N';
    this.element.append(this.canvas, north);

    this.source.width = MAP_RESOLUTION;
    this.source.height = MAP_RESOLUTION;
    const context = this.canvas.getContext('2d');
    const sourceContext = this.source.getContext('2d');
    if (!context || !sourceContext) throw new Error('2D canvas not supported');
    this.context = context;
    this.sourceContext = sourceContext;
    this.image = sourceContext.createImageData(MAP_RESOLUTION, MAP_RESOLUTION);
  }

  /** True once the whole world map has been rendered. */
  get isComplete(): boolean {
    return this.nextRow >= MAP_RESOLUTION;
  }

  /** Adds or replaces a world-space marker. The same API is reusable for Phase 2b quests. */
  upsertMarker(marker: MinimapMarker): void {
    this.markers.set(marker.id, marker);
  }

  removeMarker(id: string): void {
    this.markers.delete(id);
  }

  clearMarkers(): void {
    this.markers.clear();
  }

  /** Circles of the world map that are not covered by the undiscovered fog. */
  setReveals(circles: readonly { x: number; z: number; radius: number }[]): void {
    this.reveals = circles;
  }

  /** Renders a few more world-map rows, then draws the view around (x, z). */
  update(x: number, z: number, facing: number): void {
    if (!this.isComplete) this.renderRows();
    this.draw(x, z, facing);
  }

  private renderRows(): void {
    const data = this.image.data;
    const end = Math.min(MAP_RESOLUTION, this.nextRow + ROWS_PER_FRAME);
    for (let row = this.nextRow; row < end; row++) {
      const z = -WORLD_HALF + (row + 0.5) * UNITS_PER_PIXEL;
      let left = Number.NaN;
      for (let col = 0; col < MAP_RESOLUTION; col++) {
        const x = -WORLD_HALF + (col + 0.5) * UNITS_PER_PIXEL;
        const height = this.terrain.heightAt(x, z);
        const above = row === 0 ? height : this.previousRow[col]!;
        const leftHeight = Number.isNaN(left) ? height : left;
        const biome = classifyBiome(height, this.terrain.moistureAt(x, z));
        tmpColor.setHex(BIOME_COLORS[biome]);
        let shade: number;
        if (height < WATER_LEVEL) {
          shade = Math.max(WATER_MIN_SHADE, 1 + (height - WATER_LEVEL) * WATER_DEPTH_SHADE);
        } else {
          const slope = (height - leftHeight + (height - above)) * HILLSHADE;
          shade = Math.min(HILLSHADE_MAX, Math.max(HILLSHADE_MIN, 1 + slope));
        }
        tmpColor.multiplyScalar(shade).convertLinearToSRGB();
        const o = (row * MAP_RESOLUTION + col) * RGBA;
        data[o] = Math.min(BYTE, tmpColor.r * BYTE);
        data[o + 1] = Math.min(BYTE, tmpColor.g * BYTE);
        data[o + 2] = Math.min(BYTE, tmpColor.b * BYTE);
        data[o + 3] = BYTE;
        this.previousRow[col] = height;
        left = height;
      }
    }
    this.sourceContext.putImageData(
      this.image,
      0,
      0,
      0,
      this.nextRow,
      MAP_RESOLUTION,
      end - this.nextRow,
    );
    this.nextRow = end;
  }

  private draw(x: number, z: number, facing: number): void {
    const ctx = this.context;
    const size = this.canvas.width;
    const sourceRadius = VIEW_RADIUS / UNITS_PER_PIXEL;
    const sx = (x + WORLD_HALF) / UNITS_PER_PIXEL - sourceRadius;
    const sy = (z + WORLD_HALF) / UNITS_PER_PIXEL - sourceRadius;
    ctx.fillStyle = UNRENDERED_FILL;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.source, sx, sy, sourceRadius * 2, sourceRadius * 2, 0, 0, size, size);
    this.drawFog(x, z);
    this.drawMarkers(x, z);

    // Player arrow: drawn pointing up, rotated so it matches the facing (screen y = world +z).
    const arrow = ARROW_SIZE * this.pixelRatio;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI - facing);
    ctx.beginPath();
    ARROW_SHAPE.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px * arrow, py * arrow);
      else ctx.lineTo(px * arrow, py * arrow);
    });
    ctx.closePath();
    ctx.fillStyle = ARROW_FILL;
    ctx.strokeStyle = ARROW_STROKE;
    ctx.lineWidth = this.pixelRatio * ARROW_STROKE_WIDTH;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawFog(x: number, z: number): void {
    if (this.reveals.length === 0) return;
    const ctx = this.context;
    const size = this.canvas.width;
    const scale = size / (VIEW_RADIUS * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    for (const circle of this.reveals) {
      const px = size / 2 + (circle.x - x) * scale;
      const py = size / 2 + (circle.z - z) * scale;
      const radius = circle.radius * scale;
      ctx.moveTo(px + radius, py);
      ctx.arc(px, py, radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(6, 10, 16, 0.72)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  private drawMarkers(x: number, z: number): void {
    const ctx = this.context;
    const size = this.canvas.width;
    const scale = size / (VIEW_RADIUS * 2);
    for (const marker of this.markers.values()) {
      if (marker.visible === false) continue;
      const px = size / 2 + (marker.x - x) * scale;
      const py = size / 2 + (marker.z - z) * scale;
      if (px < 0 || px > size || py < 0 || py > size) continue;
      const radius = (marker.shape === 'quest' ? 5 : 3.5) * this.pixelRatio;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = marker.color;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = this.pixelRatio;
      ctx.beginPath();
      if (marker.shape === 'diamond' || marker.shape === 'quest') {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius, 0);
        ctx.closePath();
      } else if (marker.shape === 'chest') {
        ctx.rect(-radius, -radius * 0.65, radius * 2, radius * 1.3);
      } else {
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
