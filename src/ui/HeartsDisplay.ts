import { heartCount, heartQuarters, QUARTERS_PER_HEART } from './hearts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = 32;
const HALF = VIEWBOX / 2;
const HEART_PATH =
  'M16 29 C6 21 1 15 1 9.5 C1 5 4.5 2 8.5 2 C12 2 14.5 4 16 6.5 C17.5 4 20 2 23.5 2 ' +
  'C27.5 2 31 5 31 9.5 C31 15 26 21 16 29 Z';
/** Quadrant origins filled in order: top-left, top-right, bottom-right, bottom-left. */
const QUADRANTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [HALF, 0],
  [HALF, HALF],
  [0, HALF],
];

/** Row of heart containers in the top-left; each heart fills by quarters. */
export class HeartsDisplay {
  readonly element = document.createElement('div');
  private quarters: SVGPathElement[][] = [];
  private shownHp = -1;
  private shownMax = -1;

  constructor() {
    this.element.className = 'hud-hearts';
  }

  /** Re-renders only when HP or max HP changed. */
  update(hp: number, maxHp: number): void {
    if (maxHp !== this.shownMax) this.rebuild(maxHp);
    if (hp === this.shownHp) return;
    this.shownHp = hp;
    this.quarters.forEach((paths, heartIndex) => {
      const filled = heartQuarters(hp, heartIndex);
      paths.forEach((path, q) => path.classList.toggle('is-filled', q < filled));
    });
  }

  private rebuild(maxHp: number): void {
    this.shownMax = maxHp;
    this.shownHp = -1;
    this.element.replaceChildren();
    this.quarters = [];
    for (let i = 0; i < heartCount(maxHp); i++) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${VIEWBOX} ${VIEWBOX}`);
      svg.classList.add('hud-heart');
      const defs = document.createElementNS(SVG_NS, 'defs');
      svg.appendChild(defs);

      const empty = document.createElementNS(SVG_NS, 'path');
      empty.setAttribute('d', HEART_PATH);
      empty.classList.add('heart-empty');
      svg.appendChild(empty);

      const paths: SVGPathElement[] = [];
      for (let q = 0; q < QUARTERS_PER_HEART; q++) {
        const [x, y] = QUADRANTS[q] ?? [0, 0];
        const clipId = `hud-heart-${i}-${q}`;
        const clip = document.createElementNS(SVG_NS, 'clipPath');
        clip.id = clipId;
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(HALF));
        rect.setAttribute('height', String(HALF));
        clip.appendChild(rect);
        defs.appendChild(clip);

        const fill = document.createElementNS(SVG_NS, 'path');
        fill.setAttribute('d', HEART_PATH);
        fill.setAttribute('clip-path', `url(#${clipId})`);
        fill.classList.add('heart-fill');
        svg.appendChild(fill);
        paths.push(fill);
      }

      const outline = document.createElementNS(SVG_NS, 'path');
      outline.setAttribute('d', HEART_PATH);
      outline.classList.add('heart-outline');
      svg.appendChild(outline);

      this.quarters.push(paths);
      this.element.appendChild(svg);
    }
  }
}
