// RaceConfig.js - Race mode definitions and configuration

import { getTrackLength } from './Track.js';

// Race mode identifiers
export const RACE_MODE = {
    RELAY_4X100: 'relay_4x100',
    SPRINT_400: 'sprint_400',
    MILE_1600: 'mile_1600'
};

// Input type identifiers
export const INPUT_TYPE = {
    SPACEBAR_MASH: 'spacebar_mash',  // Relay: mash spacebar for speed
    ARROW_KEYS: 'arrow_keys'          // 400m/1600m: arrow keys control speed
};

// Energy system identifiers
export const ENERGY_TYPE = {
    NONE: 'none',
    LACTIC_ACID: 'lactic_acid',  // 400m: fills up, causes DNF
    STAMINA_KICK: 'stamina_kick' // 1600m: depletes, converts to kick
};

// Race mode configurations
export const RACE_MODES = {
    [RACE_MODE.RELAY_4X100]: {
        name: "4x100m Relay",
        totalDistance: 400,
        legs: 4,
        legDistance: 100,
        // Olympic rules: 30m exchange zones, starting 10m before each 100m mark
        // Zone 1: 90-120m, Zone 2: 190-220m, Zone 3: 290-320m
        exchangeZoneStart: [90, 190, 290],
        exchangeZoneLength: 30,
        stayInLane: true,
        staggeredStart: false, // Solo time trial, no stagger needed
        hasBaton: true,
        inputType: INPUT_TYPE.SPACEBAR_MASH, // Uses B/N alternating keys
        energyType: ENERGY_TYPE.NONE,
        numRunners: 1, // Solo time trial
        hasCountdown: false, // Just "Set" then B/N keys
        description: "Solo time trial - alternate B/N keys to sprint, press ↵ for handoffs"
    },

    [RACE_MODE.SPRINT_400]: {
        name: "400m Sprint",
        totalDistance: null, // Calculated per lane
        legs: 1,
        stayInLane: true,
        staggeredStart: true,
        hasBaton: false,
        inputType: INPUT_TYPE.ARROW_KEYS,
        energyType: ENERGY_TYPE.LACTIC_ACID,
        numRunners: 8, // Player + 7 AI
        hasCountdown: true,
        description: "One lap sprint - manage lactic acid to avoid DNF"
    },

    [RACE_MODE.MILE_1600]: {
        name: "1600m (Mile)",
        totalDistance: null, // Calculated as 4 laps
        laps: 4,
        legs: 1,
        stayInLane: false, // Waterfall start, then break to lane 1
        staggeredStart: true, // Waterfall start
        waterfallBreakDistance: 100, // Break to lane 1 after first curve
        hasBaton: false,
        inputType: INPUT_TYPE.ARROW_KEYS,
        energyType: ENERGY_TYPE.STAMINA_KICK,
        numRunners: 8, // Player + 7 AI
        hasCountdown: true,
        kickPhaseStart: 1200, // Last 400m is kick phase
        description: "4 lap race - draft to conserve stamina, kick on final lap"
    }
};

// Get race distance for a specific mode and lane
export function getRaceDistance(mode, lane = 1) {
    const config = RACE_MODES[mode];
    if (!config) return 0;

    if (config.totalDistance) {
        return config.totalDistance;
    }

    // Calculate based on track length
    const trackLen = getTrackLength(lane);

    if (mode === RACE_MODE.MILE_1600) {
        return trackLen * config.laps;
    }

    // 400m - one lap in assigned lane
    return trackLen;
}

// Calculate stagger distance for a lane (how far ahead outer lanes start)
export function getStaggerDistance(lane) {
    const lane1Length = getTrackLength(1);
    const laneNLength = getTrackLength(lane);
    return laneNLength - lane1Length;
}

// Get starting position for a runner in a staggered start
export function getStaggeredStartPosition(lane, mode) {
    const config = RACE_MODES[mode];
    if (!config || !config.staggeredStart) {
        return 0; // No stagger
    }

    // Outer lanes start ahead to compensate for longer distance
    return getStaggerDistance(lane);
}

// Check if player is in an exchange zone (relay only)
export function isInExchangeZone(distance, mode) {
    const config = RACE_MODES[mode];
    if (!config || !config.hasBaton) return { inZone: false };

    for (let i = 0; i < config.exchangeZoneStart.length; i++) {
        const zoneStart = config.exchangeZoneStart[i];
        const zoneEnd = zoneStart + config.exchangeZoneLength;

        if (distance >= zoneStart && distance < zoneEnd) {
            return {
                inZone: true,
                zoneIndex: i,
                zoneProgress: (distance - zoneStart) / config.exchangeZoneLength
            };
        }
    }

    return { inZone: false };
}

// Get current lap number for 1600m
export function getCurrentLap(distance, mode) {
    if (mode !== RACE_MODE.MILE_1600) return 1;

    const trackLen = getTrackLength(1);
    return Math.floor(distance / trackLen) + 1;
}

// Check if in kick phase (1600m only)
export function isInKickPhase(distance, mode) {
    const config = RACE_MODES[mode];
    if (!config || config.energyType !== ENERGY_TYPE.STAMINA_KICK) return false;

    return distance >= config.kickPhaseStart;
}

// Get current relay leg (0-3)
export function getCurrentLeg(distance, mode) {
    const config = RACE_MODES[mode];
    if (!config || mode !== RACE_MODE.RELAY_4X100) return 0;

    return Math.min(Math.floor(distance / config.legDistance), config.legs - 1);
}
