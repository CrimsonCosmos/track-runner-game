/**
 * ECS Components for Track Runner
 *
 * Components are pure data containers. All game state for entities
 * is stored in TypedArrays for cache-friendly access and easy
 * GPU transfer.
 */

// Maximum supported entities
export const MAX_RUNNERS = 128;

/**
 * Position component - track-relative positioning
 */
export interface PositionComponent {
  distance: Float32Array;      // Distance along track (meters)
  lanePosition: Float32Array;  // Lane offset from inside edge
  worldX: Float32Array;        // Computed world X
  worldY: Float32Array;        // Computed world Y (ground height)
  worldZ: Float32Array;        // Computed world Z
  rotationY: Float32Array;     // Facing direction (radians)
}

/**
 * Velocity component - movement state
 */
export interface VelocityComponent {
  currentSpeed: Float32Array;  // Current speed (m/s)
  targetSpeed: Float32Array;   // Target speed (m/s)
}

/**
 * Animation component - animation state per entity
 */
export interface AnimationComponent {
  phase: Float32Array;         // Animation cycle phase [0-1]
  strideMultiplier: Float32Array; // Random variation per runner
}

/**
 * Race data component - split times and finish info
 */
export interface RaceDataComponent {
  splitTimes: Float32Array;    // 5 splits per runner (flattened)
  finalTime: Float32Array;     // Target finish time
}

/**
 * Flags component - packed bit flags
 * Bit 0: finished
 * Bit 1: squished
 * Bit 2: isPlayer
 */
export interface FlagsComponent {
  flags: Uint8Array;
}

// Flag constants
export const FLAG_FINISHED = 0x01;
export const FLAG_SQUISHED = 0x02;
export const FLAG_IS_PLAYER = 0x04;

/**
 * Create all components for a world with given max entities
 */
export function createComponents(maxEntities: number = MAX_RUNNERS) {
  return {
    position: {
      distance: new Float32Array(maxEntities),
      lanePosition: new Float32Array(maxEntities),
      worldX: new Float32Array(maxEntities),
      worldY: new Float32Array(maxEntities),
      worldZ: new Float32Array(maxEntities),
      rotationY: new Float32Array(maxEntities),
    } as PositionComponent,

    velocity: {
      currentSpeed: new Float32Array(maxEntities),
      targetSpeed: new Float32Array(maxEntities),
    } as VelocityComponent,

    animation: {
      phase: new Float32Array(maxEntities),
      strideMultiplier: new Float32Array(maxEntities),
    } as AnimationComponent,

    raceData: {
      splitTimes: new Float32Array(maxEntities * 5),
      finalTime: new Float32Array(maxEntities),
    } as RaceDataComponent,

    flags: {
      flags: new Uint8Array(maxEntities),
    } as FlagsComponent,
  };
}

export type Components = ReturnType<typeof createComponents>;

/**
 * Helper to check flag
 */
export function hasFlag(flags: Uint8Array, entityId: number, flag: number): boolean {
  return (flags[entityId] & flag) !== 0;
}

/**
 * Helper to set flag
 */
export function setFlag(flags: Uint8Array, entityId: number, flag: number, value: boolean): void {
  if (value) {
    flags[entityId] |= flag;
  } else {
    flags[entityId] &= ~flag;
  }
}
