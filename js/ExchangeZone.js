// ExchangeZone.js - Timing bar system for relay handoffs

import { RACE_MODES, RACE_MODE, isInExchangeZone } from './RaceConfig.js';

// Zone colors
export const ZONE_COLOR = {
    RED: 'red',
    YELLOW: 'yellow',
    GREEN: 'green'
};

// Timing bar constants
const OSCILLATE_SPEED = 2.5; // Full cycles per second
const RED_THRESHOLD = 0.2;   // 0-0.2 and 0.8-1.0 = red
const YELLOW_THRESHOLD = 0.4; // 0.2-0.4 and 0.6-0.8 = yellow
// 0.4-0.6 = green (the sweet spot)

/**
 * Exchange Zone System
 * - Manages the timing bar that oscillates red → yellow → green → yellow → red
 * - Player must press Enter at the right time to complete handoff
 * - Red = dropped baton (race over)
 * - Yellow = slow start on next leg
 * - Green = full speed start on next leg
 */
export class ExchangeZone {
    constructor() {
        this.active = false;
        this.barPosition = 0; // 0-1, oscillates
        this.direction = 1;   // 1 = going up, -1 = going down (ping-pong)
        this.currentZoneIndex = -1;
        this.handoffAttempted = false;
        this.handoffResult = null;
    }

    /**
     * Activate the exchange zone
     * @param {number} zoneIndex - Which zone (0, 1, or 2)
     */
    activate(zoneIndex) {
        this.active = true;
        this.currentZoneIndex = zoneIndex;
        this.barPosition = 0;
        this.direction = 1;
        this.handoffAttempted = false;
        this.handoffResult = null;
    }

    /**
     * Deactivate the exchange zone
     */
    deactivate() {
        this.active = false;
        this.currentZoneIndex = -1;
    }

    /**
     * Update the timing bar
     * @param {number} delta - Time since last frame (seconds)
     */
    update(delta) {
        if (!this.active || this.handoffAttempted) return;

        // Ping-pong oscillation
        this.barPosition += this.direction * OSCILLATE_SPEED * delta;

        if (this.barPosition >= 1) {
            this.barPosition = 1;
            this.direction = -1;
        } else if (this.barPosition <= 0) {
            this.barPosition = 0;
            this.direction = 1;
        }
    }

    /**
     * Get the current zone color based on bar position
     * @returns {string} Color identifier
     */
    getZoneColor() {
        const pos = this.barPosition;

        // Red zones: 0-0.2 and 0.8-1.0
        if (pos < RED_THRESHOLD || pos > (1 - RED_THRESHOLD)) {
            return ZONE_COLOR.RED;
        }

        // Yellow zones: 0.2-0.4 and 0.6-0.8
        if (pos < YELLOW_THRESHOLD || pos > (1 - YELLOW_THRESHOLD)) {
            return ZONE_COLOR.YELLOW;
        }

        // Green zone: 0.4-0.6
        return ZONE_COLOR.GREEN;
    }

    /**
     * Attempt a handoff when player presses Enter
     * @returns {Object} Result of the handoff attempt
     */
    attemptHandoff() {
        if (!this.active || this.handoffAttempted) {
            return { success: false, reason: 'not_in_zone' };
        }

        this.handoffAttempted = true;
        const color = this.getZoneColor();

        switch (color) {
            case ZONE_COLOR.RED:
                this.handoffResult = {
                    success: false,
                    color: color,
                    speedBonus: 0,
                    message: 'DROPPED BATON!',
                    raceOver: true
                };
                break;

            case ZONE_COLOR.YELLOW:
                this.handoffResult = {
                    success: true,
                    color: color,
                    speedBonus: 0.5, // 50% speed start
                    message: 'SLOW HANDOFF',
                    raceOver: false
                };
                break;

            case ZONE_COLOR.GREEN:
                this.handoffResult = {
                    success: true,
                    color: color,
                    speedBonus: 1.0, // Full speed start
                    message: 'PERFECT!',
                    raceOver: false
                };
                break;
        }

        return this.handoffResult;
    }

    /**
     * Check if currently active
     */
    isActive() {
        return this.active;
    }

    /**
     * Get the bar position for rendering (0-1)
     */
    getBarPosition() {
        return this.barPosition;
    }

    /**
     * Get handoff result if attempted
     */
    getHandoffResult() {
        return this.handoffResult;
    }

    /**
     * Check if handoff was attempted
     */
    wasHandoffAttempted() {
        return this.handoffAttempted;
    }

    /**
     * Reset for new zone or new race
     */
    reset() {
        this.active = false;
        this.barPosition = 0;
        this.direction = 1;
        this.currentZoneIndex = -1;
        this.handoffAttempted = false;
        this.handoffResult = null;
    }

    /**
     * Get color as CSS-compatible string
     */
    getColorCSS() {
        const color = this.getZoneColor();
        switch (color) {
            case ZONE_COLOR.RED: return '#ff3333';
            case ZONE_COLOR.YELLOW: return '#ffcc00';
            case ZONE_COLOR.GREEN: return '#33ff33';
            default: return '#ffffff';
        }
    }

    /**
     * Get bar position as percentage string
     */
    getBarPercentage() {
        return `${Math.round(this.barPosition * 100)}%`;
    }
}

/**
 * Create exchange zone indicator HTML element
 * @returns {HTMLElement}
 */
export function createExchangeZoneUI() {
    const container = document.createElement('div');
    container.id = 'exchangeZoneUI';
    container.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 400px;
        padding: 20px;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 16px;
        text-align: center;
        display: none;
        z-index: 200;
        font-family: Arial, sans-serif;
        color: white;
    `;

    container.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 15px; font-weight: bold;">EXCHANGE ZONE</div>
        <div style="font-size: 14px; color: #888; margin-bottom: 20px;">Press ENTER to pass the baton!</div>
        <div id="timingBarContainer" style="
            width: 100%;
            height: 40px;
            background: linear-gradient(to right,
                #ff3333 0%, #ff3333 20%,
                #ffcc00 20%, #ffcc00 40%,
                #33ff33 40%, #33ff33 60%,
                #ffcc00 60%, #ffcc00 80%,
                #ff3333 80%, #ff3333 100%);
            border-radius: 8px;
            position: relative;
            overflow: hidden;
        ">
            <div id="timingBarIndicator" style="
                position: absolute;
                top: 0;
                left: 0;
                width: 6px;
                height: 100%;
                background: white;
                border-radius: 3px;
                box-shadow: 0 0 10px white;
                transition: left 0.016s linear;
            "></div>
        </div>
        <div id="handoffMessage" style="
            margin-top: 15px;
            font-size: 28px;
            font-weight: bold;
            min-height: 35px;
        "></div>
    `;

    return container;
}

/**
 * Update the exchange zone UI element
 * @param {ExchangeZone} exchangeZone - The exchange zone instance
 */
export function updateExchangeZoneUI(exchangeZone) {
    const container = document.getElementById('exchangeZoneUI');
    if (!container) return;

    if (exchangeZone.isActive()) {
        container.style.display = 'block';

        const indicator = document.getElementById('timingBarIndicator');
        if (indicator) {
            indicator.style.left = `calc(${exchangeZone.getBarPercentage()} - 3px)`;
        }

        const message = document.getElementById('handoffMessage');
        if (message && exchangeZone.wasHandoffAttempted()) {
            const result = exchangeZone.getHandoffResult();
            message.textContent = result.message;
            message.style.color = exchangeZone.getColorCSS();
        } else if (message) {
            message.textContent = '';
        }
    } else {
        container.style.display = 'none';
    }
}
