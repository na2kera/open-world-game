const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 56;
const RADIUS = 22;
const STROKE = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Seconds the full wheel stays visible before fading out. */
const HIDE_DELAY = 0.8;
/** Below this ratio the wheel turns to its "low" colour. */
const LOW_RATIO = 0.25;

/** Circular stamina gauge next to the player; fades out when full, blinks red when exhausted. */
export class StaminaWheel {
  readonly element = document.createElement('div');
  private readonly arc: SVGCircleElement;
  private fullTimer = HIDE_DELAY;
  private shownRatio = -1;

  constructor() {
    this.element.className = 'hud-stamina';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    const track = this.circle('stamina-track');
    this.arc = this.circle('stamina-arc');
    this.arc.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));
    svg.append(track, this.arc);
    this.element.appendChild(svg);
  }

  update(dt: number, value: number, max: number, exhausted: boolean): void {
    const ratio = max > 0 ? value / max : 0;
    if (ratio >= 1) this.fullTimer += dt;
    else this.fullTimer = 0;
    this.element.classList.toggle('is-visible', this.fullTimer < HIDE_DELAY);
    this.element.classList.toggle('is-exhausted', exhausted);
    this.element.classList.toggle('is-low', ratio < LOW_RATIO);
    if (ratio !== this.shownRatio) {
      this.shownRatio = ratio;
      this.arc.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - ratio)));
    }
  }

  private circle(className: string): SVGCircleElement {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(SIZE / 2));
    circle.setAttribute('cy', String(SIZE / 2));
    circle.setAttribute('r', String(RADIUS));
    circle.setAttribute('stroke-width', String(STROKE));
    circle.setAttribute('fill', 'none');
    circle.classList.add(className);
    return circle;
  }
}
