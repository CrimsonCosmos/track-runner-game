/**
 * MovementSystem - Updates runner speeds and positions
 *
 * Processes all active runners in a tight loop for cache efficiency.
 * Works with TypedArray components for optimal performance.
 */

import type { Components } from '../components';
import { FLAG_FINISHED, hasFlag, setFlag } from '../components';

// Movement constants
const ACCELERATION_RATE = 2.0;
const BASE_ANIMATION_SPEED = 5000 / 600;
const COOLDOWN_FACTOR = 0.5; // Half speed after finish

export interface MovementSystemConfig {
  timeScaleFactor: number;
  raceDistance: number;
}

/**
 * Calculate target speed based on distance and split times
 */
function getTargetSpeed(
  entityId: number,
  distance: number,
  raceData: { splitTimes: Float32Array; finalTime: Float32Array },
  timeScaleFactor: number
): number {
  const segmentIndex = Math.min(Math.floor(distance / 1000), 4);
  const base = entityId * 5;

  const timeAtStart = segmentIndex === 0 ? 0 : raceData.splitTimes[base + segmentIndex - 1];
  const timeAtEnd = raceData.splitTimes[base + segmentIndex];
  const segmentTime = timeAtEnd - timeAtStart;

  return (1000 / segmentTime) / timeScaleFactor;
}

/**
 * Update all runner movement for one frame
 */
export function updateMovement(
  components: Components,
  activeCount: number,
  delta: number,
  config: MovementSystemConfig
): void {
  const { position, velocity, animation, raceData, flags } = components;
  const { timeScaleFactor, raceDistance } = config;

  // Tight loop over all active entities
  for (let i = 0; i < activeCount; i++) {
    // Check if finished
    if (!hasFlag(flags.flags, i, FLAG_FINISHED) && position.distance[i] >= raceDistance) {
      setFlag(flags.flags, i, FLAG_FINISHED, true);
    }

    // Calculate target speed
    if (hasFlag(flags.flags, i, FLAG_FINISHED)) {
      // Cooldown speed after finishing
      const baseSpeed = getTargetSpeed(i, raceDistance - 1, raceData, timeScaleFactor);
      velocity.targetSpeed[i] = baseSpeed * COOLDOWN_FACTOR;
    } else {
      velocity.targetSpeed[i] = getTargetSpeed(i, position.distance[i], raceData, timeScaleFactor);
    }

    // Smooth acceleration/deceleration
    const current = velocity.currentSpeed[i];
    const target = velocity.targetSpeed[i];
    const accel = ACCELERATION_RATE * delta;

    if (current < target) {
      velocity.currentSpeed[i] = Math.min(current + accel, target);
    } else if (current > target) {
      velocity.currentSpeed[i] = Math.max(current - accel, target);
    }

    // Move forward
    position.distance[i] += velocity.currentSpeed[i] * delta;

    // Update animation phase
    const animScale = velocity.currentSpeed[i] / BASE_ANIMATION_SPEED;
    animation.phase[i] += delta * Math.max(0.3, animScale) * animation.strideMultiplier[i];
  }
}
