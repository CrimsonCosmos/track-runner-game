import * as THREE from 'three';
import { getPosition } from './Track.js';

// Lane positioning constants
export const DRIFT_LEFT_SPEED = 0.15;
export const PUSH_RIGHT_SPEED = 0.225;
export const MIN_LANE_POSITION = 0.75;
export const MAX_LANE_POSITION = 2.0;
export const COLLISION_RADIUS = 0.4;
export const COLLISION_PUSH_STRENGTH = 3.0;

// Runner colors for lanes 2-8
export const RUNNER_COLORS = [
    0xcc2222, // Red
    0x22cc22, // Green
    0xcccc22, // Yellow
    0xcc22cc, // Magenta
    0x22cccc, // Cyan
    0xff8800, // Orange
    0x8822cc  // Purple
];

// 1600m Race Data - Based on 2023-2024 Elite Mile Races
// Splits are in seconds at 400m, 800m, 1200m, 1600m
export const RACE_DATA_1600 = [
    // Jakob Ingebrigtsen - 3:43.73 (Prefontaine 2023)
    { name: "Ingebrigtsen", splits: [55.2, 111.8, 168.9, 223.73], finalTime: 223.73 },
    // Yared Nuguse - 3:43.97 (American Record, Prefontaine 2023)
    { name: "Nuguse", splits: [55.3, 112.0, 169.2, 223.97], finalTime: 223.97 },
    // Josh Kerr - 3:45.34 (2023)
    { name: "Kerr", splits: [55.5, 112.4, 169.8, 225.34], finalTime: 225.34 },
    // Cole Hocker - 3:47.40 (2024 Olympic 1500m champion, extrapolated)
    { name: "Hocker", splits: [56.0, 113.2, 170.8, 227.40], finalTime: 227.40 },
    // Timothy Cheruiyot - 3:48.12 (2023)
    { name: "Cheruiyot", splits: [56.2, 113.6, 171.4, 228.12], finalTime: 228.12 },
    // George Mills - 3:49.20 (2024)
    { name: "Mills", splits: [56.4, 114.0, 172.2, 229.20], finalTime: 229.20 },
    // Neil Gourley - 3:49.68 (2024)
    { name: "Gourley", splits: [56.5, 114.2, 172.6, 229.68], finalTime: 229.68 }
];

// Legacy RACE_DATA for backward compatibility (points to 1600m data)
export const RACE_DATA = RACE_DATA_1600;

// Shuffle array utility
export function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Calculate target speed at a given distance based on splits
// Works with 400m segment splits for 1600m race
export function getTargetSpeed(raceDataEntry, distance, timeScaleFactor) {
    const splits = raceDataEntry.splits;
    // 400m segments: 0-400, 400-800, 800-1200, 1200-1600
    const segmentIndex = Math.min(Math.floor(distance / 400), 3);
    const timeAtStart = segmentIndex === 0 ? 0 : splits[segmentIndex - 1];
    const timeAtEnd = splits[segmentIndex];
    const segmentTime = timeAtEnd - timeAtStart;
    // Speed = distance / time, adjusted by timeScaleFactor
    return (400 / segmentTime) / timeScaleFactor;
}

// Cooldown speed after finishing (slow jog)
export function getCooldownSpeed(timeScaleFactor) {
    // About 3 m/s jog speed
    return 3.0 / timeScaleFactor;
}

// Runner class
export class Runner {
    constructor(model, mixer, action, lane, raceData, colorIndex) {
        this.model = model;
        this.mixer = mixer;
        this.action = action;
        this.lane = lane;
        this.lanePosition = lane;
        this.distance = 0;
        this.finished = false;
        this.squished = false;
        this.squishTimer = 0;
        this.raceData = raceData;
        this.currentSpeed = 0;
        this.targetSpeed = 0;

        // Lane locking for 400m/relay (stay in assigned lane)
        this.stayInLane = false;
        this.assignedLane = lane;
        this.assignedLanePosition = lane;

        // Waterfall break for 1600m (after first curve, break to lane 1)
        this.waterfallBroken = false;
        this.waterfallBreakDistance = 100; // Break after 100m

        // Random stride multiplier (0.85-1.15)
        this.strideMultiplier = 0.85 + Math.random() * 0.3;

        // Random animation offset (0-1 seconds)
        this.animationOffset = Math.random();

        // Apply color
        const material = new THREE.MeshStandardMaterial({
            color: RUNNER_COLORS[colorIndex],
            roughness: 0.7,
            metalness: 0.1
        });

        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.material = material;
            }
        });
    }

    reset(distance, lanePosition) {
        this.distance = distance;
        this.lanePosition = lanePosition;
        this.finished = false;
        this.squished = false;
        this.squishTimer = 0;
        this.currentSpeed = 0;
        this.model.scale.setScalar(0.01);

        const pos = getPosition(this.distance, this.lanePosition);
        const groundY = pos.y || 0;
        this.model.position.set(pos.x, groundY, pos.z);

        if (this.action) {
            this.action.paused = false;
            this.mixer.update(this.animationOffset);
        }
    }

    update(delta, timeScaleFactor, allRunners, raceDistance) {
        // Handle squished recovery
        if (this.squished) {
            this.squishTimer -= delta;
            if (this.squishTimer <= 0) {
                // Pop back up!
                this.squished = false;
                this.model.scale.setScalar(0.01);
                this.model.position.y = 0;
                if (this.action) this.action.paused = false;
                console.log(`${this.raceData.name} popped back up!`);
            }
        }

        // Check if finished
        if (!this.finished && this.distance >= raceDistance) {
            this.finished = true;
            console.log(`${this.raceData.name} finished!`);
        }

        // Calculate target speed
        if (this.finished) {
            this.targetSpeed = getCooldownSpeed(timeScaleFactor);
        } else {
            this.targetSpeed = getTargetSpeed(this.raceData, this.distance, timeScaleFactor);
        }

        // Smooth acceleration
        const accelerationRate = 2.0;
        if (this.currentSpeed < this.targetSpeed) {
            this.currentSpeed = Math.min(this.currentSpeed + accelerationRate * delta, this.targetSpeed);
        } else if (this.currentSpeed > this.targetSpeed) {
            this.currentSpeed = Math.max(this.currentSpeed - accelerationRate * delta, this.targetSpeed);
        }

        // Move forward
        this.distance += this.currentSpeed * delta;

        // Lane jockeying
        this.updateLanePosition(delta, allRunners);

        // Update position (keep squished runners on ground)
        const pos = getPosition(this.distance, this.lanePosition);
        const groundY = pos.y || 0;
        const yPos = this.squished ? groundY + 0.01 : groundY;
        this.model.position.set(pos.x, yPos, pos.z);

        // Face forward
        const aheadPos = getPosition(this.distance + 2, this.lanePosition);
        this.model.lookAt(aheadPos.x, aheadPos.y || 0, aheadPos.z);

        // Update animation (but not while squished)
        if (this.mixer && !this.squished) {
            const BASE_ANIMATION_SPEED = 5000 / 600;
            const animationScale = this.currentSpeed / BASE_ANIMATION_SPEED;
            this.mixer.update(delta * Math.max(0.3, animationScale) * this.strideMultiplier);
        }
    }

    updateLanePosition(delta, allRunners) {
        // Lane locking: stay in assigned lane for 400m/relay
        if (this.stayInLane) {
            // Lock to assigned lane position
            this.lanePosition = this.assignedLanePosition;
            return;
        }

        // Waterfall break: after break distance, can drift to lane 1
        if (!this.waterfallBroken && this.distance >= this.waterfallBreakDistance) {
            this.waterfallBroken = true;
            // Now can drift normally
        }

        // Before waterfall break, stay in lane
        if (!this.waterfallBroken && this.waterfallBreakDistance > 0) {
            this.lanePosition = this.assignedLanePosition;
            return;
        }

        let blockedByRunner = null;
        let canDriftInside = true;

        for (const other of allRunners) {
            if (other === this) continue;

            const distanceDiff = this.distance - other.distance;
            const laneDiff = this.lanePosition - other.lanePosition;

            // Only block if truly alongside (within 0.5m)
            if (laneDiff > 0.3 && distanceDiff > -0.5 && distanceDiff < 0.5) {
                canDriftInside = false;
                if (!blockedByRunner || other.lanePosition < blockedByRunner.lanePosition) {
                    blockedByRunner = other;
                }
            }
        }

        // If blocked, accelerate slightly to get ahead
        if (blockedByRunner && this.lanePosition > MIN_LANE_POSITION + 0.5) {
            this.currentSpeed *= 1.0003;
        }

        // Drift toward lane 1 if path is clear (speed scales with lane position)
        if (canDriftInside && this.lanePosition > MIN_LANE_POSITION) {
            const driftMultiplier = this.lanePosition;
            const driftAmount = DRIFT_LEFT_SPEED * delta * driftMultiplier;
            this.lanePosition = Math.max(this.lanePosition - driftAmount, MIN_LANE_POSITION);
        }
    }

    // Set lane lock mode
    setLaneLock(stayInLane, assignedLane, assignedLanePosition) {
        this.stayInLane = stayInLane;
        this.assignedLane = assignedLane;
        this.assignedLanePosition = assignedLanePosition;
    }

    // Set waterfall mode for 1600m
    setWaterfallMode(breakDistance) {
        this.waterfallBreakDistance = breakDistance;
        this.waterfallBroken = false;
    }

    // Check if runner is drafting behind another
    isDraftingBehind(allRunners) {
        for (const other of allRunners) {
            if (other === this) continue;

            const distanceDiff = other.distance - this.distance;
            const laneDiff = Math.abs(this.lanePosition - other.lanePosition);

            // Behind someone (0.5-2m) and in same lane area
            if (distanceDiff > 0.5 && distanceDiff < 2.0 && laneDiff < 0.3) {
                return true;
            }
        }
        return false;
    }

    squish() {
        if (this.squished) return; // Already squished
        this.squished = true;
        this.squishTimer = 2.0; // Pop back up after 2 seconds
        this.model.scale.y = 0.001;
        this.model.position.y = 0.01;
        if (this.action) this.action.paused = true;
        console.log(`${this.raceData.name} got squished!`);
    }
}
