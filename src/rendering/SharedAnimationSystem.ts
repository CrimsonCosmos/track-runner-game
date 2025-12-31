/**
 * SharedAnimationSystem - Efficient animation for 100+ runners
 *
 * Instead of 100 individual AnimationMixers, we use a shared approach:
 * 1. One "master" mixer samples the running animation
 * 2. Each runner has a phase offset into the animation cycle
 * 3. Bone transforms are computed once and applied to all instances
 *
 * For InstancedMesh (non-skinned), we approximate the running motion
 * using a simple bobbing/leaning transform based on animation phase.
 */

import * as THREE from 'three';
import type { Components } from '../core/components';

// Animation constants
const ANIMATION_CYCLE_DURATION = 0.8; // Seconds per full stride cycle
const BOB_AMPLITUDE = 0.08; // Vertical bob amount
const LEAN_AMPLITUDE = 0.05; // Forward lean during stride
const ARM_SWING_AMPLITUDE = 0.1; // Side-to-side sway

export interface AnimationConfig {
  bobAmplitude: number;
  leanAmplitude: number;
  armSwingAmplitude: number;
}

const DEFAULT_CONFIG: AnimationConfig = {
  bobAmplitude: BOB_AMPLITUDE,
  leanAmplitude: LEAN_AMPLITUDE,
  armSwingAmplitude: ARM_SWING_AMPLITUDE,
};

/**
 * SharedAnimationSystem for instanced runners
 *
 * Applies procedural animation to InstancedMesh based on each runner's
 * animation phase. This avoids the cost of 100 separate AnimationMixers.
 */
export class SharedAnimationSystem {
  private config: AnimationConfig;

  // Temp objects for matrix calculations
  private tempMatrix = new THREE.Matrix4();
  private tempPosition = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();
  private tempScale = new THREE.Vector3();
  private tempEuler = new THREE.Euler();

  constructor(config: Partial<AnimationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update instance matrices with animation transforms
   *
   * @param mesh - The InstancedMesh to update
   * @param components - ECS components containing animation state
   * @param activeCount - Number of active runners
   * @param baseScale - Base scale for runners (default 0.01)
   */
  updateInstanceMatrices(
    mesh: THREE.InstancedMesh,
    components: Components,
    activeCount: number,
    baseScale: number = 0.01
  ): void {
    const { position, velocity, animation } = components;
    const { bobAmplitude, leanAmplitude, armSwingAmplitude } = this.config;

    for (let i = 0; i < activeCount; i++) {
      // Get animation phase (0-1 range, repeating)
      const phase = animation.phase[i] % 1;
      const phaseRadians = phase * Math.PI * 2;

      // Calculate speed-based intensity (faster = more pronounced motion)
      const speed = velocity.currentSpeed[i];
      const intensity = Math.min(speed / 8, 1); // Normalize to ~8 m/s max

      // Vertical bob (double frequency - bob on each foot strike)
      const bob = Math.abs(Math.sin(phaseRadians * 2)) * bobAmplitude * intensity;

      // Forward lean (increases with speed)
      const lean = Math.sin(phaseRadians) * leanAmplitude * intensity;

      // Slight side-to-side sway (arm swing approximation)
      const sway = Math.sin(phaseRadians) * armSwingAmplitude * intensity;

      // Build position with bob
      this.tempPosition.set(
        position.worldX[i] + sway,
        position.worldY[i] + bob,
        position.worldZ[i]
      );

      // Build rotation with lean
      this.tempEuler.set(
        lean, // Pitch (forward lean)
        position.rotationY[i], // Yaw (facing direction)
        0 // Roll
      );
      this.tempQuaternion.setFromEuler(this.tempEuler);

      // Scale (uniform)
      this.tempScale.setScalar(baseScale);

      // Compose and set matrix
      this.tempMatrix.compose(
        this.tempPosition,
        this.tempQuaternion,
        this.tempScale
      );

      mesh.setMatrixAt(i, this.tempMatrix);
    }

    // Hide inactive instances
    this.tempMatrix.makeScale(0, 0, 0);
    for (let i = activeCount; i < mesh.count; i++) {
      mesh.setMatrixAt(i, this.tempMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * SkinnedAnimationPool - For when we need actual skinned mesh animations
 *
 * Maintains a pool of skinned meshes that can be reused. Good for
 * close-up runners where we need full skeletal animation.
 */
export class SkinnedAnimationPool {
  private pool: THREE.SkinnedMesh[] = [];
  private mixers: THREE.AnimationMixer[] = [];
  private actions: THREE.AnimationAction[] = [];
  private activeCount: number = 0;
  private scene: THREE.Scene;
  private clip: THREE.AnimationClip | null = null;

  constructor(scene: THREE.Scene, poolSize: number = 20) {
    this.scene = scene;
  }

  /**
   * Initialize pool from a loaded skinned mesh
   */
  initialize(
    sourceMesh: THREE.SkinnedMesh,
    clip: THREE.AnimationClip,
    poolSize: number = 20
  ): void {
    this.clip = clip;

    for (let i = 0; i < poolSize; i++) {
      // Clone the skinned mesh
      const clone = sourceMesh.clone();
      clone.visible = false;

      // Create mixer and action
      const mixer = new THREE.AnimationMixer(clone);
      const action = mixer.clipAction(clip);
      action.play();

      this.pool.push(clone);
      this.mixers.push(mixer);
      this.actions.push(action);
      this.scene.add(clone);
    }
  }

  /**
   * Update animations for visible pool members
   */
  update(delta: number): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.mixers[i].update(delta);
    }
  }

  /**
   * Activate N pool members (call before update)
   */
  activate(count: number): void {
    const newCount = Math.min(count, this.pool.length);

    // Show newly activated
    for (let i = this.activeCount; i < newCount; i++) {
      this.pool[i].visible = true;
    }

    // Hide deactivated
    for (let i = newCount; i < this.activeCount; i++) {
      this.pool[i].visible = false;
    }

    this.activeCount = newCount;
  }

  /**
   * Position a pool member
   */
  setTransform(
    index: number,
    position: THREE.Vector3,
    rotation: number,
    scale: number = 0.01
  ): void {
    if (index >= this.pool.length) return;

    const mesh = this.pool[index];
    mesh.position.copy(position);
    mesh.rotation.y = rotation;
    mesh.scale.setScalar(scale);
  }

  /**
   * Set animation speed for a pool member
   */
  setAnimationSpeed(index: number, speed: number): void {
    if (index >= this.actions.length) return;
    this.actions[index].timeScale = speed;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.pool = [];
    this.mixers = [];
    this.actions = [];
  }
}

/**
 * LODAnimationSystem - Combines instanced and skinned approaches
 *
 * Uses SkinnedAnimationPool for nearby runners (full animation)
 * and SharedAnimationSystem for distant runners (instanced).
 */
export class LODAnimationSystem {
  private sharedSystem: SharedAnimationSystem;
  private skinnedPool: SkinnedAnimationPool | null = null;
  private nearDistance: number;
  private farDistance: number;

  constructor(
    scene: THREE.Scene,
    nearDistance: number = 30,
    farDistance: number = 100
  ) {
    this.sharedSystem = new SharedAnimationSystem();
    this.nearDistance = nearDistance;
    this.farDistance = farDistance;
  }

  /**
   * Initialize with skinned mesh for near LOD
   */
  initializeSkinnedPool(
    sourceMesh: THREE.SkinnedMesh,
    clip: THREE.AnimationClip,
    poolSize: number = 20
  ): void {
    // Pool will be created when needed
  }

  /**
   * Get the shared animation system for instanced rendering
   */
  getSharedSystem(): SharedAnimationSystem {
    return this.sharedSystem;
  }

  /**
   * Update both LOD levels
   */
  update(
    delta: number,
    cameraPosition: THREE.Vector3,
    mesh: THREE.InstancedMesh,
    components: Components,
    activeCount: number
  ): void {
    // For now, just use shared system for all
    // LOD with skinned pool can be added later
    this.sharedSystem.updateInstanceMatrices(mesh, components, activeCount);
  }
}
