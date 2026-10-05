import { STAMINA_CONFIG } from '../config';

/** Tunables of {@link Stamina}. */
export interface StaminaConfig {
  max: number;
  regen: number;
  regenDelay: number;
  exhaustedLock: number;
}

/**
 * Pure stamina model.
 *
 * - Draining stops regeneration for `regenDelay` seconds.
 * - Hitting zero locks exertion (sprint / climb / swim strokes) for `exhaustedLock` seconds;
 *   regeneration continues meanwhile.
 */
export class Stamina {
  value: number;
  private maxValue: number;
  private sinceDrain = Number.POSITIVE_INFINITY;
  private lockTimer = 0;

  constructor(private readonly config: StaminaConfig = STAMINA_CONFIG) {
    this.value = config.max;
    this.maxValue = config.max;
  }

  get max(): number {
    return this.maxValue;
  }

  /** Fill fraction in [0, 1]. */
  get ratio(): number {
    return this.value / this.maxValue;
  }

  /** True during the lockout after running out. */
  get isExhausted(): boolean {
    return this.lockTimer > 0;
  }

  /** True when stamina may be spent. */
  get canExert(): boolean {
    return !this.isExhausted && this.value > 0;
  }

  get isFull(): boolean {
    return this.value >= this.maxValue;
  }

  /**
   * Advances the model by `dt`. A positive `drainPerSecond` spends stamina (if allowed),
   * otherwise it regenerates after the delay. Returns true if stamina ran out during this call.
   */
  update(dt: number, drainPerSecond: number): boolean {
    if (this.lockTimer > 0) this.lockTimer = Math.max(0, this.lockTimer - dt);
    if (drainPerSecond > 0 && this.canExert) {
      return this.spend(drainPerSecond * dt);
    }
    this.sinceDrain += dt;
    if (this.sinceDrain >= this.config.regenDelay) {
      this.value = Math.min(this.maxValue, this.value + this.config.regen * dt);
    }
    return false;
  }

  /** Spends a fixed amount at once. Returns true if stamina ran out. */
  consume(amount: number): boolean {
    if (!this.canExert) return false;
    return this.spend(amount);
  }

  /** Restores full stamina and clears exhaustion. */
  refill(): void {
    this.value = this.maxValue;
    this.lockTimer = 0;
    this.sinceDrain = Number.POSITIVE_INFINITY;
  }

  /** Restores a persisted value, clamped to the configured maximum. */
  setValue(value: number): void {
    this.value = Math.min(this.maxValue, Math.max(0, value));
    this.lockTimer = 0;
    this.sinceDrain = Number.POSITIVE_INFINITY;
  }

  setMax(max: number): void {
    this.maxValue = Math.max(1, max);
    this.value = Math.min(this.value, this.maxValue);
  }

  private spend(amount: number): boolean {
    this.value -= amount;
    this.sinceDrain = 0;
    if (this.value <= 0) {
      this.value = 0;
      this.lockTimer = this.config.exhaustedLock;
      return true;
    }
    return false;
  }
}
