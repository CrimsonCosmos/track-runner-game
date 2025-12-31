// GhostRunner.js - Replay saved races as a ghost runner

import * as THREE from 'three';
import { getPosition } from './Track.js';

/**
 * GhostRunner - Replays a saved race as a semi-transparent ghost
 * - Uses replay data to position the ghost
 * - Interpolates between recorded frames
 * - Displays ghost with transparency
 */
export class GhostRunner {
    constructor(replayData, scene, options = {}) {
        this.replayData = replayData;
        this.scene = scene;
        this.currentIndex = 0;

        // Options
        this.color = options.color || 0x00ffff; // Cyan ghost
        this.opacity = options.opacity || 0.4;
        this.playerName = options.playerName || 'Ghost';
        this.lanePosition = options.lanePosition || 1;

        // Create ghost mesh
        this.mesh = this.createGhostMesh();
        this.scene.add(this.mesh);

        // Name label
        this.nameLabel = this.createNameLabel();
        this.scene.add(this.nameLabel);

        // State
        this.active = true;
        this.finished = false;
    }

    /**
     * Create a simple ghost mesh (placeholder until we can load actual character)
     */
    createGhostMesh() {
        // Simple capsule-like shape for ghost
        const geometry = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);

        const material = new THREE.MeshStandardMaterial({
            color: this.color,
            transparent: true,
            opacity: this.opacity,
            emissive: this.color,
            emissiveIntensity: 0.3,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        return mesh;
    }

    /**
     * Create a floating name label above the ghost
     */
    createNameLabel() {
        // Create a canvas for the text
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const context = canvas.getContext('2d');

        // Draw text
        context.fillStyle = 'transparent';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 32px Arial';
        context.fillStyle = '#00ffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(this.playerName, canvas.width / 2, canvas.height / 2);

        // Create texture and sprite
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.8
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2, 0.5, 1);

        return sprite;
    }

    /**
     * Update ghost position based on elapsed time
     * @param {number} elapsedTime - Time since race started
     */
    update(elapsedTime) {
        if (!this.active || this.finished || this.replayData.length === 0) return;

        // Find the two frames to interpolate between
        while (this.currentIndex < this.replayData.length - 1 &&
               this.replayData[this.currentIndex + 1].time <= elapsedTime) {
            this.currentIndex++;
        }

        // Check if finished
        if (this.currentIndex >= this.replayData.length - 1) {
            this.finished = true;
            this.hide();
            return;
        }

        // Interpolate between frames
        const frame1 = this.replayData[this.currentIndex];
        const frame2 = this.replayData[this.currentIndex + 1];

        const t = (elapsedTime - frame1.time) / (frame2.time - frame1.time);
        const interpolatedDistance = frame1.distance + (frame2.distance - frame1.distance) * t;

        // Get position on track
        const pos = getPosition(interpolatedDistance, this.lanePosition);

        // Update mesh position
        this.mesh.position.set(pos.x, (pos.y || 0) + 0.9, pos.z);

        // Calculate rotation based on movement direction
        if (this.currentIndex > 0) {
            const prevFrame = this.replayData[this.currentIndex - 1];
            const prevPos = getPosition(prevFrame.distance, this.lanePosition);
            const dx = pos.x - prevPos.x;
            const dz = pos.z - prevPos.z;
            if (dx !== 0 || dz !== 0) {
                this.mesh.rotation.y = Math.atan2(dx, dz);
            }
        }

        // Update name label position (above ghost)
        this.nameLabel.position.copy(this.mesh.position);
        this.nameLabel.position.y += 1.5;
    }

    /**
     * Reset ghost for new race
     */
    reset() {
        this.currentIndex = 0;
        this.finished = false;
        this.active = true;
        this.show();
    }

    /**
     * Show ghost
     */
    show() {
        this.mesh.visible = true;
        this.nameLabel.visible = true;
    }

    /**
     * Hide ghost
     */
    hide() {
        this.mesh.visible = false;
        this.nameLabel.visible = false;
    }

    /**
     * Set active state
     */
    setActive(active) {
        this.active = active;
        if (!active) this.hide();
        else this.show();
    }

    /**
     * Check if ghost has finished
     */
    hasFinished() {
        return this.finished;
    }

    /**
     * Get ghost's current distance (for comparison)
     */
    getCurrentDistance() {
        if (this.currentIndex < this.replayData.length) {
            return this.replayData[this.currentIndex].distance;
        }
        return 0;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.scene.remove(this.mesh);

        this.nameLabel.material.map.dispose();
        this.nameLabel.material.dispose();
        this.scene.remove(this.nameLabel);
    }
}

/**
 * GhostManager - Manages multiple ghost runners
 */
export class GhostManager {
    constructor(scene) {
        this.scene = scene;
        this.ghosts = [];
    }

    /**
     * Add a ghost from replay data
     * @param {Array} replayData - Array of {time, distance} frames
     * @param {Object} options - Ghost options (color, opacity, playerName)
     */
    addGhost(replayData, options = {}) {
        const ghost = new GhostRunner(replayData, this.scene, options);
        this.ghosts.push(ghost);
        return ghost;
    }

    /**
     * Add ghost from scoreboard entry
     * @param {Object} entry - Scoreboard entry with replayData
     * @param {Object} options - Additional options (lanePosition, color, etc.)
     */
    addGhostFromEntry(entry, options = {}) {
        if (!entry || !entry.replayData || entry.replayData.length === 0) {
            console.warn('Cannot add ghost - no replay data');
            return null;
        }

        return this.addGhost(entry.replayData, {
            playerName: options.playerName || entry.playerName || 'Ghost',
            color: options.color || 0x00ffff,
            opacity: options.opacity || 0.4,
            lanePosition: options.lanePosition || 1
        });
    }

    /**
     * Load recent races as ghosts in lanes 2-8
     * @param {Array} recentRaces - Array of scoreboard entries (most recent first)
     */
    loadRecentRacesAsGhosts(recentRaces) {
        // Colors for different ghost lanes
        const ghostColors = [
            0x00ffff, // Cyan - most recent (lane 2)
            0x00ff88, // Green-cyan (lane 3)
            0x88ff00, // Yellow-green (lane 4)
            0xffff00, // Yellow (lane 5)
            0xffaa00, // Orange (lane 6)
            0xff6600, // Dark orange (lane 7)
            0xff3366  // Pink-red (lane 8)
        ];

        // Lane positions (matching LANE_FORMATION)
        const lanePositions = [1.0, 1.15, 1.30, 1.45, 1.60, 1.75, 1.90];

        for (let i = 0; i < recentRaces.length && i < 7; i++) {
            const entry = recentRaces[i];
            const lane = i + 2; // Lanes 2-8
            const lanePos = lanePositions[i];

            // Format time for display
            const mins = Math.floor(entry.time / 60);
            const secs = (entry.time % 60).toFixed(1);
            const timeStr = `${mins}:${secs.padStart(4, '0')}`;

            // Create label: "Race #N - M:SS.S"
            const raceNum = recentRaces.length - i;
            const label = `Race #${raceNum} - ${timeStr}`;

            this.addGhostFromEntry(entry, {
                lanePosition: lanePos,
                color: ghostColors[i],
                opacity: 0.35,
                playerName: label
            });

            console.log(`Loaded ghost in lane ${lane}: ${label}`);
        }

        return this.ghosts.length;
    }

    /**
     * Update all ghosts
     * @param {number} elapsedTime - Time since race started
     */
    update(elapsedTime) {
        for (const ghost of this.ghosts) {
            ghost.update(elapsedTime);
        }
    }

    /**
     * Reset all ghosts for new race
     */
    reset() {
        for (const ghost of this.ghosts) {
            ghost.reset();
        }
    }

    /**
     * Remove all ghosts
     */
    clearAll() {
        for (const ghost of this.ghosts) {
            ghost.dispose();
        }
        this.ghosts = [];
    }

    /**
     * Get number of active ghosts
     */
    getActiveCount() {
        return this.ghosts.filter(g => g.active && !g.finished).length;
    }
}
