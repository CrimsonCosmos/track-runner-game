/**
 * GameBridge - Connects ECS World to existing game code
 *
 * This bridge allows gradual migration from the current object-oriented
 * Runner class to the new ECS-based system. It provides a familiar
 * API while using the performant ECS internals.
 */

import * as THREE from 'three';
import { World, type RaceData, type TrackPath } from '../core/World';

// Re-export for convenience
export { World, type RaceData, type TrackPath };

/**
 * Generate race data for 100 AI runners with varied abilities
 */
export function generate100Runners(): RaceData[] {
  const runners: RaceData[] = [];

  // Generate runners with finish times from 13:00 (780s) to 16:00 (960s)
  for (let i = 0; i < 100; i++) {
    // Spread finish times across the range with some randomness
    const finishTime = 780 + (i * 1.8) + (Math.random() * 10 - 5);

    // Calculate splits based on even pacing with slight variation
    const kmTime = finishTime / 5;
    const splits = [
      kmTime * (0.98 + Math.random() * 0.04),
      kmTime * 2 * (0.98 + Math.random() * 0.04),
      kmTime * 3 * (0.98 + Math.random() * 0.04),
      kmTime * 4 * (0.98 + Math.random() * 0.04),
      finishTime
    ];

    runners.push({
      name: `Runner ${i + 1}`,
      splits,
      finalTime: finishTime
    });
  }

  // Shuffle for random starting positions
  for (let i = runners.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [runners[i], runners[j]] = [runners[j], runners[i]];
  }

  return runners;
}

/**
 * Generate starting formation for N runners
 * Returns array of { row, laneOffset } for each runner
 */
export function generateFormation(count: number): Array<{ row: number; laneOffset: number }> {
  const formation: Array<{ row: number; laneOffset: number }> = [];
  const runnersPerRow = 5;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / runnersPerRow);
    const col = i % runnersPerRow;
    formation.push({
      row,
      laneOffset: 0.2 + col * 0.35
    });
  }

  return formation;
}

/**
 * Create a simple capsule geometry for runners
 */
export function createRunnerGeometry(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
}

/**
 * Scale time for race (original 13:11 race -> user's goal time)
 */
export function calculateTimeScale(goalTimeSeconds: number): number {
  const ORIGINAL_WINNER_TIME = 791.3; // Ingebrigtsen's 5K time
  const winnerTargetTime = goalTimeSeconds - 10; // Winner finishes 10s before goal
  return winnerTargetTime / ORIGINAL_WINNER_TIME;
}

/**
 * GameController - High-level game management using ECS World
 */
export class GameController {
  public world: World;
  private scene: THREE.Scene;
  private runnerGeometry: THREE.BufferGeometry | null = null;

  constructor(scene: THREE.Scene, maxRunners: number = 128) {
    this.scene = scene;
    this.world = new World(maxRunners);
  }

  /**
   * Initialize the game with track path
   */
  initialize(trackPath: TrackPath): void {
    this.world.setTrackPath(trackPath);
  }

  /**
   * Create renderer with simple geometry
   */
  createRenderer(): THREE.InstancedMesh {
    this.runnerGeometry = createRunnerGeometry();
    return this.world.createInstancedMesh(this.runnerGeometry, this.scene);
  }

  /**
   * Set up a race with N runners
   */
  setupRace(runnerCount: number = 100): void {
    const raceData = generate100Runners().slice(0, runnerCount);
    const formation = generateFormation(runnerCount);

    for (let i = 0; i < runnerCount; i++) {
      const form = formation[i];
      const startLane = 0.75 + form.laneOffset;
      this.world.addRunner(raceData[i], startLane, false);
    }

    // Reset to starting positions
    for (let i = 0; i < runnerCount; i++) {
      const form = formation[i];
      const startDist = -form.row * 1.5 - 8;
      this.world.resetRunner(i, startDist, 0.75 + form.laneOffset);
    }
  }

  /**
   * Update game state for one frame
   */
  update(delta: number, timeScaleFactor: number = 1.0, raceDistance: number = 5000): void {
    this.world.update(delta, {
      timeScaleFactor,
      raceDistance
    });
  }

  /**
   * Get current game stats
   */
  getStats() {
    return this.world.getStats();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.world.dispose();
    this.runnerGeometry?.dispose();
  }
}

/**
 * Example usage (can be added to main.js):
 *
 * ```javascript
 * import { GameController } from './src/game/GameBridge.ts';
 * import { getPosition } from './js/Track.js';
 *
 * // Create controller
 * const gameController = new GameController(scene, 128);
 *
 * // Initialize with track path
 * gameController.initialize({ getPosition });
 *
 * // Create renderer
 * gameController.createRenderer();
 *
 * // Set up race with 100 runners
 * gameController.setupRace(100);
 *
 * // In animation loop:
 * function animate() {
 *   const delta = clock.getDelta();
 *   gameController.update(delta * timeScaleFactor, 1.0, 5000);
 *
 *   const stats = gameController.getStats();
 *   console.log(`Runners: ${stats.activeRunners}, Checks: ${stats.collisionChecks}`);
 * }
 * ```
 */
