/** Locomotion mode of the player. */
export type MovementState = 'ground' | 'air' | 'climb' | 'slide' | 'swim';

/** Reason for HP loss. */
export type DamageCause = 'fall' | 'drown' | 'other';

/** Plain, read-only-from-outside snapshot of the player's vitals (updated in place). */
export interface PlayerStats {
  /** Health in quarter hearts. */
  hp: number;
  /** Max health in quarter hearts (4 per heart). */
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** True during the post-exhaustion lockout. */
  staminaExhausted: boolean;
}
