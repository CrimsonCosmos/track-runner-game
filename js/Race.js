import * as THREE from 'three';
import { getPosition } from './Track.js';
import { COLLISION_RADIUS, COLLISION_PUSH_STRENGTH, MAX_LANE_POSITION } from './Runner.js';

// Race constants
export const RACE_DISTANCE = 5000; // 5K race
export const ORIGINAL_WINNER_TIME = 791.3; // Ingebrigtsen's winning time in seconds
export const LAST_LAP_DISTANCE = 4800; // 12 laps completed, starting last lap

// Clock display
let clockCanvas = null;
let clockCtx = null;
let clockTexture = null;
let clockMesh = null;

export function createRaceClock(scene, STRAIGHT_LENGTH, INNER_RADIUS, TRACK_WIDTH) {
    clockCanvas = document.createElement('canvas');
    clockCanvas.width = 256;
    clockCanvas.height = 64;
    clockCtx = clockCanvas.getContext('2d');

    clockTexture = new THREE.CanvasTexture(clockCanvas);
    clockTexture.minFilter = THREE.NearestFilter;
    clockTexture.magFilter = THREE.NearestFilter;

    const clockMaterial = new THREE.MeshBasicMaterial({
        map: clockTexture,
        transparent: true,
        side: THREE.DoubleSide
    });

    const clockGeometry = new THREE.PlaneGeometry(6, 1.5);
    clockMesh = new THREE.Mesh(clockGeometry, clockMaterial);

    clockMesh.position.set(
        -STRAIGHT_LENGTH / 4 - 8,
        4,
        -(INNER_RADIUS + TRACK_WIDTH / 2)
    );
    clockMesh.rotation.y = Math.PI / 2;

    scene.add(clockMesh);
    updateClockDisplay(0);

    return clockMesh;
}

export function updateClockDisplay(timeInSeconds) {
    if (!clockCtx || !clockTexture) return;

    clockCtx.fillStyle = '#111111';
    clockCtx.fillRect(0, 0, 256, 64);

    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const hundredths = Math.floor((timeInSeconds * 100) % 100);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;

    clockCtx.font = 'bold 48px "Courier New", monospace';
    clockCtx.fillStyle = '#ff0000';
    clockCtx.textAlign = 'center';
    clockCtx.textBaseline = 'middle';

    clockCtx.shadowColor = '#ff0000';
    clockCtx.shadowBlur = 8;
    clockCtx.fillText(timeStr, 128, 32);

    clockCtx.shadowBlur = 0;
    clockCtx.fillText(timeStr, 128, 32);

    clockTexture.needsUpdate = true;
}

// Audio for last lap bell
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

export function playLastLapBell(volume = 1.0) {
    const ctx = initAudio();
    if (ctx.state === 'suspended') {
        ctx.resume();
    }

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, now);
    osc1.frequency.exponentialRampToValueAtTime(600, now + 0.5);
    gain1.gain.setValueAtTime(0.5 * volume, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, now);
    osc2.frequency.exponentialRampToValueAtTime(900, now + 0.4);
    gain2.gain.setValueAtTime(0.3 * volume, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(2400, now);
    gain3.gain.setValueAtTime(0.15 * volume, now);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);
    osc1.stop(now + 1.0);
    osc2.stop(now + 0.6);
    osc3.stop(now + 0.3);

    setTimeout(() => {
        const now2 = ctx.currentTime;
        const osc4 = ctx.createOscillator();
        const gain4 = ctx.createGain();
        osc4.type = 'sine';
        osc4.frequency.setValueAtTime(850, now2);
        osc4.frequency.exponentialRampToValueAtTime(650, now2 + 0.5);
        gain4.gain.setValueAtTime(0.4 * volume, now2);
        gain4.gain.exponentialRampToValueAtTime(0.01, now2 + 0.8);
        osc4.connect(gain4);
        gain4.connect(ctx.destination);
        osc4.start(now2);
        osc4.stop(now2 + 0.8);
    }, 300);
}

export function getDistanceToLeader(cameraPosition, leaderPosition) {
    const dx = cameraPosition.x - leaderPosition.x;
    const dz = cameraPosition.z - leaderPosition.z;
    return Math.sqrt(dx * dx + dz * dz);
}

// Collision resolution between all runners
export function resolveCollisions(player, aiRunners, delta) {
    const allRunners = [
        { distance: player.distance, lanePosition: player.lanePosition, isUser: true }
    ];
    for (const runner of aiRunners) {
        allRunners.push({
            distance: runner.distance,
            lanePosition: runner.lanePosition,
            ref: runner,
            isUser: false
        });
    }

    for (let i = 0; i < allRunners.length; i++) {
        for (let j = i + 1; j < allRunners.length; j++) {
            const a = allRunners[i];
            const b = allRunners[j];

            const distanceDiff = Math.abs(a.distance - b.distance);
            const laneDiff = Math.abs(a.lanePosition - b.lanePosition);

            if (distanceDiff > 2.0 || laneDiff > 1.5) continue;

            const posA = getPosition(a.distance, a.lanePosition);
            const posB = getPosition(b.distance, b.lanePosition);

            const dx = posB.x - posA.x;
            const dz = posB.z - posA.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            const minDist = COLLISION_RADIUS * 2;

            const aAhead = a.distance > b.distance;
            const aOnInside = a.lanePosition < b.lanePosition;

            if (dist < minDist && dist > 0.01) {
                const overlap = minDist - dist;
                const pushAmount = overlap * COLLISION_PUSH_STRENGTH * delta;

                if (aAhead) {
                    if (!b.isUser) {
                        b.ref.lanePosition = Math.min(b.ref.lanePosition + pushAmount, MAX_LANE_POSITION + 1);
                    } else {
                        player.pushOutward(pushAmount);
                    }
                } else {
                    if (!a.isUser) {
                        a.ref.lanePosition = Math.min(a.ref.lanePosition + pushAmount, MAX_LANE_POSITION + 1);
                    } else {
                        player.pushOutward(pushAmount);
                    }
                }
            }

            // Blocking between AI runners only
            const blockingThreshold = 1.0;
            const raceHasProgressed = a.distance > 50 && b.distance > 50;

            if (!a.isUser && !b.isUser && distanceDiff < blockingThreshold && raceHasProgressed) {
                if (aAhead && !aOnInside) {
                    const maxDist = a.distance - 0.3;
                    if (b.ref.distance > maxDist && b.lanePosition <= a.lanePosition + 0.3) {
                        b.ref.distance = maxDist;
                    }
                } else if (!aAhead && aOnInside) {
                    const maxDist = b.distance - 0.3;
                    if (a.ref.distance > maxDist && a.lanePosition <= b.lanePosition + 0.3) {
                        a.ref.distance = maxDist;
                    }
                }
            }

            // User must go around on outside
            if ((a.isUser || b.isUser) && dist < minDist) {
                player.pushOutward(0.1 * delta);
            }
        }
    }

    // Update AI runner positions after collision resolution
    for (const runner of aiRunners) {
        const pos = getPosition(runner.distance, runner.lanePosition);
        const groundY = pos.y || 0;
        runner.model.position.set(pos.x, groundY, pos.z);
    }

    // Update player position if pushed
    player.updatePosition();
}

// Formation for race start
export const RACE_FORMATION = [
    { row: 0, laneOffset: 0.3 },
    { row: 0, laneOffset: 1.1 },
    { row: 1, laneOffset: 0.0 },
    { row: 1, laneOffset: 0.8 },
    { row: 2, laneOffset: 0.3 },
    { row: 2, laneOffset: 1.1 },
    { row: 3, laneOffset: 0.5 },
];

export const ROW_SPACING = 1.5;
export const START_OFFSET = 8;

export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
