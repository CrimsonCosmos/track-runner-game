// EnergySystem.js - Energy/fatigue systems for different race modes

import { ENERGY_TYPE, RACE_MODES, RACE_MODE } from './RaceConfig.js';

// Lactic Acid constants (400m)
const LACTIC_FILL_BASE = 8;      // Base fill rate at moderate speed
const LACTIC_FILL_EXPONENT = 2;  // How much faster it fills at high speed
const LACTIC_DRAIN_RATE = 15;    // How fast it drains when slowing
const LACTIC_SPEED_THRESHOLD = 6; // Speed below which lactic starts draining
const LACTIC_PENALTY_MAX = 0.5;  // Max speed penalty at 100% lactic (50% reduction)

// Stamina constants (1600m)
const STAMINA_BASE_DRAIN = 2;    // Base drain rate per second
const STAMINA_SPEED_MULTIPLIER = 0.8; // Extra drain per m/s of speed
const STAMINA_DRAFT_REDUCTION = 0.5; // 50% less drain when drafting
const KICK_MULTIPLIER = 2;       // Kick bar = 2x remaining stamina
const KICK_DRAIN_RATE = 3;       // How fast kick depletes per second

/**
 * Lactic Acid System (400m Sprint)
 * - Fills up faster the faster you run
 * - Drains when you slow down
 * - At 100%, you DNF (Did Not Finish)
 * - As it fills, runner slows involuntarily
 */
export class LacticAcidSystem {
    constructor() {
        this.level = 0; // 0-100
        this.dnf = false;
    }

    /**
     * Update lactic acid level
     * @param {number} speed - Current running speed (m/s)
     * @param {number} delta - Time since last frame (seconds)
     * @returns {number} Speed penalty multiplier (0-1, where 1 = no penalty)
     */
    update(speed, delta) {
        if (this.dnf) return 0;

        // Calculate fill rate based on speed (exponential)
        const normalizedSpeed = speed / 12; // 0-1 based on max speed
        const fillRate = Math.pow(normalizedSpeed, LACTIC_FILL_EXPONENT) * LACTIC_FILL_BASE * delta * 10;

        // Calculate drain rate (when going slow)
        let drainRate = 0;
        if (speed < LACTIC_SPEED_THRESHOLD) {
            const slowness = (LACTIC_SPEED_THRESHOLD - speed) / LACTIC_SPEED_THRESHOLD;
            drainRate = slowness * LACTIC_DRAIN_RATE * delta;
        }

        // Update level
        this.level = Math.max(0, Math.min(100, this.level + fillRate - drainRate));

        // Check for DNF
        if (this.level >= 100) {
            this.dnf = true;
            return 0;
        }

        // Calculate speed penalty
        // At 50% lactic: 25% penalty, at 100%: 50% penalty
        const penalty = (this.level / 100) * LACTIC_PENALTY_MAX;
        return 1 - penalty;
    }

    isDNF() {
        return this.dnf;
    }

    getLevel() {
        return this.level;
    }

    reset() {
        this.level = 0;
        this.dnf = false;
    }
}

/**
 * Stamina System (1600m Mile)
 * - Starts at 100%, depletes over time
 * - Faster running depletes faster
 * - Drafting behind other runners reduces depletion
 * - At 1200m, converts to Kick bar (2x remaining stamina)
 * - Kick depletes as you sprint the final 400m
 */
export class StaminaSystem {
    constructor() {
        this.stamina = 100; // 0-100
        this.kickBar = 0;   // 0-100 (only active in kick phase)
        this.inKickPhase = false;
        this.kickActivated = false;
    }

    /**
     * Update stamina/kick
     * @param {number} speed - Current running speed (m/s)
     * @param {boolean} isDrafting - Whether player is drafting behind someone
     * @param {number} distance - Current distance traveled (meters)
     * @param {number} delta - Time since last frame (seconds)
     * @returns {number} Speed multiplier (0-1, where 1 = full speed)
     */
    update(speed, isDrafting, distance, delta) {
        const config = RACE_MODES[RACE_MODE.MILE_1600];

        // Check if entering kick phase
        if (distance >= config.kickPhaseStart && !this.kickActivated) {
            this.activateKick();
        }

        if (this.inKickPhase) {
            // Kick phase: bar depletes as you run
            const depletion = KICK_DRAIN_RATE * delta + (speed / 12) * delta * 5;
            this.kickBar = Math.max(0, this.kickBar - depletion);

            // If kick runs out, dramatic slowdown
            if (this.kickBar <= 0) {
                return 0.3; // Can only run at 30% speed
            }
            return 1;
        } else {
            // Stamina phase: depletes over time
            let depletionRate = STAMINA_BASE_DRAIN + (speed * STAMINA_SPEED_MULTIPLIER);

            // Drafting reduces depletion
            if (isDrafting) {
                depletionRate *= STAMINA_DRAFT_REDUCTION;
            }

            this.stamina = Math.max(0, this.stamina - depletionRate * delta);

            // No speed penalty during stamina phase
            return 1;
        }
    }

    activateKick() {
        // Convert remaining stamina to kick bar (2x multiplier)
        this.kickBar = Math.min(100, this.stamina * KICK_MULTIPLIER);
        this.inKickPhase = true;
        this.kickActivated = true;
    }

    getStamina() {
        return this.stamina;
    }

    getKickBar() {
        return this.kickBar;
    }

    isInKickPhase() {
        return this.inKickPhase;
    }

    // Get display value (stamina or kick depending on phase)
    getDisplayValue() {
        return this.inKickPhase ? this.kickBar : this.stamina;
    }

    getDisplayLabel() {
        return this.inKickPhase ? 'KICK' : 'STAMINA';
    }

    reset() {
        this.stamina = 100;
        this.kickBar = 0;
        this.inKickPhase = false;
        this.kickActivated = false;
    }
}

/**
 * Factory function to create the appropriate energy system
 * @param {string} raceMode - The race mode identifier
 * @returns {LacticAcidSystem|StaminaSystem|null}
 */
export function createEnergySystem(raceMode) {
    const config = RACE_MODES[raceMode];
    if (!config) return null;

    switch (config.energyType) {
        case ENERGY_TYPE.LACTIC_ACID:
            return new LacticAcidSystem();
        case ENERGY_TYPE.STAMINA_KICK:
            return new StaminaSystem();
        default:
            return null;
    }
}
