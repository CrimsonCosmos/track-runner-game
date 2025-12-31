import * as THREE from 'three';
import { getPosition } from './Track.js';
import { DRIFT_LEFT_SPEED, MIN_LANE_POSITION, MAX_LANE_POSITION, COLLISION_RADIUS } from './Runner.js';

// Camera constants
export const EYE_HEIGHT = 1.7;

// Lane movement constants
const LANE_MOVE_SPEED = 1.5; // How fast player can change lanes (lane units per second)
export const MAX_LOOK_OFFSET_X = Math.PI; // Max 180 degrees left/right
export const MAX_LOOK_OFFSET_Y = Math.PI / 4; // Max 45 degrees up/down
export const SNAP_BACK_SPEED = 8; // How fast view snaps back

// Third-person camera constants
export const THIRD_PERSON_DISTANCE = 25; // Distance behind player
export const THIRD_PERSON_HEIGHT = 8; // Height above player

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
        this.finished = false; // Has player crossed finish line

        // Camera mode: 'first-person' or 'third-person'
        this.cameraMode = 'third-person'; // Default to third-person to see character

        // Drag-to-look state
        this.isDragging = false;
        this.lookOffsetX = 0;
        this.lookOffsetY = 0;

        // Third-person camera controls
        this.orbitAngle = 0;      // Horizontal orbit (left/right)
        this.orbitPitch = 0.3;    // Vertical angle (up/down), start slightly above
        this.zoomDistance = 15;   // Distance from player (can zoom in/out)

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
                if (this.cameraMode === 'first-person') {
                    this.lookOffsetX += e.movementX * 0.003;
                    this.lookOffsetY += e.movementY * 0.003;
                    this.lookOffsetX = Math.max(-MAX_LOOK_OFFSET_X, Math.min(MAX_LOOK_OFFSET_X, this.lookOffsetX));
                    this.lookOffsetY = Math.max(-MAX_LOOK_OFFSET_Y, Math.min(MAX_LOOK_OFFSET_Y, this.lookOffsetY));
                } else {
                    // Third-person: orbit around player (horizontal + vertical)
                    // Invert horizontal to match first-person feel (drag right = look right)
                    this.orbitAngle -= e.movementX * 0.005;
                    this.orbitPitch -= e.movementY * 0.005;
                    // Clamp pitch between 0.1 (nearly level) and 1.2 (looking down from above)
                    this.orbitPitch = Math.max(0.1, Math.min(1.2, this.orbitPitch));
                }
            }
        });

        // Mouse wheel for zoom in third-person
        document.addEventListener('wheel', (e) => {
            if (this.cameraMode === 'third-person') {
                e.preventDefault();
                this.zoomDistance += e.deltaY * 0.02;
                // Clamp zoom between 5 and 50 meters
                this.zoomDistance = Math.max(5, Math.min(50, this.zoomDistance));
            }
        }, { passive: false });

        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Toggle camera mode with 'V' key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'v' || e.key === 'V') {
                this.cameraMode = this.cameraMode === 'first-person' ? 'third-person' : 'first-person';
                console.log('Camera mode:', this.cameraMode);
            }
        });
    }

    paceToSpeed() {
        const secondsPerMile = this.paceMinPerMile * 60;
        return METERS_PER_MILE / secondsPerMile;
    }

    reset(distance, lanePosition) {
        this.distance = distance;
        this.lanePosition = lanePosition;
        this.finished = false;
        this.lookOffsetX = 0;
        this.lookOffsetY = 0;
        this.orbitAngle = 0;

        const pos = getPosition(this.distance, this.lanePosition);
        const groundY = pos.y || 0;

        if (this.cameraMode === 'first-person') {
            this.camera.position.set(pos.x, groundY + EYE_HEIGHT, pos.z);
            const lookAheadPos = getPosition(this.distance + 5, this.lanePosition);
            const lookGroundY = lookAheadPos.y || 0;
            this.camera.lookAt(lookAheadPos.x, lookGroundY + EYE_HEIGHT, lookAheadPos.z);
        } else {
            // Third-person: position camera behind player using zoom/pitch settings
            const lookAheadPos = getPosition(this.distance + 2, this.lanePosition);
            const forwardDir = new THREE.Vector3(
                lookAheadPos.x - pos.x, 0, lookAheadPos.z - pos.z
            ).normalize();

            const backwardX = -forwardDir.x;
            const backwardZ = -forwardDir.z;

            const horizontalDist = this.zoomDistance * Math.cos(this.orbitPitch);
            const verticalDist = this.zoomDistance * Math.sin(this.orbitPitch);

            this.camera.position.x = pos.x + backwardX * horizontalDist;
            this.camera.position.z = pos.z + backwardZ * horizontalDist;
            this.camera.position.y = groundY + verticalDist + 1.5;
            this.camera.lookAt(pos.x, groundY + 1.5, pos.z);
        }
    }

    update(delta, time, aiRunners, inputManager = null, remoteRunners = [], skipDistanceUpdate = false) {
        // Only update distance if not being handled externally (e.g., arrow key / spacebar modes)
        if (!skipDistanceUpdate) {
            const userSpeed = this.paceToSpeed();
            this.distance += userSpeed * delta;
        }

        // Combine AI runners and remote players for collision detection
        const allRunners = [...aiRunners, ...remoteRunners];

        // Handle manual lane movement from input
        if (inputManager) {
            const laneDir = inputManager.getLaneDirection();
            if (laneDir !== 0) {
                const targetLanePos = this.lanePosition + (laneDir * LANE_MOVE_SPEED * delta);

                // Check for collisions before allowing movement
                if (!this.wouldCollide(targetLanePos, allRunners)) {
                    // Clamp to valid lane range
                    this.lanePosition = Math.max(MIN_LANE_POSITION, Math.min(MAX_LANE_POSITION, targetLanePos));
                }
            }
        }

        // User lane jockeying - drift to lane 1 if no one blocking on left (only if not manually moving)
        const manualMove = inputManager && inputManager.getLaneDirection() !== 0;
        if (!manualMove) {
            let userBlocked = false;
            for (const runner of allRunners) {
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

        // Base yaw angle (direction player is facing)
        const baseYaw = Math.atan2(forwardDir.x, forwardDir.z);

        if (this.cameraMode === 'first-person') {
            // First-person camera
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

            const lookYaw = baseYaw + this.lookOffsetX;
            const lookPitch = this.lookOffsetY;

            const lookDist = 10;
            const lookX = this.camera.position.x + Math.sin(lookYaw) * Math.cos(lookPitch) * lookDist;
            const lookY = this.camera.position.y + Math.sin(lookPitch) * lookDist;
            const lookZ = this.camera.position.z + Math.cos(lookYaw) * Math.cos(lookPitch) * lookDist;

            this.camera.lookAt(lookX, lookY, lookZ);
        } else {
            // Third-person camera - position behind and above player
            // Smoothly return orbit angle to 0 when not dragging
            if (!this.isDragging) {
                this.orbitAngle *= (1 - SNAP_BACK_SPEED * 0.5 * delta);
                if (Math.abs(this.orbitAngle) < 0.01) this.orbitAngle = 0;
            }

            // Calculate backward direction (opposite of forward)
            const backwardX = -forwardDir.x;
            const backwardZ = -forwardDir.z;

            // Apply orbit rotation
            const cos = Math.cos(this.orbitAngle);
            const sin = Math.sin(this.orbitAngle);
            const finalBackX = backwardX * cos - backwardZ * sin;
            const finalBackZ = backwardX * sin + backwardZ * cos;

            // Use zoom distance and pitch for camera positioning
            const horizontalDist = this.zoomDistance * Math.cos(this.orbitPitch);
            const verticalDist = this.zoomDistance * Math.sin(this.orbitPitch);

            // Position camera behind and above player
            const camX = userPos.x + finalBackX * horizontalDist;
            const camZ = userPos.z + finalBackZ * horizontalDist;
            const camY = groundY + verticalDist + 1.5; // +1.5 to look at chest height

            this.camera.position.set(camX, camY, camZ);

            // Look at player position (at chest height)
            this.camera.lookAt(userPos.x, groundY + 1.5, userPos.z);
        }
    }

    pushOutward(amount) {
        this.lanePosition = Math.min(this.lanePosition + amount, MAX_LANE_POSITION + 1);
    }

    // Check if moving to a target lane position would cause a collision
    wouldCollide(targetLanePos, allRunners) {
        const collisionDist = COLLISION_RADIUS * 2.5; // Distance threshold for collision

        for (const runner of allRunners) {
            // Skip if runner is too far ahead or behind
            const distanceDiff = Math.abs(this.distance - runner.distance);
            if (distanceDiff > collisionDist) continue;

            // Check if we'd be in the same lane space
            const laneDiff = Math.abs(targetLanePos - runner.lanePosition);
            if (laneDiff < 0.4) { // Within ~half a lane width
                // Would collide with this runner
                return true;
            }
        }
        return false;
    }

    // Check for collision at current position and get push direction
    checkCollision(allRunners) {
        const collisionDist = COLLISION_RADIUS * 2;

        for (const runner of allRunners) {
            const distanceDiff = Math.abs(this.distance - runner.distance);
            if (distanceDiff > collisionDist) continue;

            const laneDiff = Math.abs(this.lanePosition - runner.lanePosition);
            if (laneDiff < 0.5) {
                // Colliding - return the runner so we can resolve
                return runner;
            }
        }
        return null;
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
