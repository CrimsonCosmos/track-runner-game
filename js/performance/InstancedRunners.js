/**
 * InstancedRunners - Efficient rendering of 100+ runners
 *
 * Uses Three.js InstancedMesh to render all runners in a single draw call.
 * State is stored in TypedArrays for cache-friendly access and easy
 * transfer to GPU via instance matrices.
 *
 * Performance targets:
 * - 100 runners at 60 FPS
 * - <500 collision checks per frame (via SpatialHashGrid)
 * - Single draw call for all runners
 */

import * as THREE from 'three';
import { SpatialHashGrid } from './SpatialHashGrid.js';

// Constants
const MAX_RUNNERS = 128; // Power of 2 for alignment
const COLLISION_RADIUS = 0.4;
const COLLISION_PUSH_STRENGTH = 3.0;
const DRIFT_LEFT_SPEED = 0.15;
const MIN_LANE_POSITION = 0.75;
const MAX_LANE_POSITION = 2.0;

// Runner colors (expanded for 100 runners)
const RUNNER_COLORS = [
    0xcc2222, 0x22cc22, 0xcccc22, 0xcc22cc,
    0x22cccc, 0xff8800, 0x8822cc, 0x2288cc,
    0xcc8822, 0x22cc88, 0x8822ff, 0xff2288,
    0x88cc22, 0x2288ff, 0xcc2288, 0x88ff22
];

/**
 * ECS-style component arrays for runner state
 * All arrays are aligned for cache-friendly iteration
 */
export class RunnerState {
    constructor(maxRunners = MAX_RUNNERS) {
        this.maxRunners = maxRunners;
        this.activeCount = 0;

        // Position & Movement
        this.distance = new Float32Array(maxRunners);       // Track distance (meters)
        this.lanePosition = new Float32Array(maxRunners);   // Lane offset
        this.positionX = new Float32Array(maxRunners);      // World X
        this.positionY = new Float32Array(maxRunners);      // World Y (ground height)
        this.positionZ = new Float32Array(maxRunners);      // World Z

        // Speed & Animation
        this.currentSpeed = new Float32Array(maxRunners);   // Current speed (m/s)
        this.targetSpeed = new Float32Array(maxRunners);    // Target speed
        this.animationPhase = new Float32Array(maxRunners); // Animation cycle phase
        this.strideMultiplier = new Float32Array(maxRunners);

        // Race data
        this.splitTimes = new Float32Array(maxRunners * 5); // 5 splits per runner
        this.finalTime = new Float32Array(maxRunners);

        // Flags (packed as Uint8 for memory efficiency)
        this.flags = new Uint8Array(maxRunners);            // Bit flags: finished, squished, etc.

        // Rotation (stored as quaternion for GPU)
        this.rotationY = new Float32Array(maxRunners);      // Y rotation in radians
    }

    /**
     * Add a runner with race data
     */
    addRunner(raceData, lane) {
        const id = this.activeCount++;
        if (id >= this.maxRunners) {
            console.warn('Max runners reached');
            return -1;
        }

        this.distance[id] = 0;
        this.lanePosition[id] = lane;
        this.currentSpeed[id] = 0;
        this.targetSpeed[id] = 0;
        this.animationPhase[id] = Math.random(); // Random start phase
        this.strideMultiplier[id] = 0.85 + Math.random() * 0.3;
        this.flags[id] = 0;
        this.rotationY[id] = 0;

        // Copy split times
        const splits = raceData.splits;
        const base = id * 5;
        for (let i = 0; i < 5; i++) {
            this.splitTimes[base + i] = splits[i] || splits[splits.length - 1];
        }
        this.finalTime[id] = raceData.finalTime;

        return id;
    }

    /**
     * Reset a runner for new race
     */
    resetRunner(id, startDistance, startLane) {
        this.distance[id] = startDistance;
        this.lanePosition[id] = startLane;
        this.currentSpeed[id] = 0;
        this.flags[id] = 0;
        this.animationPhase[id] = Math.random();
    }

    /**
     * Check if runner has finished
     */
    isFinished(id) {
        return (this.flags[id] & 0x01) !== 0;
    }

    setFinished(id, finished) {
        if (finished) {
            this.flags[id] |= 0x01;
        } else {
            this.flags[id] &= ~0x01;
        }
    }

    /**
     * Get target speed based on distance and split times
     */
    getTargetSpeed(id, timeScaleFactor) {
        const distance = this.distance[id];
        const segmentIndex = Math.min(Math.floor(distance / 1000), 4);
        const base = id * 5;

        const timeAtStart = segmentIndex === 0 ? 0 : this.splitTimes[base + segmentIndex - 1];
        const timeAtEnd = this.splitTimes[base + segmentIndex];
        const segmentTime = timeAtEnd - timeAtStart;

        return (1000 / segmentTime) / timeScaleFactor;
    }
}

/**
 * InstancedMesh renderer for all runners
 */
export class InstancedRunners {
    constructor(scene, geometry, maxRunners = MAX_RUNNERS) {
        this.scene = scene;
        this.state = new RunnerState(maxRunners);
        this.spatialGrid = new SpatialHashGrid(5.0);
        this.maxRunners = maxRunners;

        // Track path function (will be set externally)
        this.getPosition = null;

        // Create instanced mesh with colored materials
        this.createInstancedMesh(geometry);

        // Temp objects for matrix calculations
        this._tempMatrix = new THREE.Matrix4();
        this._tempPosition = new THREE.Vector3();
        this._tempQuaternion = new THREE.Quaternion();
        this._tempScale = new THREE.Vector3(0.01, 0.01, 0.01); // Runner scale
        this._tempEuler = new THREE.Euler();

        // Performance stats
        this.stats = {
            collisionChecks: 0,
            updateTime: 0
        };
    }

    /**
     * Create InstancedMesh with per-instance colors
     */
    createInstancedMesh(geometry) {
        // Use a basic geometry if none provided (for testing)
        if (!geometry) {
            geometry = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        }

        // Create material that supports instance colors
        const material = new THREE.MeshStandardMaterial({
            roughness: 0.7,
            metalness: 0.1,
            vertexColors: false
        });

        this.mesh = new THREE.InstancedMesh(geometry, material, this.maxRunners);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        // Enable per-instance colors
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.maxRunners * 3),
            3
        );
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

        // Set initial colors
        const color = new THREE.Color();
        for (let i = 0; i < this.maxRunners; i++) {
            color.setHex(RUNNER_COLORS[i % RUNNER_COLORS.length]);
            this.mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);
        }
        this.mesh.instanceColor.needsUpdate = true;

        // Hide all instances initially
        for (let i = 0; i < this.maxRunners; i++) {
            this._tempMatrix.makeScale(0, 0, 0);
            this.mesh.setMatrixAt(i, this._tempMatrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;

        this.scene.add(this.mesh);
    }

    /**
     * Set the track path function
     * @param {Function} getPositionFn - Function(distance, lane) => {x, y, z}
     */
    setTrackPath(getPositionFn) {
        this.getPosition = getPositionFn;
    }

    /**
     * Add runners from race data
     */
    addRunnersFromRaceData(raceDataArray, startingFormation) {
        for (let i = 0; i < raceDataArray.length; i++) {
            const raceData = raceDataArray[i];
            const formation = startingFormation[i] || { row: i, laneOffset: 0.5 };
            const lane = MIN_LANE_POSITION + formation.laneOffset;
            this.state.addRunner(raceData, lane);
        }
    }

    /**
     * Update all runners for one frame
     * @param {number} delta - Time since last frame
     * @param {number} timeScaleFactor - Speed multiplier
     * @param {number} raceDistance - Total race distance
     */
    update(delta, timeScaleFactor, raceDistance = 5000) {
        const startTime = performance.now();
        const count = this.state.activeCount;

        // Phase 1: Update speeds and movement
        this.updateMovement(delta, timeScaleFactor, raceDistance, count);

        // Phase 2: Update world positions from track path
        this.updateWorldPositions(count);

        // Phase 3: Resolve collisions using spatial hash
        this.resolveCollisions(delta, count);

        // Phase 4: Update instance matrices for rendering
        this.updateInstanceMatrices(count);

        this.stats.updateTime = performance.now() - startTime;
    }

    /**
     * Phase 1: Update speeds and distances
     */
    updateMovement(delta, timeScaleFactor, raceDistance, count) {
        const state = this.state;
        const accelerationRate = 2.0;

        for (let i = 0; i < count; i++) {
            // Check finish
            if (!state.isFinished(i) && state.distance[i] >= raceDistance) {
                state.setFinished(i, true);
            }

            // Calculate target speed
            if (state.isFinished(i)) {
                state.targetSpeed[i] = (5000 / 791.3 / 2) / timeScaleFactor; // Cooldown
            } else {
                state.targetSpeed[i] = state.getTargetSpeed(i, timeScaleFactor);
            }

            // Smooth acceleration
            const current = state.currentSpeed[i];
            const target = state.targetSpeed[i];
            if (current < target) {
                state.currentSpeed[i] = Math.min(current + accelerationRate * delta, target);
            } else if (current > target) {
                state.currentSpeed[i] = Math.max(current - accelerationRate * delta, target);
            }

            // Move forward
            state.distance[i] += state.currentSpeed[i] * delta;

            // Update animation phase
            const BASE_ANIMATION_SPEED = 5000 / 600;
            const animScale = state.currentSpeed[i] / BASE_ANIMATION_SPEED;
            state.animationPhase[i] += delta * Math.max(0.3, animScale) * state.strideMultiplier[i];
        }
    }

    /**
     * Phase 2: Convert track distance/lane to world positions
     */
    updateWorldPositions(count) {
        const state = this.state;

        if (!this.getPosition) return;

        for (let i = 0; i < count; i++) {
            const pos = this.getPosition(state.distance[i], state.lanePosition[i]);
            state.positionX[i] = pos.x;
            state.positionY[i] = pos.y || 0;
            state.positionZ[i] = pos.z;

            // Calculate rotation to face forward
            const aheadPos = this.getPosition(state.distance[i] + 2, state.lanePosition[i]);
            state.rotationY[i] = Math.atan2(
                aheadPos.x - pos.x,
                aheadPos.z - pos.z
            );
        }
    }

    /**
     * Phase 3: Collision detection and resolution
     */
    resolveCollisions(delta, count) {
        const state = this.state;
        const grid = this.spatialGrid;

        // Get collision pairs from spatial hash
        const pairs = grid.getCollisionPairs(
            state.positionX,
            state.positionZ,
            count
        );

        this.stats.collisionChecks = pairs.length;

        const minDist = COLLISION_RADIUS * 2;
        const pushAmount = COLLISION_PUSH_STRENGTH * delta;

        for (const [i, j] of pairs) {
            // Early out: check distance/lane first (cheaper than sqrt)
            const distanceDiff = Math.abs(state.distance[i] - state.distance[j]);
            const laneDiff = Math.abs(state.lanePosition[i] - state.lanePosition[j]);

            if (distanceDiff > 2.0 || laneDiff > 1.5) continue;

            // Check actual world distance
            const dx = state.positionX[j] - state.positionX[i];
            const dz = state.positionZ[j] - state.positionZ[i];
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < minDist && dist > 0.01) {
                const overlap = minDist - dist;

                // Push the runner who is behind outward
                const iAhead = state.distance[i] > state.distance[j];
                const behind = iAhead ? j : i;

                state.lanePosition[behind] = Math.min(
                    state.lanePosition[behind] + overlap * pushAmount,
                    MAX_LANE_POSITION + 1
                );
            }
        }

        // Apply lane drift toward inside
        for (let i = 0; i < count; i++) {
            if (state.lanePosition[i] > MIN_LANE_POSITION) {
                const driftMultiplier = state.lanePosition[i];
                const driftAmount = DRIFT_LEFT_SPEED * delta * driftMultiplier;
                state.lanePosition[i] = Math.max(
                    state.lanePosition[i] - driftAmount,
                    MIN_LANE_POSITION
                );
            }
        }
    }

    /**
     * Phase 4: Update GPU instance matrices
     */
    updateInstanceMatrices(count) {
        const state = this.state;

        for (let i = 0; i < count; i++) {
            this._tempPosition.set(
                state.positionX[i],
                state.positionY[i],
                state.positionZ[i]
            );

            this._tempEuler.set(0, state.rotationY[i], 0);
            this._tempQuaternion.setFromEuler(this._tempEuler);

            this._tempMatrix.compose(
                this._tempPosition,
                this._tempQuaternion,
                this._tempScale
            );

            this.mesh.setMatrixAt(i, this._tempMatrix);
        }

        // Hide inactive instances
        this._tempMatrix.makeScale(0, 0, 0);
        for (let i = count; i < this.maxRunners; i++) {
            this.mesh.setMatrixAt(i, this._tempMatrix);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return {
            activeRunners: this.state.activeCount,
            collisionChecks: this.stats.collisionChecks,
            updateTimeMs: this.stats.updateTime.toFixed(2),
            spatialGrid: this.spatialGrid.getStats()
        };
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}

/**
 * Generate 100 AI runners with varied but realistic race data
 */
export function generate100Runners() {
    const baseRunners = [
        { name: "Elite 1", splits: [157, 315, 472, 650, 791.3], finalTime: 791.3 },
        { name: "Elite 2", splits: [156, 313, 471, 650, 791.44], finalTime: 791.44 },
        { name: "Elite 3", splits: [156, 314, 472, 650, 792.28], finalTime: 792.28 },
    ];

    const runners = [];

    // Generate 100 runners with varying finish times (13:00 to 16:00)
    for (let i = 0; i < 100; i++) {
        // Spread finish times from 13:00 (780s) to 16:00 (960s)
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

    return runners;
}

/**
 * Generate starting formation for N runners
 */
export function generateFormation(count) {
    const formation = [];
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
