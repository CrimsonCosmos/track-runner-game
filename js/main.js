import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Import game modules
import {
    STRAIGHT_LENGTH, INNER_RADIUS, LANE_WIDTH, NUM_LANES, TRACK_WIDTH,
    getTrackPosition, getTrackLength, buildTrack
} from './Track.js';

import {
    Runner, RUNNER_COLORS, RACE_DATA, shuffleArray,
    DRIFT_LEFT_SPEED, MIN_LANE_POSITION, MAX_LANE_POSITION
} from './Runner.js';

import { Player, formatPace } from './Player.js';

import {
    RACE_DISTANCE, ORIGINAL_WINNER_TIME, LAST_LAP_DISTANCE,
    createRaceClock, updateClockDisplay, playLastLapBell, getDistanceToLeader,
    resolveCollisions, RACE_FORMATION, ROW_SPACING, START_OFFSET, formatTime
} from './Race.js';

import { CelicaEasterEgg, CELICA_TRIGGER_DISTANCE } from './EasterEggs.js';

// ============================================
// SCENE SETUP
// ============================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 100, 400);

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ============================================
// LIGHTING
// ============================================

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffd0, 1.2);
sunLight.position.set(50, 100, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3d5c3d, 0.4);
scene.add(hemiLight);

// ============================================
// BUILD TRACK
// ============================================

buildTrack(scene);
createRaceClock(scene, STRAIGHT_LENGTH, INNER_RADIUS, TRACK_WIDTH);

// ============================================
// GAME STATE
// ============================================

const aiRunners = [];
let raceStarted = false;
let raceTime = 0;
let timeScaleFactor = 1.0;
let userGoalTime = 0;
let lastLapBellPlayed = false;

// Player instance
const player = new Player(camera);

// Easter egg
const celica = new CelicaEasterEgg(scene);
celica.load();

// Shuffle race data for random lane assignment
const shuffledRaceData = shuffleArray(RACE_DATA);

// ============================================
// LOAD RUNNERS
// ============================================

const loader = new FBXLoader();
loader.load(
    'models/Running.fbx',
    (fbx) => {
        for (let i = 0; i < 7; i++) {
            const lane = i + 2;
            const aiModel = (i === 0) ? fbx : SkeletonUtils.clone(fbx);

            const aiMixer = new THREE.AnimationMixer(aiModel);
            let aiAction = null;
            if (fbx.animations.length > 0) {
                aiAction = aiMixer.clipAction(fbx.animations[0]);
                aiAction.play();
                aiAction.paused = true;
            }

            const runner = new Runner(
                aiModel,
                aiMixer,
                aiAction,
                lane,
                shuffledRaceData[i],
                i
            );

            const startPos = getTrackPosition(0, lane);
            aiModel.position.set(startPos.x, 0, startPos.z);
            aiModel.rotation.y = startPos.rotation;

            scene.add(aiModel);
            aiRunners.push(runner);
        }

        document.getElementById('loading').style.display = 'none';
        console.log('AI Runners created:', aiRunners.length);

        aiRunners.forEach(r => {
            console.log(`Lane ${r.lane}: ${r.raceData.name}`);
        });
    },
    (progress) => {
        const percent = (progress.loaded / progress.total * 100).toFixed(0);
        document.getElementById('loading').textContent = `Loading runners... ${percent}%`;
    },
    (error) => {
        console.error('Error loading character:', error);
        document.getElementById('loading').textContent = 'Error loading. Run: python3 -m http.server 8000';
    }
);

// ============================================
// UI EVENT HANDLERS
// ============================================

// Pace slider
document.getElementById('paceSlider').addEventListener('input', (e) => {
    player.paceMinPerMile = parseFloat(e.target.value);
    document.getElementById('paceDisplay').textContent = formatPace(player.paceMinPerMile);
});

// Start race function
function startRace() {
    if (raceStarted) return;

    // Reset Celica Easter egg
    celica.reset();

    // Reset all runners in formation behind user
    for (let i = 0; i < aiRunners.length; i++) {
        const runner = aiRunners[i];
        const form = RACE_FORMATION[i];

        runner.reset(
            START_OFFSET - (form.row + 1) * ROW_SPACING,
            1.0 + form.laneOffset
        );
    }

    // Reset player to start line
    player.reset(START_OFFSET, 1.0);

    // Start the race
    raceStarted = true;
    player.raceActive = true;
    raceTime = 0;
    updateClockDisplay(0);
    lastLapBellPlayed = false;

    // Hide HUD elements during race
    document.getElementById('startButton').style.display = 'none';
    document.getElementById('raceInfo').style.display = 'none';
    document.getElementById('info').style.display = 'none';

    console.log('Race started!');
}

document.getElementById('startButton').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('treadmillMessage').style.display = 'none';
    startRace();
});

// ============================================
// GOAL TIME PICKER
// ============================================

let selectedMinutes = 25;
let selectedSeconds = 0;

function populatePickers() {
    const minutesInner = document.getElementById('minutesInner');
    const secondsInner = document.getElementById('secondsInner');

    for (let m = 10; m <= 60; m++) {
        const div = document.createElement('div');
        div.className = 'scroll-option';
        div.textContent = m.toString().padStart(2, '0');
        div.dataset.value = m;
        div.addEventListener('click', () => scrollToOption(minutesPicker, m - 10));
        minutesInner.appendChild(div);
    }

    for (let s = 0; s <= 59; s++) {
        const div = document.createElement('div');
        div.className = 'scroll-option';
        div.textContent = s.toString().padStart(2, '0');
        div.dataset.value = s;
        div.addEventListener('click', () => scrollToOption(secondsPicker, s));
        secondsInner.appendChild(div);
    }
}

function scrollToOption(picker, index) {
    const optionHeight = 50;
    picker.scrollTo({ top: index * optionHeight, behavior: 'smooth' });
}

function updateSelectedFromScroll(picker, isMinutes) {
    const optionHeight = 50;
    const scrollTop = picker.scrollTop;
    const index = Math.round(scrollTop / optionHeight);

    const options = picker.querySelectorAll('.scroll-option');
    options.forEach((opt, i) => {
        opt.classList.toggle('selected', i === index);
    });

    if (isMinutes) {
        selectedMinutes = index + 10;
    } else {
        selectedSeconds = index;
    }
}

const minutesPicker = document.getElementById('minutesPicker');
const secondsPicker = document.getElementById('secondsPicker');

populatePickers();

setTimeout(() => {
    scrollToOption(minutesPicker, 15);
    scrollToOption(secondsPicker, 0);
    updateSelectedFromScroll(minutesPicker, true);
    updateSelectedFromScroll(secondsPicker, false);
}, 100);

minutesPicker.addEventListener('scroll', () => updateSelectedFromScroll(minutesPicker, true));
secondsPicker.addEventListener('scroll', () => updateSelectedFromScroll(secondsPicker, false));

document.getElementById('goalTimeSubmit').addEventListener('click', () => {
    const goalSeconds = selectedMinutes * 60 + selectedSeconds;

    if (goalSeconds < 600 || goalSeconds > 3600) {
        alert('Please select a valid time between 10:00 and 60:00');
        return;
    }

    userGoalTime = goalSeconds;
    const winnerTargetTime = goalSeconds - 10;
    timeScaleFactor = winnerTargetTime / ORIGINAL_WINNER_TIME;

    console.log(`Goal time: ${formatTime(goalSeconds)}, Winner target: ${formatTime(winnerTargetTime)}, Scale factor: ${timeScaleFactor.toFixed(3)}`);

    document.getElementById('goalTimeModal').style.display = 'none';
    document.getElementById('treadmillMessage').style.display = 'block';
    document.getElementById('startButton').style.display = 'block';
    document.getElementById('paceSliderContainer').style.display = 'flex';
});

// ============================================
// ANIMATION LOOP
// ============================================

let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if (raceStarted) {
        // Update player
        player.update(delta, time, aiRunners);

        // Update race time and clock
        raceTime += delta;
        updateClockDisplay(raceTime);

        // Check for Celica trigger
        if (aiRunners.length > 0) {
            const leader = aiRunners.reduce((max, r) => r.distance > max.distance ? r : max, aiRunners[0]);
            celica.checkTrigger(leader.distance);
        }

        // Update Celica
        celica.update(delta, aiRunners);

        // Update AI runners
        for (const runner of aiRunners) {
            runner.update(delta, timeScaleFactor, aiRunners, RACE_DISTANCE);
        }

        // Resolve collisions
        if (aiRunners.length > 0) {
            resolveCollisions(player, aiRunners, delta);
        }

        // Check for last lap bell
        if (!lastLapBellPlayed && aiRunners.length > 0) {
            const leader = aiRunners.reduce((max, r) => r.distance > max.distance ? r : max, aiRunners[0]);

            if (leader.distance >= LAST_LAP_DISTANCE) {
                const leaderPos = getTrackPosition(leader.distance, leader.lanePosition);
                const distToLeader = getDistanceToLeader(camera.position, leaderPos);

                const maxDistance = 200;
                const minVolume = 0.2;
                const volume = Math.max(minVolume, 1.0 - (distToLeader / maxDistance) * (1.0 - minVolume));

                playLastLapBell(volume);
                lastLapBellPlayed = true;
                console.log(`Last lap bell! Leader at ${leader.distance.toFixed(0)}m`);
            }
        }

        // Check if all runners finished
        if (aiRunners.length > 0 && aiRunners.every(r => r.finished)) {
            if (document.getElementById('startButton').textContent !== 'RESTART RACE') {
                document.getElementById('startButton').textContent = 'RESTART RACE';
                document.getElementById('startButton').style.display = 'block';
                document.getElementById('startButton').disabled = false;
                raceStarted = false;
                player.raceActive = false;
            }
        }
    } else {
        // Keep animations paused before race
        for (const runner of aiRunners) {
            if (runner.mixer) {
                runner.mixer.update(0);
            }
        }
    }

    renderer.render(scene, camera);
}

animate();

// ============================================
// WINDOW RESIZE
// ============================================

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
