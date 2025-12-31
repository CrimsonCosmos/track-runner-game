/**
 * RustWorldAdapter - Syncs Rust game server with frontend rendering
 *
 * The Rust backend handles simulation (100 runners, physics, race logic).
 * This adapter receives snapshots from Rust and updates the Three.js
 * rendering via the ECS World.
 */

import * as THREE from 'three';
import type { Components } from '../core/components';
import type { RaceSnapshot, RunnerSnapshot } from './GameServerBridge';
import { GameServerBridge, getGameServerBridge } from './GameServerBridge';

export interface AdapterConfig {
  baseScale: number;
  tickRate: number; // Target ticks per second from Rust
}

const DEFAULT_CONFIG: AdapterConfig = {
  baseScale: 0.01,
  tickRate: 60,
};

/**
 * RustWorldAdapter - Syncs Rust simulation to Three.js rendering
 */
export class RustWorldAdapter {
  private bridge: GameServerBridge;
  private config: AdapterConfig;
  private lastSnapshot: RaceSnapshot | null = null;
  private tickInterval: number | null = null;
  private onUpdate: ((snapshot: RaceSnapshot) => void) | null = null;

  // For interpolation between snapshots
  private prevSnapshot: RaceSnapshot | null = null;
  private snapshotTime: number = 0;
  private interpolationFactor: number = 0;

  constructor(config: Partial<AdapterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bridge = getGameServerBridge();
  }

  /**
   * Initialize the adapter
   */
  async init(): Promise<boolean> {
    return await this.bridge.init();
  }

  /**
   * Check if adapter is available (running in Tauri)
   */
  isAvailable(): boolean {
    return this.bridge.isAvailable();
  }

  /**
   * Start a new race with given runner count
   */
  async initRace(runnerCount: number = 100, timeScale: number = 10): Promise<void> {
    await this.bridge.initRace(runnerCount, timeScale);
    this.lastSnapshot = await this.bridge.getSnapshot();
  }

  /**
   * Start the race
   */
  async startRace(): Promise<void> {
    await this.bridge.startRace();
  }

  /**
   * Start the tick loop
   */
  startTickLoop(onUpdate?: (snapshot: RaceSnapshot) => void): void {
    this.onUpdate = onUpdate || null;
    const tickMs = 1000 / this.config.tickRate;

    this.tickInterval = window.setInterval(async () => {
      try {
        this.prevSnapshot = this.lastSnapshot;
        this.lastSnapshot = await this.bridge.tick();
        this.snapshotTime = performance.now();

        if (this.lastSnapshot && this.onUpdate) {
          this.onUpdate(this.lastSnapshot);
        }
      } catch (e) {
        console.error('Tick error:', e);
      }
    }, tickMs);
  }

  /**
   * Stop the tick loop
   */
  stopTickLoop(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Get current snapshot
   */
  getSnapshot(): RaceSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Sync snapshot data to ECS components (for Three.js rendering)
   *
   * Call this in your render loop to update component data from Rust.
   */
  syncToComponents(
    components: Components,
    trackPath: { getPosition: (distance: number, lane: number) => { x: number; y: number; z: number } }
  ): number {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return 0;

    const { position, velocity, animation, flags } = components;
    const runners = snapshot.runners;

    for (let i = 0; i < runners.length; i++) {
      const runner = runners[i];

      // Update position (distance along track)
      position.distance[i] = runner.distance;
      position.lanePosition[i] = runner.lane_position;

      // Convert to world position using track path
      const worldPos = trackPath.getPosition(runner.distance, runner.lane_position);
      position.worldX[i] = worldPos.x;
      position.worldY[i] = worldPos.y || 0;
      position.worldZ[i] = worldPos.z;

      // Calculate rotation (facing forward along track)
      const aheadPos = trackPath.getPosition(runner.distance + 2, runner.lane_position);
      position.rotationY[i] = Math.atan2(
        aheadPos.x - worldPos.x,
        aheadPos.z - worldPos.z
      );

      // Update velocity
      velocity.currentSpeed[i] = runner.speed;

      // Update animation phase
      animation.phase[i] = runner.animation_phase;

      // Update flags
      flags.flags[i] = runner.finished ? 0x01 : 0;
    }

    return runners.length;
  }

  /**
   * Sync snapshot data directly to InstancedMesh (bypassing ECS)
   *
   * More efficient for pure Rust-driven rendering.
   */
  syncToInstancedMesh(
    mesh: THREE.InstancedMesh,
    trackPath: { getPosition: (distance: number, lane: number) => { x: number; y: number; z: number } }
  ): void {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return;

    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const tempEuler = new THREE.Euler();

    const runners = snapshot.runners;
    const baseScale = this.config.baseScale;

    // Animation constants
    const BOB_AMPLITUDE = 0.08;
    const LEAN_AMPLITUDE = 0.05;
    const SWAY_AMPLITUDE = 0.1;

    for (let i = 0; i < runners.length; i++) {
      const runner = runners[i];

      // Get world position from track
      const worldPos = trackPath.getPosition(runner.distance, runner.lane_position);

      // Calculate rotation
      const aheadPos = trackPath.getPosition(runner.distance + 2, runner.lane_position);
      const rotationY = Math.atan2(
        aheadPos.x - worldPos.x,
        aheadPos.z - worldPos.z
      );

      // Animation calculations
      const phase = runner.animation_phase % 1;
      const phaseRadians = phase * Math.PI * 2;
      const intensity = Math.min(runner.speed / 8, 1);

      const bob = Math.abs(Math.sin(phaseRadians * 2)) * BOB_AMPLITUDE * intensity;
      const lean = Math.sin(phaseRadians) * LEAN_AMPLITUDE * intensity;
      const sway = Math.sin(phaseRadians) * SWAY_AMPLITUDE * intensity;

      // Build transform
      tempPosition.set(
        worldPos.x + sway,
        (worldPos.y || 0) + bob,
        worldPos.z
      );

      tempEuler.set(lean, rotationY, 0);
      tempQuaternion.setFromEuler(tempEuler);
      tempScale.setScalar(baseScale);

      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }

    // Hide unused instances
    tempMatrix.makeScale(0, 0, 0);
    for (let i = runners.length; i < mesh.count; i++) {
      mesh.setMatrixAt(i, tempMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Pause the race
   */
  async pause(): Promise<void> {
    await this.bridge.pauseRace();
  }

  /**
   * Resume the race
   */
  async resume(): Promise<void> {
    await this.bridge.resumeRace();
  }

  /**
   * Reset the race
   */
  async reset(): Promise<void> {
    this.stopTickLoop();
    await this.bridge.resetRace();
    this.lastSnapshot = null;
    this.prevSnapshot = null;
  }

  /**
   * Get race results
   */
  async getResults() {
    return await this.bridge.getResults();
  }

  /**
   * Get server stats
   */
  async getStats() {
    return await this.bridge.getStats();
  }
}

// Singleton instance
let adapterInstance: RustWorldAdapter | null = null;

/**
 * Get the Rust world adapter instance
 */
export function getRustWorldAdapter(): RustWorldAdapter {
  if (!adapterInstance) {
    adapterInstance = new RustWorldAdapter();
  }
  return adapterInstance;
}
