import * as THREE from 'three';
import { getTrackPosition } from './Track.js';

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

// Budapest 2023 World Championships 5000m Final - Top 7 splits
export const RACE_DATA = [
    { name: "Ingebrigtsen", splits: [157, 315, 472, 650, 791.3], finalTime: 791.3 },
    { name: "Katir", splits: [156, 313, 471, 650, 791.44], finalTime: 791.44 },
    { name: "Krop", splits: [156, 314, 472, 650, 792.28], finalTime: 792.28 },
    { name: "Grijalva", splits: [156, 314, 471, 648, 792.50], finalTime: 792.50 },
    { name: "Kejelcha", splits: [156, 314, 472, 650, 792.51], finalTime: 792.51 },
    { name: "Gebrhiwet", splits: [156, 314, 471, 650, 792.65], finalTime: 792.65 },
    { name: "Ahmed", splits: [156, 314, 472, 651, 792.92], finalTime: 792.92 }
];

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
export function getTargetSpeed(raceDataEntry, distance, timeScaleFactor) {
    const splits = raceDataEntry.splits;
    const segmentIndex = Math.min(Math.floor(distance / 1000), 4);
    const timeAtStart = segmentIndex === 0 ? 0 : splits[segmentIndex - 1];
    const timeAtEnd = splits[segmentIndex];
    const segmentTime = timeAtEnd - timeAtStart;
    return (1000 / segmentTime) / timeScaleFactor;
}

// Cooldown speed after finishing
export function getCooldownSpeed(timeScaleFactor) {
    return (5000 / 791.3 / 2) / timeScaleFactor;
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

        const pos = getTrackPosition(this.distance, this.lanePosition);
        this.model.position.set(pos.x, 0, pos.z);

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
        const pos = getTrackPosition(this.distance, this.lanePosition);
        const yPos = this.squished ? 0.01 : 0;
        this.model.position.set(pos.x, yPos, pos.z);

        // Face forward
        const aheadPos = getTrackPosition(this.distance + 2, this.lanePosition);
        this.model.lookAt(aheadPos.x, 0, aheadPos.z);

        // Update animation (but not while squished)
        if (this.mixer && !this.squished) {
            const BASE_ANIMATION_SPEED = 5000 / 600;
            const animationScale = this.currentSpeed / BASE_ANIMATION_SPEED;
            this.mixer.update(delta * Math.max(0.3, animationScale) * this.strideMultiplier);
        }
    }

    updateLanePosition(delta, allRunners) {
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
