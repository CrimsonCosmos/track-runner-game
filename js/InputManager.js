// InputManager.js - Handle different input modes per race type

import { INPUT_TYPE, RACE_MODES } from './RaceConfig.js';

// Speed constants
const MAX_SPEED = 12; // ~12 m/s max (roughly world record 100m pace)
const MIN_SPEED = 0;
const ARROW_SPEED_INCREMENT = 0.15; // Speed change per frame when holding arrow
const SPEED_DECAY = 0.5; // How fast speed decays when not pressing arrows (per second)

// Alternating key mash constants (B/N for relay)
const MASH_WINDOW = 500; // Count presses within this window (ms)
const PRESSES_FOR_MAX_SPEED = 10; // Presses per 500ms for max speed

export class InputManager {
    constructor(raceMode) {
        this.raceMode = raceMode;
        this.config = RACE_MODES[raceMode];
        this.inputType = this.config?.inputType || INPUT_TYPE.ARROW_KEYS;

        // Speed state
        this.currentSpeed = 0;
        this.targetSpeed = 0;

        // Alternating B/N key tracking (relay)
        this.alternatingPresses = []; // Timestamps of recent valid presses
        this.lastKeyPressed = null; // 'b' or 'n' - to enforce alternation
        this.bKeyHeld = false; // Track if B is being held
        this.nKeyHeld = false; // Track if N is being held

        // Arrow key state (400m/1600m)
        this.upPressed = false;
        this.downPressed = false;
        this.leftPressed = false;
        this.rightPressed = false;

        // Enter key for handoff
        this.enterPressed = false;
        this.enterJustPressed = false;

        // Bind event handlers
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);

        this.setupListeners();
    }

    setupListeners() {
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
    }

    destroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);
    }

    handleKeyDown(e) {
        // B key - alternating run for relay (must alternate with N)
        if (e.code === 'KeyB') {
            if (this.inputType === INPUT_TYPE.SPACEBAR_MASH) {
                // Only count if not already held and last key wasn't B
                if (!this.bKeyHeld && this.lastKeyPressed !== 'b') {
                    this.registerAlternatingPress('b');
                }
                this.bKeyHeld = true;
            }
        }

        // N key - alternating run for relay (must alternate with B)
        if (e.code === 'KeyN') {
            if (this.inputType === INPUT_TYPE.SPACEBAR_MASH) {
                // Only count if not already held and last key wasn't N
                if (!this.nKeyHeld && this.lastKeyPressed !== 'n') {
                    this.registerAlternatingPress('n');
                }
                this.nKeyHeld = true;
            }
        }

        // Arrow keys - speed control for 400m/1600m
        if (e.code === 'ArrowUp' || e.code === 'KeyW') {
            this.upPressed = true;
        }
        if (e.code === 'ArrowDown' || e.code === 'KeyS') {
            this.downPressed = true;
        }
        // Left/right for lane movement
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            this.leftPressed = true;
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            this.rightPressed = true;
        }

        // Enter key - handoff in relay
        if (e.code === 'Enter') {
            console.log('Enter key detected! enterPressed was:', this.enterPressed);
            if (!this.enterPressed) {
                this.enterJustPressed = true;
                console.log('enterJustPressed set to true');
            }
            this.enterPressed = true;
        }
    }

    handleKeyUp(e) {
        if (e.code === 'ArrowUp' || e.code === 'KeyW') {
            this.upPressed = false;
        }
        if (e.code === 'ArrowDown' || e.code === 'KeyS') {
            this.downPressed = false;
        }
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            this.leftPressed = false;
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            this.rightPressed = false;
        }
        if (e.code === 'Enter') {
            this.enterPressed = false;
        }
        // Release B/N keys
        if (e.code === 'KeyB') {
            this.bKeyHeld = false;
        }
        if (e.code === 'KeyN') {
            this.nKeyHeld = false;
        }
    }

    // Register an alternating B/N key press
    registerAlternatingPress(key) {
        const now = Date.now();
        this.alternatingPresses.push(now);
        this.lastKeyPressed = key;

        // Keep only presses within the window
        this.alternatingPresses = this.alternatingPresses.filter(t => now - t < MASH_WINDOW);
    }

    // Get mash rate (0-1) based on alternating B/N presses
    getMashRate() {
        const now = Date.now();
        // Clean old presses
        this.alternatingPresses = this.alternatingPresses.filter(t => now - t < MASH_WINDOW);

        // Calculate rate
        const pressCount = this.alternatingPresses.length;
        return Math.min(pressCount / PRESSES_FOR_MAX_SPEED, 1);
    }

    // Check if Enter was just pressed (and consume the event)
    consumeEnterPress() {
        if (this.enterJustPressed) {
            this.enterJustPressed = false;
            return true;
        }
        return false;
    }

    update(delta) {
        if (this.inputType === INPUT_TYPE.SPACEBAR_MASH) {
            // Relay mode: speed based on mash rate
            const mashRate = this.getMashRate();
            this.targetSpeed = mashRate * MAX_SPEED;

            // Smooth acceleration
            const speedDiff = this.targetSpeed - this.currentSpeed;
            this.currentSpeed += speedDiff * delta * 5;

            // Decay if not mashing
            if (mashRate < 0.1) {
                this.currentSpeed = Math.max(0, this.currentSpeed - SPEED_DECAY * delta * 5);
            }
        } else {
            // 400m/1600m: arrow key control
            if (this.upPressed) {
                this.currentSpeed = Math.min(MAX_SPEED, this.currentSpeed + ARROW_SPEED_INCREMENT);
            }
            if (this.downPressed) {
                this.currentSpeed = Math.max(MIN_SPEED, this.currentSpeed - ARROW_SPEED_INCREMENT);
            }

            // Natural decay when not pressing up
            if (!this.upPressed && !this.downPressed) {
                this.currentSpeed = Math.max(0, this.currentSpeed - SPEED_DECAY * delta);
            }
        }

        return this.currentSpeed;
    }

    // Get current speed in MPH for display
    getSpeedMPH() {
        // Convert m/s to MPH
        return this.currentSpeed * 2.237;
    }

    // Get current speed in min/mile pace for display
    getPace() {
        if (this.currentSpeed < 0.1) return '0:00';
        const metersPerMile = 1609.34;
        const secondsPerMile = metersPerMile / this.currentSpeed;
        const mins = Math.floor(secondsPerMile / 60);
        const secs = Math.floor(secondsPerMile % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Reset speed (e.g., after handoff)
    resetSpeed(newSpeed = 0) {
        this.currentSpeed = newSpeed;
        this.targetSpeed = newSpeed;
        this.alternatingPresses = [];
        this.lastKeyPressed = null;
    }

    // Set speed for handoff bonus (relay)
    setHandoffBonus(bonus) {
        // bonus: 0.5 for yellow, 1.0 for green
        this.currentSpeed = MAX_SPEED * bonus * 0.8; // Start at 80% of max * bonus
    }

    // Get lane movement direction (-1 = left/inside, +1 = right/outside, 0 = no movement)
    getLaneDirection() {
        if (this.leftPressed && !this.rightPressed) return -1;
        if (this.rightPressed && !this.leftPressed) return 1;
        return 0;
    }
}
