/**
 * Central tuning constants. Everything that would otherwise be a magic number in gameplay,
 * rendering or world generation code lives here so later phases can tweak it in one place.
 */

// ---------------------------------------------------------------------------
// Engine / loop
// ---------------------------------------------------------------------------

/** Fixed simulation timestep in seconds. */
export const FIXED_TIMESTEP = 1 / 60;
/** Upper bound of a single frame delta (prevents spiral of death after hitches / tab switches). */
export const MAX_FRAME_DT = 0.05;
/** Maximum device pixel ratio used by the renderer. */
export const MAX_PIXEL_RATIO = 2;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** World seed used when `?seed=` is not supplied. */
export const DEFAULT_SEED = 20260;
/** Side length of the square world in units (centered on the origin). */
export const WORLD_SIZE = 4096;
/** Half of {@link WORLD_SIZE}. */
export const WORLD_HALF = WORLD_SIZE / 2;
/** Height of the global water plane (sea and lakes). */
export const WATER_LEVEL = 0;
/** Terrain heights are clamped to this value. */
export const MAX_TERRAIN_HEIGHT = 180;

/** Side length of a terrain chunk in units. */
export const CHUNK_SIZE = 64;
/** Terrain draw distance in units. */
export const VIEW_DISTANCE = 600;
/** Distance thresholds (to chunk bounds) for LOD 0 and LOD 1; anything farther uses LOD 2. */
export const LOD_DISTANCES: readonly [number, number] = [160, 352];
/** Grid segments per chunk side for LOD 0 / 1 / 2. */
export const LOD_SEGMENTS: readonly [number, number, number] = [64, 32, 16];
/** Maximum terrain chunk (re)builds per rendered frame. */
export const CHUNK_BUILDS_PER_FRAME = 2;
/** A second chunk is only built in the same frame if the first took less than this (ms). */
export const CHUNK_BUILD_BUDGET_MS = 4;
/** Focus movement (units) that triggers recomputing which chunks / cells should be loaded. */
export const STREAMING_REFRESH_DISTANCE = 8;
/** Chunks within this many chunk rings around the spawn are built synchronously at startup. */
export const CHUNK_PRELOAD_RINGS = 2;
/** Depth of the vertical skirt hiding cracks between chunks of different LOD. */
export const CHUNK_SKIRT_DEPTH = 8;

/** Side length of a vegetation cell in units. */
export const VEGETATION_CELL_SIZE = 128;
/** Trees and rocks are shown within this distance (to cell bounds). */
export const VEGETATION_DISTANCE = 320;
/** Grass is shown within this distance (to cell bounds). */
export const GRASS_DISTANCE = 96;
/** Maximum vegetation cell (re)builds per rendered frame. */
export const VEGETATION_BUILDS_PER_FRAME = 1;

// ---------------------------------------------------------------------------
// Time of day / rendering
// ---------------------------------------------------------------------------

/** Real seconds per in-game day. */
export const DAY_LENGTH_SEC = 12 * 60;
/** Time of day at startup as a fraction of a day (0 = midnight). */
export const START_TIME_OF_DAY = 7 / 24;

export const CAMERA_FOV = 60;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1400;
export const FOG_NEAR = 180;
export const FOG_FAR = VIEW_DISTANCE - 20;

export const SHADOW_CONFIG = {
  /** Half extent of the orthographic shadow camera around the player. */
  extent: 80,
  mapSize: 2048,
  /** Distance of the light from its target along the sun direction. */
  lightDistance: 250,
  bias: -0.0005,
  normalBias: 0.04,
} as const;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const PLAYER_CONFIG = {
  walkSpeed: 6,
  sprintSpeed: 11,
  swimSpeed: 3,
  climbSpeed: 2.6,
  /** Horizontal acceleration on the ground (u/s²). */
  groundAccel: 45,
  /** Horizontal deceleration on the ground when there is no input (u/s²). */
  groundDecel: 35,
  /** Fraction of ground acceleration available in the air. */
  airControl: 0.35,
  gravity: 30,
  maxFallSpeed: 55,
  jumpHeight: 1.7,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  /** Cylinder radius used for environment collision. */
  radius: 0.4,
  /** Height of the player's chest (camera target) above the feet. */
  chestHeight: 1.4,
  /** Surfaces steeper than this (degrees from up) are climbed instead of walked. */
  maxWalkSlopeDeg: 50,
  /** Hysteresis applied when leaving climb mode (degrees). */
  climbExitHysteresisDeg: 4,
  /** Downhill acceleration while sliding on steep slopes (u/s²). */
  slideAccel: 18,
  /** Max distance the feet may hover above ground and still snap down while walking. */
  groundSnapDistance: 0.6,
  /** Water depth at which the player starts swimming. */
  swimDepth: 1.2,
  /** How far below the water surface the feet hang while swimming. */
  swimFloatDepth: 1.1,
  /** Small hop away from the wall when jumping off a climb surface. */
  climbJumpOffSpeed: 4,
  climbJumpUpSpeed: 5,
  fallDamageHeight: 12,
  /** Damage in quarter hearts per unit fallen beyond {@link fallDamageHeight} (rounded up). */
  fallDamagePerUnit: 0.25,
  /** Quarter hearts lost when stamina runs out while swimming. */
  drownDamage: 2,
  /** Interval (s) between "last safe ground" snapshots. */
  safeGroundInterval: 0.5,
  /** Distance kept from the world edge. */
  worldEdgeMargin: 8,
  /** Rotation smoothing towards movement direction. */
  turnLambda: 14,
  /** Hearts * 4 = quarter hearts. */
  maxHpQuarters: 12,
} as const;

export const STAMINA_CONFIG = {
  max: 100,
  sprintDrain: 15,
  climbDrain: 10,
  swimDrain: 8,
  regen: 25,
  /** Seconds after the last drain before regeneration starts. */
  regenDelay: 1,
  /** Seconds the player cannot exert after emptying stamina. */
  exhaustedLock: 3,
} as const;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export const CAMERA_CONFIG = {
  distance: 6,
  minDistance: 1.2,
  defaultPitch: 0.3,
  minPitch: -0.9,
  maxPitch: 1.2,
  /** Stick look speed in radians / second at full deflection. */
  stickYawSpeed: 3.2,
  stickPitchSpeed: 2.2,
  /** Mouse look in radians per pixel. */
  mouseSensitivity: 0.0026,
  /** Smoothing of the followed target position. */
  followLambda: 14,
  /** Smoothing when the boom grows back after a terrain collision. */
  distanceGrowLambda: 4,
  resetLambda: 10,
  lookTargetLambda: 6,
  /** Minimum clearance above terrain. */
  terrainClearance: 0.5,
  /** Minimum clearance above the water surface. */
  waterClearance: 0.3,
  /** Samples taken along the camera boom for terrain occlusion. */
  occlusionSamples: 8,
} as const;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const INPUT_CONFIG = {
  /** Radial deadzone for analog sticks. */
  stickDeadzone: 0.15,
  /** Analog button / trigger threshold to count as pressed. */
  buttonThreshold: 0.5,
  /** Holding B at least this long turns it into sprint; shorter taps dodge. */
  sprintHoldTime: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Items / interaction / menus
// ---------------------------------------------------------------------------

export const ITEM_CELL_SIZE = 128;
export const ITEM_ACTIVE_DISTANCE = 192;
export const INTERACTION_DISTANCE = 2.5;
export const INTERACTION_FORWARD_DOT = 0.15;

export const MENU_CONFIG = {
  repeatDelay: 0.36,
  repeatInterval: 0.1,
  stickThreshold: 0.55,
} as const;

// ---------------------------------------------------------------------------
// Combat / enemies / save
// ---------------------------------------------------------------------------

export const COMBAT_CONFIG = {
  unarmedAttack: 1,
  attackRange: 2.2,
  attackArcRadians: (Math.PI * 2) / 3,
  comboBufferSeconds: 0.28,
  dodgeDistance: 3.5,
  dodgeStamina: 15,
  dodgeInvulnerability: 0.3,
  damageInvulnerability: 0.55,
  lockOnRange: 22,
} as const;

export const ENEMY_ACTIVE_DISTANCE = 250;
export const ENEMY_CAMP_CELL_SIZE = 256;
export const SAVE_INTERVAL_SEC = 60;
