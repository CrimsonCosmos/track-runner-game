# How Track Runner Works - A Technical Overview

Track Runner is a 3D first-person track racing game built with **Three.js** (a JavaScript 3D graphics library). This document explains how all the pieces fit together.

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [The Game Loop](#the-game-loop)
3. [Three.js Fundamentals](#threejs-fundamentals)
4. [The Track System](#the-track-system)
5. [The Player](#the-player)
6. [AI Runners](#ai-runners)
7. [The Input System](#the-input-system)
8. [The Energy System](#the-energy-system)
9. [Race Modes](#race-modes)
10. [Animation System](#animation-system)
11. [Collision Detection](#collision-detection)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TRACK RUNNER GAME                       │
│                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐   │
│  │   main.js   │   │  Track.js   │   │   Player.js     │   │
│  │ (game loop) │   │ (geometry)  │   │ (player state)  │   │
│  └──────┬──────┘   └──────┬──────┘   └────────┬────────┘   │
│         │                 │                   │             │
│         └────────────┬────┴───────────────────┘             │
│                      │                                      │
│         ┌────────────▼────────────┐                        │
│         │       Three.js          │                        │
│         │  (Scene, Camera, Render)│                        │
│         └────────────┬────────────┘                        │
│                      │                                      │
│         ┌────────────▼────────────┐                        │
│         │        WebGL            │                        │
│         │   (GPU Rendering)       │                        │
│         └─────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `main.js` | Game initialization, main loop, scene setup |
| `Track.js` | Track geometry and position calculations |
| `Player.js` | Player state, camera control, movement |
| `Runner.js` | AI runner logic, race data |
| `InputManager.js` | Keyboard input handling |
| `EnergySystem.js` | Stamina/lactic acid mechanics |
| `RaceConfig.js` | Race mode definitions |
| `Race.js` | Race logic, collision detection |

---

## The Game Loop

The game loop is the heartbeat of any game. It runs ~60 times per second (60 FPS) and does three things:
1. **Update** - Move things, check collisions, handle input
2. **Render** - Draw the current frame
3. **Repeat** - Schedule the next frame

### In Code (`main.js:2300-2350`)

```javascript
function animateWithPathEditor() {
    // 1. Schedule next frame (before doing work)
    requestAnimationFrame(animateWithPathEditor);

    // 2. Calculate time since last frame
    const time = performance.now();
    const delta = (time - prevTime) / 1000;  // Convert to seconds
    prevTime = time;

    // 3. Update game state
    if (raceStarted) {
        inputManager.update(delta);
        player.update(delta, time, aiRunners);

        for (const runner of aiRunners) {
            runner.update(delta, timeScaleFactor, aiRunners, raceDistance);
        }
    }

    // 4. Render the scene
    renderer.render(scene, camera);
}
```

### What is `delta`?

`delta` is the time (in seconds) since the last frame. This is crucial for **frame-rate independent movement**.

**Without delta (BAD):**
```javascript
player.x += 5;  // Moves 5 units per frame
// At 60 FPS: 300 units/second
// At 30 FPS: 150 units/second (half speed!)
```

**With delta (GOOD):**
```javascript
player.x += 5 * delta;  // Moves 5 units per second
// At 60 FPS: 5 * 0.0167 = 0.083 per frame × 60 = 5/second
// At 30 FPS: 5 * 0.0333 = 0.167 per frame × 30 = 5/second
```

### What is `requestAnimationFrame`?

It's the browser's way of saying "call this function before the next screen repaint." Benefits:
- Syncs with monitor refresh rate (usually 60Hz)
- Pauses when tab is hidden (saves CPU/battery)
- Smoother than `setInterval`

---

## Three.js Fundamentals

Three.js is a library that makes WebGL (GPU graphics) easier to use.

### The Three Pillars

Every Three.js app needs these three things:

```javascript
// 1. SCENE - The container for all 3D objects
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);  // Sky blue

// 2. CAMERA - What we see through
const camera = new THREE.PerspectiveCamera(
    75,                                    // Field of view (degrees)
    window.innerWidth / window.innerHeight, // Aspect ratio
    0.1,                                   // Near clipping plane
    1000                                   // Far clipping plane
);

// 3. RENDERER - Draws to the screen
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);  // Add canvas to page
```

### Adding Objects to the Scene

```javascript
// Create geometry (shape)
const geometry = new THREE.BoxGeometry(1, 1, 1);

// Create material (appearance)
const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });

// Combine into a mesh
const cube = new THREE.Mesh(geometry, material);

// Add to scene
scene.add(cube);
```

### Coordinate System

Three.js uses a **right-handed coordinate system**:
- **X** = left/right (positive = right)
- **Y** = up/down (positive = up)
- **Z** = forward/backward (positive = toward camera)

```
        Y (up)
        │
        │
        └────── X (right)
       /
      /
     Z (toward you)
```

---

## The Track System

The track is an oval with two straight sections and two curved sections.

### Track Constants (`Track.js:4-8`)

```javascript
export const STRAIGHT_LENGTH = 84.39;  // Meters (regulation track)
export const INNER_RADIUS = 36.5;      // Meters to lane 1 center
export const LANE_WIDTH = 1.22;        // Meters per lane
export const NUM_LANES = 8;
export const TRACK_WIDTH = LANE_WIDTH * NUM_LANES;  // ~9.76m total
```

### Position Calculation (`Track.js:17-62`)

Given a distance traveled and a lane number, calculate the 3D position:

```javascript
export function getTrackPosition(distance, lane) {
    const radius = INNER_RADIUS + (lane - 0.5) * LANE_WIDTH;
    const trackLength = getTrackLength(lane);

    // Normalize distance (loop around track)
    distance = distance % trackLength;

    // Calculate segment endpoints
    const seg1End = STRAIGHT_LENGTH;                    // End of bottom straight
    const seg2End = seg1End + Math.PI * radius;         // End of left curve
    const seg3End = seg2End + STRAIGHT_LENGTH;          // End of top straight
    // seg4End = seg3End + Math.PI * radius = full lap  // End of right curve

    let x, z, rotation;

    if (distance < seg1End) {
        // Bottom straight - running left
        x = STRAIGHT_LENGTH/2 - distance;
        z = -radius;
        rotation = Math.PI;  // Facing left
    }
    else if (distance < seg2End) {
        // Left curve
        const curveProgress = distance - seg1End;
        const angle = -Math.PI/2 - (curveProgress / radius);
        x = -STRAIGHT_LENGTH/2 + Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        rotation = angle - Math.PI/2;
    }
    // ... similar for top straight and right curve

    return { x, z, rotation };
}
```

### Why Lane Distance Varies

Outer lanes are longer because they travel a bigger circle:

```javascript
export function getTrackLength(lane) {
    const radius = INNER_RADIUS + (lane - 0.5) * LANE_WIDTH;
    // Circumference of a circle: 2πr
    return (STRAIGHT_LENGTH * 2) + (2 * Math.PI * radius);
}

// Lane 1: 84.39×2 + 2π×36.5 = 398.11m
// Lane 8: 84.39×2 + 2π×45.04 = 451.77m (53m longer!)
```

This is why 400m races have **staggered starts** - outer lanes start ahead.

---

## The Player

The player is the human-controlled character.

### State (`Player.js:22-45`)

```javascript
export class Player {
    constructor(camera) {
        this.camera = camera;
        this.distance = 0;           // How far along the track
        this.lanePosition = 1.0;     // Current lane (can be fractional)
        this.paceMinPerMile = 8.0;   // Running pace
        this.raceActive = false;
        this.finished = false;

        // Camera mode
        this.cameraMode = 'third-person';  // or 'first-person'

        // Camera orbit (third-person)
        this.orbitAngle = 0;      // Horizontal rotation
        this.orbitPitch = 0.3;    // Vertical angle
        this.zoomDistance = 15;   // Distance from player
    }
}
```

### Movement Update (`Player.js:140-145`)

```javascript
update(delta, time, aiRunners, inputManager) {
    // Convert pace to speed
    const userSpeed = this.paceToSpeed();  // meters per second

    // Move forward
    this.distance += userSpeed * delta;

    // Update camera position based on new distance
    // ...
}
```

### Pace to Speed Conversion

```javascript
paceToSpeed() {
    const METERS_PER_MILE = 1609.34;
    const secondsPerMile = this.paceMinPerMile * 60;
    return METERS_PER_MILE / secondsPerMile;
}

// 8:00/mile pace = 1609.34 / 480 = 3.35 m/s
// 5:00/mile pace = 1609.34 / 300 = 5.36 m/s
```

---

## AI Runners

AI runners follow pre-recorded split times from real races.

### Race Data (`Runner.js:24-39`)

```javascript
export const RACE_DATA_1600 = [
    // Jakob Ingebrigtsen - 3:43.73 (Prefontaine 2023)
    {
        name: "Ingebrigtsen",
        splits: [55.2, 111.8, 168.9, 223.73],  // Time at 400m, 800m, 1200m, 1600m
        finalTime: 223.73
    },
    // Yared Nuguse - 3:43.97 (American Record)
    { name: "Nuguse", splits: [55.3, 112.0, 169.2, 223.97], finalTime: 223.97 },
    // ...
];
```

### Speed Calculation (`Runner.js:57-66`)

The AI calculates target speed based on which segment they're in:

```javascript
export function getTargetSpeed(raceDataEntry, distance, timeScaleFactor) {
    const splits = raceDataEntry.splits;

    // Which 400m segment? (0, 1, 2, or 3)
    const segmentIndex = Math.min(Math.floor(distance / 400), 3);

    // Time at segment start and end
    const timeAtStart = segmentIndex === 0 ? 0 : splits[segmentIndex - 1];
    const timeAtEnd = splits[segmentIndex];
    const segmentTime = timeAtEnd - timeAtStart;

    // Speed = distance / time
    return (400 / segmentTime) / timeScaleFactor;
}

// Ingebrigtsen's first 400m: 400 / 55.2 = 7.25 m/s
// His last 400m: 400 / (223.73 - 168.9) = 400 / 54.83 = 7.30 m/s (kicks!)
```

---

## The Input System

Different race modes use different input schemes.

### Input Types (`RaceConfig.js:13-16`)

```javascript
export const INPUT_TYPE = {
    SPACEBAR_MASH: 'spacebar_mash',  // Relay: alternate B/N keys
    ARROW_KEYS: 'arrow_keys'          // 400m/1600m: up/down for speed
};
```

### Key Handling (`InputManager.js:59-105`)

```javascript
handleKeyDown(e) {
    // Relay: Alternating B/N for speed
    if (e.code === 'KeyB') {
        if (this.inputType === INPUT_TYPE.SPACEBAR_MASH) {
            if (!this.bKeyHeld && this.lastKeyPressed !== 'b') {
                this.registerAlternatingPress('b');  // Only count if alternating!
            }
            this.bKeyHeld = true;
        }
    }

    // 400m/1600m: Arrow keys
    if (e.code === 'ArrowUp') {
        this.upPressed = true;
    }
}
```

### Why Alternating Keys?

For the relay, you must alternate between B and N (like alternating legs while running):

```javascript
registerAlternatingPress(key) {
    // Only count if different from last key
    if (this.lastKeyPressed === key) return;  // Mashing same key = no credit

    const now = Date.now();
    this.alternatingPresses.push(now);
    this.lastKeyPressed = key;
}

getMashRate() {
    // Count presses in last 500ms
    const now = Date.now();
    const recentPresses = this.alternatingPresses.filter(t => now - t < 500);
    // 10 alternating presses per 500ms = max speed
    return Math.min(recentPresses.length / 10, 1.0);
}
```

---

## The Energy System

Different races have different energy mechanics.

### Lactic Acid (400m Sprint)

In a 400m, lactic acid builds up and slows you down:

```javascript
class LacticAcidSystem {
    constructor() {
        this.level = 0;  // 0-100%
        this.dnf = false;
    }

    update(speed, delta) {
        // Faster = more lactic acid
        const normalizedSpeed = speed / 12;  // 12 m/s = max
        const fillRate = Math.pow(normalizedSpeed, 2) * 8 * delta * 10;

        // Slower = drain lactic acid
        let drainRate = 0;
        if (speed < 6) {  // Threshold
            drainRate = (6 - speed) / 6 * 15 * delta;
        }

        this.level = Math.max(0, Math.min(100, this.level + fillRate - drainRate));

        // 100% lactic = DNF (Did Not Finish)
        if (this.level >= 100) {
            this.dnf = true;
            return 0;  // Can't move
        }

        // Speed penalty: at 50% lactic, lose 25% speed
        const penalty = (this.level / 100) * 0.5;
        return 1 - penalty;  // Multiplier for speed
    }
}
```

### Stamina + Kick (1600m)

In the mile, you manage stamina, then "kick" in the final 400m:

```javascript
class StaminaSystem {
    constructor() {
        this.stamina = 100;       // Depletes over time
        this.kickBar = 0;         // Activated in final 400m
        this.inKickPhase = false;
    }

    update(speed, isDrafting, distance) {
        // Base drain + speed penalty
        let drain = 2 + speed * 0.8;

        // Drafting behind someone = 50% less drain
        if (isDrafting) drain *= 0.5;

        this.stamina -= drain * delta;

        // At 1200m, convert to kick
        if (distance >= 1200 && !this.inKickPhase) {
            this.inKickPhase = true;
            this.kickBar = this.stamina * 2;  // Kick = 2× remaining stamina
        }

        if (this.inKickPhase) {
            this.kickBar -= 3 * delta;  // Kick depletes fast
        }
    }
}
```

---

## Race Modes

The game has three race modes with different mechanics:

### Configuration (`RaceConfig.js:26-80`)

```javascript
export const RACE_MODES = {
    'relay_4x100': {
        name: "4x100m Relay",
        totalDistance: 400,
        legs: 4,
        stayInLane: true,
        staggeredStart: true,
        hasBaton: true,
        inputType: INPUT_TYPE.SPACEBAR_MASH,
        energyType: ENERGY_TYPE.NONE
    },

    'sprint_400': {
        name: "400m Sprint",
        stayInLane: true,
        staggeredStart: true,
        inputType: INPUT_TYPE.ARROW_KEYS,
        energyType: ENERGY_TYPE.LACTIC_ACID  // Fill up = DNF
    },

    'mile_1600': {
        name: "1600m (Mile)",
        laps: 4,
        stayInLane: false,  // Break to lane 1 after curve
        inputType: INPUT_TYPE.ARROW_KEYS,
        energyType: ENERGY_TYPE.STAMINA_KICK,
        kickPhaseStart: 1200  // Last 400m = kick
    }
};
```

### Staggered Starts

Outer lanes get a head start to compensate for running a longer curve:

```javascript
export function getStaggerDistance(lane) {
    const lane1Length = getTrackLength(1);  // ~398m
    const laneNLength = getTrackLength(lane);
    return laneNLength - lane1Length;
}

// Lane 4 starts ~26m ahead of lane 1
// Lane 8 starts ~54m ahead of lane 1
```

---

## Animation System

Runners use animated 3D models loaded from FBX files.

### Loading Models (`main.js`, simplified)

```javascript
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const loader = new FBXLoader();

loader.load('models/runner.fbx', (model) => {
    // Set up animation
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(model.animations[0]);
    action.play();

    // Scale and position
    model.scale.setScalar(0.01);  // FBX models are often huge

    scene.add(model);
});
```

### Animation Update

Each frame, we advance the animation:

```javascript
// In game loop
const delta = (time - prevTime) / 1000;

for (const runner of aiRunners) {
    // Advance animation based on speed
    const animSpeed = runner.currentSpeed * runner.strideMultiplier;
    runner.mixer.update(delta * animSpeed);
}
```

### Speed-Matched Animation

The animation speed matches running speed so legs don't slide:

```javascript
// Random stride multiplier (0.85-1.15)
this.strideMultiplier = 0.85 + Math.random() * 0.3;

// Faster runners have faster leg turnover
runner.mixer.update(delta * speed * strideMultiplier);
```

---

## Collision Detection

Runners can bump into each other and get pushed.

### Simple Circle Collision (`Runner.js`)

Each runner is a circle of radius 0.4m:

```javascript
export const COLLISION_RADIUS = 0.4;
export const COLLISION_PUSH_STRENGTH = 3.0;

// In update loop
for (const other of allRunners) {
    if (other === this) continue;

    const dx = this.model.position.x - other.model.position.x;
    const dz = this.model.position.z - other.model.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);

    if (dist < COLLISION_RADIUS * 2) {
        // Push apart
        const pushX = (dx / dist) * COLLISION_PUSH_STRENGTH * delta;
        const pushZ = (dz / dist) * COLLISION_PUSH_STRENGTH * delta;

        this.lanePosition += pushX;
        // Clamp to valid lanes
        this.lanePosition = Math.max(MIN_LANE, Math.min(MAX_LANE, this.lanePosition));
    }
}
```

### Lane Drift

Runners naturally drift toward lane 1 (the inside):

```javascript
export const DRIFT_LEFT_SPEED = 0.15;  // Lane units per second

// In update
this.lanePosition -= DRIFT_LEFT_SPEED * delta;
this.lanePosition = Math.max(0.75, this.lanePosition);  // Can't go below lane 1
```

---

## Summary: Frame-by-Frame

Here's what happens every frame (~16ms at 60 FPS):

```
1. requestAnimationFrame schedules next frame

2. Calculate delta (time since last frame)

3. UPDATE PHASE:
   ├── InputManager reads keyboard state
   ├── Player updates:
   │   ├── distance += speed × delta
   │   ├── lanePosition changes for left/right
   │   └── camera follows player
   ├── AI Runners update:
   │   ├── Calculate target speed from splits
   │   ├── distance += speed × delta
   │   ├── Check collisions, apply push
   │   └── Update model position/rotation
   ├── Energy system updates (lactic/stamina)
   └── Check for race finish

4. RENDER PHASE:
   ├── renderer.render(scene, camera)
   └── WebGL draws to canvas

5. REPEAT
```

---

## Technologies Used

| Component | Technology | Purpose |
|-----------|------------|---------|
| 3D Graphics | Three.js | Scene, camera, meshes |
| Model Loading | FBXLoader | Animated character models |
| Rendering | WebGL | GPU-accelerated graphics |
| Build Tool | Vite | Fast development server |
| Desktop App | Tauri | Package as native app |
| Physics | Custom | Simple collision detection |

---

## Running the Game

### Development
```bash
cd /Users/dylangehl/track-runner-game
npm install
npm run dev
# Opens at http://localhost:5173
```

### Build Desktop App
```bash
npm run tauri:build
# Creates native Mac/Windows/Linux app
```

---

*Last updated: January 2026*
