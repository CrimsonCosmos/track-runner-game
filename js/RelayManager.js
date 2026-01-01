// RelayManager.js - Manages relay race legs, handoffs, and replay data

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RACE_MODES, RACE_MODE, isInExchangeZone, getCurrentLeg } from './RaceConfig.js';
import { ExchangeZone } from './ExchangeZone.js';
import { Baton } from './Baton.js';
import { getPosition } from './Track.js';

// Distance ahead of incoming runner where next runner waits
const NEXT_RUNNER_OFFSET = 10; // meters ahead in the exchange zone

// Rotation offsets for models that don't face +Z by default
const MODEL_ROTATION_OFFSETS = {
    skeleton: Math.PI,       // Skeleton faces backwards, needs 180 degree rotation
    trump: -Math.PI / 2,     // Trump faces +X, needs -90 degree rotation
    musk: -Math.PI / 2,      // Musk faces +X, needs -90 degree rotation
    snowman: -Math.PI / 2,   // Snowman faces +X, needs -90 degree rotation
};

// Scale overrides for models with different internal sizes
const MODEL_SCALE_OVERRIDES = {
    stalin: 1.0,     // ReadyPlayerMe model is already in meters
    demon: 0.008,
    // Default is 0.01
};

/**
 * RelayManager - Handles all relay-specific logic
 * - Tracks current leg (0-3)
 * - Manages exchange zones
 * - Records replay data for ghost racing
 * - Handles handoff success/failure
 * - Manages visual relay runner meshes
 */
export class RelayManager {
    constructor(scene, inputManager) {
        this.scene = scene;
        this.inputManager = inputManager;
        this.config = RACE_MODES[RACE_MODE.RELAY_4X100];

        // Current state
        this.currentLeg = 0;
        this.raceStartTime = 0;
        this.legStartTimes = [0]; // Time when each leg started
        this.legSplits = [];      // Split time for each completed leg

        // Exchange zone
        this.exchangeZone = new ExchangeZone();
        this.inZone = false;
        this.zoneEnterTime = 0;

        // Baton
        this.baton = new Baton(scene);

        // Race state
        this.raceActive = false;
        this.raceOver = false;
        this.raceResult = null;

        // Track completed handoffs to prevent re-entering completed zones
        this.lastCompletedZone = -1;

        // Replay data - record position every frame
        this.replayData = [];
        this.replayInterval = 1 / 30; // 30 FPS for replay
        this.lastReplayTime = 0;

        // Relay runner visuals
        this.nextRunnerMesh = null;      // The waiting runner in exchange zone
        this.nextRunnerMixer = null;     // Animation mixer for next runner
        this.nextRunnerAction = null;    // Animation action
        this.nextRunnerDistance = 0;     // Where the next runner is positioned
        this.playerCharacterModel = null; // Reference to player's character model path
    }

    /**
     * Start the relay race
     * @param {number} startTime - Timestamp when race starts
     */
    startRace(startTime) {
        this.raceStartTime = startTime;
        this.legStartTimes = [startTime];
        this.legSplits = [];
        this.currentLeg = 0;
        this.raceActive = true;
        this.raceOver = false;
        this.raceResult = null;
        this.lastCompletedZone = -1;
        this.replayData = [];
        this.lastReplayTime = 0;
        this.exchangeZone.reset();
        this.baton.reset();
    }

    /**
     * Update relay state
     * @param {number} delta - Time since last frame
     * @param {number} elapsedTime - Total race time elapsed
     * @param {number} playerDistance - Player's current distance
     * @param {Object} player - Player object for baton attachment
     * @param {number} playerSpeed - Player's current speed in m/s
     */
    update(delta, elapsedTime, playerDistance, player, playerSpeed = 0) {
        if (!this.raceActive || this.raceOver) return;

        // Update baton position
        this.baton.update();

        // Update the next runner (they start running when incoming runner approaches)
        this.updateNextRunner(delta, playerDistance, playerSpeed);

        // Record replay data
        this.recordReplayFrame(elapsedTime, playerDistance);

        // Check if in exchange zone
        const zoneCheck = isInExchangeZone(playerDistance, RACE_MODE.RELAY_4X100);

        // Debug: log distance periodically
        if (Math.floor(playerDistance) % 10 === 0 && Math.floor(playerDistance) !== this._lastLoggedDistance) {
            this._lastLoggedDistance = Math.floor(playerDistance);
            console.log(`Distance: ${playerDistance.toFixed(1)}m, inZone: ${zoneCheck.inZone}, currentLeg: ${this.currentLeg}`);
        }

        if (zoneCheck.inZone && !this.inZone) {
            // Just entered exchange zone
            this.enterExchangeZone(zoneCheck.zoneIndex);
        } else if (!zoneCheck.inZone && this.inZone) {
            // Left exchange zone without handoff
            this.exitExchangeZone(elapsedTime);
        }

        if (this.inZone) {
            // Update timing bar
            this.exchangeZone.update(delta);

            // Check for Enter key press
            const enterPressed = this.inputManager.consumeEnterPress();
            if (enterPressed) {
                console.log('Enter pressed in exchange zone! Attempting handoff...');
                this.attemptHandoff(elapsedTime, player);
            }
        }

        // Check for race finish
        if (playerDistance >= this.config.totalDistance) {
            this.finishRace(elapsedTime);
        }
    }

    /**
     * Record a frame of replay data
     */
    recordReplayFrame(elapsedTime, distance) {
        if (elapsedTime - this.lastReplayTime >= this.replayInterval) {
            this.replayData.push({
                time: elapsedTime,
                distance: distance,
                leg: this.currentLeg
            });
            this.lastReplayTime = elapsedTime;
        }
    }

    /**
     * Enter an exchange zone
     */
    enterExchangeZone(zoneIndex) {
        // Don't re-enter a zone we already completed
        if (zoneIndex <= this.lastCompletedZone) {
            console.log(`Skipping zone ${zoneIndex + 1} - already completed`);
            return;
        }

        this.inZone = true;
        this.exchangeZone.activate(zoneIndex);
        console.log(`Entered exchange zone ${zoneIndex + 1}`);

        // Spawn the next runner waiting in the exchange zone
        this.spawnNextRunner(zoneIndex);
    }

    /**
     * Exit exchange zone (missed handoff window)
     */
    exitExchangeZone(elapsedTime) {
        this.inZone = false;

        // If handoff wasn't attempted, it's a failure
        if (!this.exchangeZone.wasHandoffAttempted()) {
            this.failHandoff('Missed exchange zone!', elapsedTime);
        }

        this.exchangeZone.deactivate();

        // Clean up the next runner (they go away on failed handoff)
        this.removeNextRunner();
    }

    /**
     * Attempt a handoff when player presses Enter
     */
    attemptHandoff(elapsedTime, player) {
        console.log('attemptHandoff called');
        const result = this.exchangeZone.attemptHandoff();
        console.log('Handoff result:', result);

        if (!result.success) {
            // Dropped baton - race over
            this.failHandoff(result.message, elapsedTime);
            return;
        }

        // Successful handoff
        this.completeHandoff(result, elapsedTime, player);
    }

    /**
     * Complete a successful handoff
     */
    completeHandoff(result, elapsedTime, player) {
        // Record leg split
        const legTime = elapsedTime - this.legStartTimes[this.currentLeg];
        this.legSplits.push(legTime);

        // Mark this zone as completed (zone index = current leg before incrementing)
        this.lastCompletedZone = this.currentLeg;

        // Move to next leg
        this.currentLeg++;
        this.legStartTimes.push(elapsedTime);

        // Apply speed bonus from handoff quality
        this.inputManager.setHandoffBonus(result.speedBonus);

        // Deactivate zone
        this.inZone = false;
        this.exchangeZone.deactivate();

        // Remove the next runner mesh (the player ghost will continue as the new runner)
        this.removeNextRunner();

        console.log(`Handoff complete! Leg ${this.currentLeg + 1}, split: ${legTime.toFixed(2)}s, bonus: ${result.speedBonus}`);
    }

    /**
     * Handle a failed handoff
     */
    failHandoff(message, elapsedTime) {
        this.raceOver = true;
        this.baton.drop();

        this.raceResult = {
            success: false,
            message: message,
            totalTime: elapsedTime,
            legSplits: this.legSplits,
            replayData: this.replayData,
            finalLeg: this.currentLeg
        };

        console.log(`Relay failed: ${message}`);
    }

    /**
     * Finish the race successfully
     */
    finishRace(elapsedTime) {
        // Record final leg split
        const legTime = elapsedTime - this.legStartTimes[this.currentLeg];
        this.legSplits.push(legTime);

        this.raceOver = true;
        this.raceActive = false;

        this.raceResult = {
            success: true,
            message: 'FINISHED!',
            totalTime: elapsedTime,
            legSplits: this.legSplits,
            replayData: this.replayData,
            finalLeg: 3
        };

        console.log(`Relay complete! Total time: ${elapsedTime.toFixed(2)}s`);
        console.log(`Leg splits: ${this.legSplits.map(t => t.toFixed(2)).join(', ')}`);
    }

    /**
     * Get current leg number (1-4 for display)
     */
    getCurrentLegDisplay() {
        return this.currentLeg + 1;
    }

    /**
     * Get current leg split time
     */
    getCurrentLegTime(elapsedTime) {
        if (this.currentLeg < this.legStartTimes.length) {
            return elapsedTime - this.legStartTimes[this.currentLeg];
        }
        return 0;
    }

    /**
     * Check if race is over
     */
    isRaceOver() {
        return this.raceOver;
    }

    /**
     * Get race result
     */
    getRaceResult() {
        return this.raceResult;
    }

    /**
     * Check if in exchange zone
     */
    isInExchangeZone() {
        return this.inZone;
    }

    /**
     * Get exchange zone for UI updates
     */
    getExchangeZone() {
        return this.exchangeZone;
    }

    /**
     * Get baton
     */
    getBaton() {
        return this.baton;
    }

    /**
     * Format time as MM:SS.ms
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(2);
        return `${mins}:${secs.padStart(5, '0')}`;
    }

    /**
     * Reset for new race
     */
    reset() {
        this.currentLeg = 0;
        this.raceStartTime = 0;
        this.legStartTimes = [];
        this.legSplits = [];
        this.raceActive = false;
        this.raceOver = false;
        this.raceResult = null;
        this.lastCompletedZone = -1;
        this.replayData = [];
        this.lastReplayTime = 0;
        this.inZone = false;
        this.exchangeZone.reset();
        this.baton.reset();
        this.removeNextRunner();
    }

    /**
     * Spawn the next runner in the exchange zone
     * @param {number} zoneIndex - Which zone (0, 1, or 2)
     */
    spawnNextRunner(zoneIndex) {
        // Don't spawn for the last leg (leg 3 finishes the race)
        if (this.currentLeg >= 3) return;

        // Get the model path from window.playerCharacterModel
        const modelPath = window.playerCharacterModel?.path;
        if (!modelPath) {
            console.log('No player character model path, cannot spawn next runner');
            return;
        }

        // Calculate where the next runner should wait
        // Olympic zones: 90-120m, 190-220m, 290-320m - runner waits partway into the zone
        const zoneStart = this.config.exchangeZoneStart[zoneIndex];
        this.nextRunnerDistance = zoneStart + NEXT_RUNNER_OFFSET;

        console.log(`Spawning next runner at distance ${this.nextRunnerDistance}m for leg ${this.currentLeg + 2}`);

        const loader = new FBXLoader();
        loader.load(
            modelPath,
            (fbx) => {
                this.nextRunnerMesh = fbx;

                // Use character-specific scale or default
                const characterKey = window.playerCharacter || '';
                const scale = MODEL_SCALE_OVERRIDES[characterKey] || 0.01;
                this.nextRunnerMesh.scale.setScalar(scale);

                // Create animation mixer
                this.nextRunnerMixer = new THREE.AnimationMixer(fbx);
                if (fbx.animations.length > 0) {
                    this.nextRunnerAction = this.nextRunnerMixer.clipAction(fbx.animations[0]);
                    this.nextRunnerAction.play();
                    // Run slowly at first (waiting to receive baton)
                    this.nextRunnerAction.timeScale = 0.3;
                }

                // Apply shadows and fix materials that might be invisible
                fbx.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Ensure materials are visible even without textures
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(mat => {
                            if (mat) {
                                // If material has no map or map failed to load, ensure it's still visible
                                if (!mat.map || mat.map.image === undefined) {
                                    mat.color = mat.color || new THREE.Color(0x888888);
                                }
                                // Ensure material is not transparent
                                mat.transparent = false;
                                mat.opacity = 1;
                                mat.side = THREE.DoubleSide;
                                mat.needsUpdate = true;
                            }
                        });
                    }
                });

                // Position the runner on the track
                const pos = getPosition(this.nextRunnerDistance, 1); // Lane 1 for relay
                this.nextRunnerMesh.position.set(pos.x, pos.y || 0, pos.z);

                // Face forward on the track
                const aheadPos = getPosition(this.nextRunnerDistance + 2, 1);
                this.nextRunnerMesh.lookAt(aheadPos.x, aheadPos.y || 0, aheadPos.z);

                // Apply model rotation offset if needed
                const rotationOffset = MODEL_ROTATION_OFFSETS[characterKey] || 0;
                if (rotationOffset !== 0) {
                    this.nextRunnerMesh.rotation.y += rotationOffset;
                }

                // Add to scene
                this.scene.add(this.nextRunnerMesh);
                console.log('Next runner spawned successfully');
            },
            undefined,
            (error) => {
                console.error('Error loading next runner model:', error);
            }
        );
    }

    /**
     * Update the next runner - they start running when incoming runner gets close
     * @param {number} delta - Time since last frame
     * @param {number} playerDistance - Current player distance
     * @param {number} playerSpeed - Current player speed (m/s)
     */
    updateNextRunner(delta, playerDistance, playerSpeed = 0) {
        if (!this.nextRunnerMesh || !this.nextRunnerMixer) return;

        // Update animation
        this.nextRunnerMixer.update(delta);

        const distanceToPlayer = this.nextRunnerDistance - playerDistance;

        // The "go mark" - when incoming runner is this close, next runner takes off
        const GO_MARK_DISTANCE = 12; // meters - receiving runner starts when incoming is 12m away

        if (distanceToPlayer <= GO_MARK_DISTANCE && distanceToPlayer > -5) {
            // Next runner is now running!
            // They run slightly slower than the incoming runner so the handoff can happen
            // As they get caught up, they speed up to match

            let nextRunnerSpeed;
            if (distanceToPlayer > 2) {
                // Still ahead - run at ~80% of incoming runner's speed so they can catch up
                nextRunnerSpeed = playerSpeed * 0.8;
            } else if (distanceToPlayer > 0) {
                // About to be caught - match speed for handoff window
                nextRunnerSpeed = playerSpeed * 0.95;
            } else {
                // Player has passed - run at full speed (shouldn't happen with good timing)
                nextRunnerSpeed = playerSpeed;
            }

            // Move the next runner forward
            this.nextRunnerDistance += nextRunnerSpeed * delta;

            // Update position on track
            const pos = getPosition(this.nextRunnerDistance, 1);
            this.nextRunnerMesh.position.set(pos.x, pos.y || 0, pos.z);

            // Face forward
            const aheadPos = getPosition(this.nextRunnerDistance + 2, 1);
            this.nextRunnerMesh.lookAt(aheadPos.x, aheadPos.y || 0, aheadPos.z);

            // Apply rotation offset
            const characterKey = window.playerCharacter || '';
            const rotationOffset = MODEL_ROTATION_OFFSETS[characterKey] || 0;
            if (rotationOffset !== 0) {
                this.nextRunnerMesh.rotation.y += rotationOffset;
            }

            // Animation speed based on running speed
            if (this.nextRunnerAction) {
                const animSpeed = Math.max(0.5, nextRunnerSpeed / 10); // Scale animation with speed
                this.nextRunnerAction.timeScale = animSpeed;
            }
        } else if (distanceToPlayer > GO_MARK_DISTANCE) {
            // Waiting in ready position - slight anticipation animation
            if (this.nextRunnerAction) {
                this.nextRunnerAction.timeScale = 0.2; // Very slow "ready" animation
            }
        }
    }

    /**
     * Remove the next runner mesh from the scene
     */
    removeNextRunner() {
        if (this.nextRunnerMesh) {
            this.scene.remove(this.nextRunnerMesh);
            this.nextRunnerMesh.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            this.nextRunnerMesh = null;
            this.nextRunnerMixer = null;
            this.nextRunnerAction = null;
        }
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.baton.dispose();
        this.removeNextRunner();
    }
}
