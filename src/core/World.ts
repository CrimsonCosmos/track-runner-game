/**
 * World - Main ECS container and update orchestrator
 *
 * Manages all entities and systems. Provides the main update loop
 * that runs all systems in the correct order.
 */

import * as THREE from 'three';
import {
  createComponents,
  MAX_RUNNERS,
  FLAG_IS_PLAYER,
  setFlag,
  type Components
} from './components';
import { updateMovement, type MovementSystemConfig } from './systems/MovementSystem';
import { resolveCollisions, SpatialHashGrid, type CollisionStats } from './systems/CollisionSystem';
import { SharedAnimationSystem } from '../rendering/SharedAnimationSystem';

export interface TrackPath {
  getPosition: (distance: number, lane: number) => { x: number; y: number; z: number; rotation?: number };
}

export interface RaceData {
  name: string;
  splits: number[];
  finalTime: number;
}

export interface WorldStats {
  activeRunners: number;
  collisionChecks: number;
  actualCollisions: number;
  updateTimeMs: number;
}

/**
 * ECS World - contains all game state and runs systems
 */
export class World {
  public components: Components;
  public activeCount: number = 0;
  public maxRunners: number;

  private spatialGrid: SpatialHashGrid;
  private trackPath: TrackPath | null = null;
  private stats: WorldStats = {
    activeRunners: 0,
    collisionChecks: 0,
    actualCollisions: 0,
    updateTimeMs: 0
  };

  // Three.js rendering
  private instancedMesh: THREE.InstancedMesh | null = null;
  private animationSystem: SharedAnimationSystem;
  private tempMatrix = new THREE.Matrix4();
  private tempPosition = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();
  private tempScale = new THREE.Vector3(0.01, 0.01, 0.01);
  private tempEuler = new THREE.Euler();

  constructor(maxRunners: number = MAX_RUNNERS) {
    this.maxRunners = maxRunners;
    this.components = createComponents(maxRunners);
    this.spatialGrid = new SpatialHashGrid(5.0);
    this.animationSystem = new SharedAnimationSystem();
  }

  /**
   * Set the track path function
   */
  setTrackPath(trackPath: TrackPath): void {
    this.trackPath = trackPath;
  }

  /**
   * Create instanced mesh for rendering
   */
  createInstancedMesh(geometry: THREE.BufferGeometry, scene: THREE.Scene): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.1
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxRunners);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;

    // Enable per-instance colors
    const colors = new Float32Array(this.maxRunners * 3);
    const runnerColors = [
      0xcc2222, 0x22cc22, 0xcccc22, 0xcc22cc,
      0x22cccc, 0xff8800, 0x8822cc, 0x2288cc,
      0xcc8822, 0x22cc88, 0x8822ff, 0xff2288,
      0x88cc22, 0x2288ff, 0xcc2288, 0x88ff22
    ];

    const color = new THREE.Color();
    for (let i = 0; i < this.maxRunners; i++) {
      color.setHex(runnerColors[i % runnerColors.length]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Hide all instances initially
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxRunners; i++) {
      this.instancedMesh.setMatrixAt(i, zeroMatrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.instancedMesh);
    return this.instancedMesh;
  }

  /**
   * Add a runner entity with race data
   */
  addRunner(raceData: RaceData, startingLane: number, isPlayer: boolean = false): number {
    const id = this.activeCount++;
    if (id >= this.maxRunners) {
      console.warn('Max runners reached');
      this.activeCount--;
      return -1;
    }

    const { position, velocity, animation, raceData: rd, flags } = this.components;

    // Initialize position
    position.distance[id] = 0;
    position.lanePosition[id] = startingLane;
    position.worldX[id] = 0;
    position.worldY[id] = 0;
    position.worldZ[id] = 0;
    position.rotationY[id] = 0;

    // Initialize velocity
    velocity.currentSpeed[id] = 0;
    velocity.targetSpeed[id] = 0;

    // Initialize animation
    animation.phase[id] = Math.random();
    animation.strideMultiplier[id] = 0.85 + Math.random() * 0.3;

    // Copy split times
    const base = id * 5;
    for (let i = 0; i < 5; i++) {
      rd.splitTimes[base + i] = raceData.splits[i] || raceData.splits[raceData.splits.length - 1];
    }
    rd.finalTime[id] = raceData.finalTime;

    // Set flags
    flags.flags[id] = 0;
    if (isPlayer) {
      setFlag(flags.flags, id, FLAG_IS_PLAYER, true);
    }

    return id;
  }

  /**
   * Reset a runner for a new race
   */
  resetRunner(id: number, startDistance: number, startLane: number): void {
    const { position, velocity, animation, flags } = this.components;

    position.distance[id] = startDistance;
    position.lanePosition[id] = startLane;
    velocity.currentSpeed[id] = 0;
    animation.phase[id] = Math.random();
    flags.flags[id] = 0;
  }

  /**
   * Main update loop - runs all systems
   */
  update(delta: number, config: MovementSystemConfig): void {
    const startTime = performance.now();

    // Phase 1: Movement
    updateMovement(this.components, this.activeCount, delta, config);

    // Phase 2: Convert track position to world position
    this.updateWorldPositions();

    // Phase 3: Collision detection
    const collisionStats = resolveCollisions(
      this.components,
      this.activeCount,
      delta,
      this.spatialGrid
    );

    // Phase 4: Update instance matrices for GPU
    this.updateInstanceMatrices();

    // Update stats
    this.stats.activeRunners = this.activeCount;
    this.stats.collisionChecks = collisionStats.totalChecks;
    this.stats.actualCollisions = collisionStats.actualCollisions;
    this.stats.updateTimeMs = performance.now() - startTime;
  }

  /**
   * Convert track-relative positions to world coordinates
   */
  private updateWorldPositions(): void {
    if (!this.trackPath) return;

    const { position } = this.components;

    for (let i = 0; i < this.activeCount; i++) {
      const pos = this.trackPath.getPosition(position.distance[i], position.lanePosition[i]);
      position.worldX[i] = pos.x;
      position.worldY[i] = pos.y || 0;
      position.worldZ[i] = pos.z;

      // Calculate rotation to face forward
      const aheadPos = this.trackPath.getPosition(position.distance[i] + 2, position.lanePosition[i]);
      position.rotationY[i] = Math.atan2(
        aheadPos.x - pos.x,
        aheadPos.z - pos.z
      );
    }
  }

  /**
   * Update GPU instance matrices with animation
   */
  private updateInstanceMatrices(): void {
    if (!this.instancedMesh) return;

    // Use SharedAnimationSystem for procedural animation
    this.animationSystem.updateInstanceMatrices(
      this.instancedMesh,
      this.components,
      this.activeCount,
      0.01 // base scale
    );
  }

  /**
   * Get current stats
   */
  getStats(): WorldStats {
    return { ...this.stats };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
    }
  }
}
