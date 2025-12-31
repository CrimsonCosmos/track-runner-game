/**
 * CollisionSystem - O(n) collision detection using spatial hashing
 *
 * Uses SpatialHashGrid to reduce collision checks from O(n²) to O(n).
 * For 100 runners, this typically means ~400 checks instead of ~5000.
 */

import type { Components } from '../components';

// Collision constants
const COLLISION_RADIUS = 0.4;
const COLLISION_PUSH_STRENGTH = 3.0;
const DRIFT_LEFT_SPEED = 0.15;
const MIN_LANE_POSITION = 0.75;
const MAX_LANE_POSITION = 2.0;

/**
 * Simple spatial hash grid for collision detection
 */
export class SpatialHashGrid {
  private cellSize: number;
  private invCellSize: number;
  private cells: Map<string, number[]> = new Map();

  constructor(cellSize: number = 5.0) {
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  private getCellKey(x: number, z: number): string {
    const cellX = Math.floor(x * this.invCellSize);
    const cellZ = Math.floor(z * this.invCellSize);
    return `${cellX},${cellZ}`;
  }

  insert(id: number, x: number, z: number): void {
    const key = this.getCellKey(x, z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(id);
  }

  getNearby(x: number, z: number): number[] {
    const cellX = Math.floor(x * this.invCellSize);
    const cellZ = Math.floor(z * this.invCellSize);
    const nearby: number[] = [];

    // Check 3x3 grid around query point
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cellX + dx},${cellZ + dz}`;
        const cell = this.cells.get(key);
        if (cell) {
          nearby.push(...cell);
        }
      }
    }

    return nearby;
  }
}

export interface CollisionStats {
  totalChecks: number;
  actualCollisions: number;
}

/**
 * Resolve collisions between all runners
 */
export function resolveCollisions(
  components: Components,
  activeCount: number,
  delta: number,
  grid: SpatialHashGrid
): CollisionStats {
  const { position } = components;
  const stats: CollisionStats = { totalChecks: 0, actualCollisions: 0 };

  // Rebuild spatial hash grid
  grid.clear();
  for (let i = 0; i < activeCount; i++) {
    grid.insert(i, position.worldX[i], position.worldZ[i]);
  }

  // Find collision pairs
  const minDist = COLLISION_RADIUS * 2;
  const pushAmount = COLLISION_PUSH_STRENGTH * delta;
  const checked = new Set<string>();

  for (let i = 0; i < activeCount; i++) {
    const x = position.worldX[i];
    const z = position.worldZ[i];
    const nearby = grid.getNearby(x, z);

    for (const j of nearby) {
      if (i >= j) continue; // Avoid duplicates

      const pairKey = `${i},${j}`;
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);
      stats.totalChecks++;

      // Early out: check distance/lane first (cheaper than sqrt)
      const distanceDiff = Math.abs(position.distance[i] - position.distance[j]);
      const laneDiff = Math.abs(position.lanePosition[i] - position.lanePosition[j]);

      if (distanceDiff > 2.0 || laneDiff > 1.5) continue;

      // Check actual world distance
      const dx = position.worldX[j] - position.worldX[i];
      const dz = position.worldZ[j] - position.worldZ[i];
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        stats.actualCollisions++;
        const overlap = minDist - dist;

        // Push the runner who is behind outward
        const iAhead = position.distance[i] > position.distance[j];
        const behind = iAhead ? j : i;

        position.lanePosition[behind] = Math.min(
          position.lanePosition[behind] + overlap * pushAmount,
          MAX_LANE_POSITION + 1
        );
      }
    }
  }

  // Apply lane drift toward inside
  for (let i = 0; i < activeCount; i++) {
    if (position.lanePosition[i] > MIN_LANE_POSITION) {
      const driftMultiplier = position.lanePosition[i];
      const driftAmount = DRIFT_LEFT_SPEED * delta * driftMultiplier;
      position.lanePosition[i] = Math.max(
        position.lanePosition[i] - driftAmount,
        MIN_LANE_POSITION
      );
    }
  }

  return stats;
}
