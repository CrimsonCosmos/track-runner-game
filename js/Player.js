import * as THREE from 'three';
import { getPosition } from './Track.js';
import { DRIFT_LEFT_SPEED, MIN_LANE_POSITION, MAX_LANE_POSITION } from './Runner.js';

// Camera constants
export const EYE_HEIGHT = 1.7;
export const MAX_LOOK_OFFSET_X = Math.PI; // Max 180 degrees left/right
export const MAX_LOOK_OFFSET_Y = Math.PI / 4; // Max 45 degrees up/down
export const SNAP_BACK_SPEED = 8; // How fast view snaps back

// Pace constants
const METERS_PER_MILE = 1609.34;

// Player class
export class Player {
    constructor(camera) {
        this.camera = camera;
        this.distance = 0;
        this.lanePosition = 1.0;
        this.paceMinPerMile = 8.0; // Default 8 min/mile
        this.raceActive = false; // Set by main when race starts

        // Drag-to-look state
        this.isDragging = false;
        this.lookOffsetX = 0;
        this.lookOffsetY = 0;

        this.setupControls();
    }

    setupControls() {
        document.addEventListener('mousedown', (e) => {
            if (this.raceActive && e.button === 0) {
                this.isDragging = true;
            }
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDragging && this.raceActive) {
                this.lookOffsetX += e.movementX * 0.003;
                this.lookOffsetY += e.movementY * 0.003;

                // Clamp offsets
                this.lookOffsetX = Math.max(-MAX_LOOK_OFFSET_X, Math.min(MAX_LOOK_OFFSET_X, this.lookOffsetX));
                this.lookOffsetY = Math.max(-MAX_LOOK_OFFSET_Y, Math.min(MAX_LOOK_OFFSET_Y, this.lookOffsetY));
            }
        });

        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    paceToSpeed() {
        const secondsPerMile = this.paceMinPerMile * 60;
        return METERS_PER_MILE / secondsPerMile;
    }

    reset(distance, lanePosition) {
        this.distance = distance;
        this.lanePosition = lanePosition;
        this.lookOffsetX = 0;
        this.lookOffsetY = 0;

        const pos = getPosition(this.distance, this.lanePosition);
        const groundY = pos.y || 0;
        this.camera.position.set(pos.x, groundY + EYE_HEIGHT, pos.z);

        const lookAheadPos = getPosition(this.distance + 5, this.lanePosition);
        const lookGroundY = lookAheadPos.y || 0;
        this.camera.lookAt(lookAheadPos.x, lookGroundY + EYE_HEIGHT, lookAheadPos.z);
    }

    update(delta, time, aiRunners) {
        const userSpeed = this.paceToSpeed();
        this.distance += userSpeed * delta;

        // User lane jockeying - drift to lane 1 if no one blocking on left
        let userBlocked = false;
        for (const runner of aiRunners) {
            const distanceDiff = Math.abs(this.distance - runner.distance);
            if (distanceDiff < 1.5) {
                if (runner.lanePosition < this.lanePosition - 0.1) {
                    userBlocked = true;
                    break;
                }
            }
        }

        // Drift toward lane 1 if not blocked
        if (!userBlocked && this.lanePosition > MIN_LANE_POSITION) {
            this.lanePosition = Math.max(this.lanePosition - DRIFT_LEFT_SPEED * delta, MIN_LANE_POSITION);
        }

        // Get position on track/city
        const userPos = getPosition(this.distance, this.lanePosition);
        const groundY = userPos.y || 0;

        // Calculate forward direction
        const lookAheadDist = 2;
        const aheadPos = getPosition(this.distance + lookAheadDist, this.lanePosition);
        const forwardDir = new THREE.Vector3(
            aheadPos.x - userPos.x,
            0,
            aheadPos.z - userPos.z
        ).normalize();

        // Update camera position
        this.camera.position.x = userPos.x;
        this.camera.position.z = userPos.z;
        this.camera.position.y = groundY + EYE_HEIGHT;

        // Subtle head bob based on speed
        const bobSpeed = userSpeed * 2;
        const bobAmount = 0.02;
        this.camera.position.y += Math.sin(time * 0.001 * bobSpeed) * bobAmount;

        // Snap look offset back to center when not dragging
        if (!this.isDragging) {
            this.lookOffsetX *= (1 - SNAP_BACK_SPEED * delta);
            this.lookOffsetY *= (1 - SNAP_BACK_SPEED * delta);
            if (Math.abs(this.lookOffsetX) < 0.01) this.lookOffsetX = 0;
            if (Math.abs(this.lookOffsetY) < 0.01) this.lookOffsetY = 0;
        }

        // Calculate look direction with offset
        const baseYaw = Math.atan2(forwardDir.x, forwardDir.z);
        const lookYaw = baseYaw + this.lookOffsetX;
        const lookPitch = this.lookOffsetY;

        // Look in the offset direction
        const lookDist = 10;
        const lookX = this.camera.position.x + Math.sin(lookYaw) * Math.cos(lookPitch) * lookDist;
        const lookY = this.camera.position.y + Math.sin(lookPitch) * lookDist;
        const lookZ = this.camera.position.z + Math.cos(lookYaw) * Math.cos(lookPitch) * lookDist;

        this.camera.lookAt(lookX, lookY, lookZ);
    }

    pushOutward(amount) {
        this.lanePosition = Math.min(this.lanePosition + amount, MAX_LANE_POSITION + 1);
    }

    updatePosition() {
        const userPos = getPosition(this.distance, this.lanePosition);
        const groundY = userPos.y || 0;
        this.camera.position.x = userPos.x;
        this.camera.position.z = userPos.z;
        this.camera.position.y = groundY + EYE_HEIGHT;
    }
}

// Pace formatting utility
export function formatPace(minPerMile) {
    const mins = Math.floor(minPerMile);
    const secs = Math.round((minPerMile - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
